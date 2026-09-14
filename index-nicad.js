import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import clusterClonePairs from "./cluster.js";
import mergeClonePairs from "./incremental.js";
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
			const { clonePairs: crossClonePairs } = await nicadCrossAnalysis(analysisDirectory, changedFilesDirectory);

			clonePairs = await mergeClonePairs({
				resultsPath,
				wholeProjectDirectory: analysisDirectory,
				changedFilesDirectory,
				crossClonePairs,
			});
		} else {
			({ clonePairs } = await nicadAnalysis(analysisDirectory));
		}

		// 2. Group the pairs into clone classes and derive the report counters.
		const duplication = clusterClonePairs(clonePairs);

		const duplicationMetrics = { duplicateLOC: duplication.general_info.duplicate_loc };
		const results = { duplication, duplicationMetrics };

		// 3. Optionally persist the full results to disk as "duplication-nicad.json".
		if (resultsPath) {
			const filePath = path.join(resultsPath, "duplication-nicad.json");
			fs.writeFileSync(filePath, JSON.stringify(results, null, 10));
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
