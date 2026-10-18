import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import clusterClonePairs from "./cluster.js";
import { saveExtractionCache } from "./extraction-cache.js";
import mergeClonePairs from "./incremental.js";
import { listJavaFiles } from "./nicad-common.js";
import nicadAnalysis from "./nicad.js";
import nicadCrossAnalysis from "./nicad-cross.js";

/**
 * Normalizes a directory path: forward-slashes, no trailing slash.
 *
 * @param {string} directory
 * @returns {string}
 */
const normalizeDirectory = (directory) => path.normalize(directory).replaceAll("\\", "/").replace(/\/$/, "");

/**
 * Streams the results object to disk as JSON.
 *
 * The clone arrays can hold over a million entries, whose combined JSON exceeds
 * V8's maximum string length, so each element is serialized on its own and the
 * document is assembled through a write stream that honors backpressure.
 *
 * @param {string} filePath
 * @param {object} results - { duplication: { general_info, code_clones, clone_pairs }, duplicationMetrics }
 * @returns {Promise<void>}
 */
const writeResultsJson = (filePath, results) => new Promise((resolve, reject) => {
	const stream = fs.createWriteStream(filePath, { encoding: "utf8" });
	stream.on("error", reject);
	stream.on("finish", resolve);

	const write = (chunk) => new Promise((written) => {
		if (stream.write(chunk)) written();
		else stream.once("drain", written);
	});

	const writeArray = async (items) => {
		await write("[");
		for (let index = 0; index < items.length; index += 1) {
			await write((index ? "," : "") + JSON.stringify(items[index]));
		}
		await write("]");
	};

	const { duplication, duplicationMetrics } = results;

	(async () => {
		await write("{\"duplication\":{");
		await write(`\"general_info\":${JSON.stringify(duplication.general_info)},`);
		await write("\"code_clones\":");
		await writeArray(duplication.code_clones);
		await write(",\"clone_pairs\":");
		await writeArray(duplication.clone_pairs);
		await write("},");
		await write(`\"duplicationMetrics\":${JSON.stringify(duplicationMetrics)}}`);
		stream.end();
	})().catch(reject);
});

/**
 * Public entry point of the NiCad-based app. Runs either a full analysis of a
 * source directory, or an incremental one that reuses the previous analysis for
 * everything the commit left untouched.
 *
 * The mode follows from the paths given: `codePath` selects a full analysis,
 * while `changedFilesSetPath` together with `wholeProjectNewVersionPath` selects
 * an incremental one.
 *
 * Both modes derive clone classes from clone pairs the same way, so an
 * incremental run and a full run of the same project version agree.
 *
 * @param {object}  params
 * @param {?string} params.codePath                   - Directory to analyze in full.
 * @param {?string} params.changedFilesSetPath        - Mirrored tree of the files the commit changed.
 * @param {?string} params.wholeProjectNewVersionPath - The project as it stands after the commit.
 * @param {?string} params.resultsPath                - Optional directory; if provided, writes "duplication-nicad.json" there.
 * @returns {Promise<object>} A result envelope that never throws:
 *   { success, duplication, duplicationMetrics, duplicationScores, error }
 */
const calculateDuplication = async ({
	codePath = "",
	changedFilesSetPath = "",
	wholeProjectNewVersionPath = "",
	resultsPath = null,
}) => {
	try {
		const isIncremental = Boolean(changedFilesSetPath && wholeProjectNewVersionPath);

		if (!isIncremental && !codePath) {
			throw new Error("Provide either \"codePath\", or both \"changedFilesSetPath\" and \"wholeProjectNewVersionPath\".");
		}

		// 1. Collect the clone pairs covering the version under analysis, either
		//    from a full NiCad run or by merging a NiCadCross run for the changed
		//    files into the pairs the previous analysis still vouches for.
		const analysisDirectory = normalizeDirectory(isIncremental ? wholeProjectNewVersionPath : codePath);
		let clonePairs = [];

		if (isIncremental) {
			if (!resultsPath) {
				throw new Error("Incremental analysis needs \"resultsPath\" to read the previous analysis from.");
			}

			const changedFilesDirectory = normalizeDirectory(changedFilesSetPath);

			const [changedFiles, currentFiles] = await Promise.all([
				listJavaFiles(changedFilesDirectory),
				listJavaFiles(analysisDirectory),
			]);

			console.time("Clone pairs extraction");
			const { clonePairs: crossClonePairs } = await nicadCrossAnalysis(
				analysisDirectory,
				changedFilesDirectory,
				{ resultsPath, changedFiles, currentFiles },
			);
			console.timeEnd("Clone pairs extraction");

			console.time("Merging");
			clonePairs = await mergeClonePairs({
				resultsPath,
				changedFiles,
				currentFiles,
				crossClonePairs,
			});
			console.timeEnd("Merging");
		} else {
			console.time("Clone pairs extraction");
			const { clonePairs: fullClonePairs, systemName } = await nicadAnalysis(analysisDirectory);
			clonePairs = fullClonePairs;
			console.timeEnd("Clone pairs extraction");

			// Keep the extracted blocks so the next incremental run can reuse the
			// ones belonging to files the commit does not touch.
			if (resultsPath) {
				await saveExtractionCache({ systemName, resultsPath });
			}
		}

		// 2. Group the pairs into clone classes and derive the report counters.
		console.time("Clustering");
		const duplication = clusterClonePairs(clonePairs);
		console.timeEnd("Clustering");

		const duplicationMetrics = { duplicateLOC: duplication.general_info.duplicate_loc };
		const results = { duplication, duplicationMetrics };

		// 3. Optionally persist the full results to disk as "duplication-nicad.json".
		if (resultsPath) {
			const filePath = path.join(resultsPath, "duplication-nicad.json");
			await writeResultsJson(filePath, results);
		}

		return {
			success: true,
			duplication,
			duplicationMetrics,
			duplicationScores: {},
			error: null,
		};
	} catch (error) {
		// Any failure (NiCad execution, XML parsing, file I/O) is caught here and
		// returned as a failure envelope instead of propagating.
		return {
			success: false,
			duplication: {},
			duplicationMetrics: {},
			duplicationScores: {},
			error,
		};
	}
};

export default calculateDuplication;
