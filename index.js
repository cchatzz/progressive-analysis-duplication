import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import calculateLoc from "./loc.js";
import simianAnalysis from "./simian.js";
import duplicationResultsAnalysis from "./results.js";
import ensureNonExceedingEndLines from "./exceeding-lines.js";

/**
 * Public entry point. Orchestrates the full duplication-analysis pipeline for
 * a given source directory.
 *
 * @param {object}  params
 * @param {string}  params.codePath    - Absolute path to the directory containing the source code to analyze.
 * @param {?string} params.resultsPath - Optional directory path; if provided, writes "duplication.json" there.
 * @returns {Promise<object>} A result envelope that never throws:
 *   { success, duplication, duplicationMetrics, duplicationScores, error }
 */
const calulateDuplication = async ({
	codePath,
	resultsPath = null,
}) => {
	try {
		// 1. Run the Simian JAR over all Java sources and parse its XML output
		//    into a normalized clone list.
		const analysesResults = await simianAnalysis(codePath);

		// 2. Reshape the raw Simian data into the stable report structure
		//    (general_info + code_clones[]).
		const tmpDuplication = duplicationResultsAnalysis(analysesResults);

		// Normalize the directory path: convert backslashes to forward-slashes
		// and strip any trailing slash so path joins stay consistent.
		const analysisDirectory = path.normalize(codePath).replaceAll("\\", "/").replace(/\/$/, "");

		// 3. Clamp each clone's end_line so it never exceeds the actual line
		//    count of the source file (Simian can occasionally over-report).
		const duplication = ensureNonExceedingEndLines(tmpDuplication, analysisDirectory);

		// 4. Count physical (LOC) and logical (LLOC) lines of code via cloc.
		const { LOC, LLOC } = await calculateLoc(analysisDirectory);

		const duplicationMetrics = { duplicateLOC: duplication.general_info.duplicate_loc, LOC, LLOC };
		const results = { duplication, duplicationMetrics };

		// 5. Optionally persist the full results to disk as "duplication.json".
		if (resultsPath) {
			const filePath = path.join(resultsPath, "duplication.json");
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
		// Any failure (Simian execution, XML parsing, cloc, file I/O) is caught
		// here and returned as a failure envelope instead of propagating.
		return {
			success: false,
			duplication: {},
			duplicationMetrics: {},
			duplicationScores: {},
			error,
		};
	}
};

export default calulateDuplication;
