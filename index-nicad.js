import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import calculateLoc from "./loc.js";
import nicadAnalysis from "./nicad.js";

/**
 * Public entry point of the NiCad-based app. Orchestrates the duplication
 * analysis pipeline for a given source directory.
 *
 * @param {object}  params
 * @param {string}  params.codePath    - Path to the directory containing the source code to analyze.
 * @param {?string} params.resultsPath - Optional directory path; if provided, writes "duplication-nicad.json" there.
 * @returns {Promise<object>} A result envelope that never throws:
 *   { success, duplication, duplicationMetrics, duplicationScores, error }
 */
const calculateDuplication = async ({
	codePath,
	resultsPath = null,
}) => {
	try {
		// Normalize the directory path: convert backslashes to forward-slashes
		// and strip any trailing slash so path joins stay consistent.
		const analysisDirectory = path.normalize(codePath).replaceAll("\\", "/").replace(/\/$/, "");

		// 1. Run NiCad over all Java sources and parse its XML output into the
		//    report structure (general_info + code_clones[]).
		const { general_info, code_clones } = await nicadAnalysis(analysisDirectory);
		const duplication = { general_info, code_clones };

		// 2. Count physical (LOC) and logical (LLOC) lines of code via cloc.
		const { LOC, LLOC } = await calculateLoc(analysisDirectory);

		const duplicationMetrics = { duplicateLOC: duplication.general_info.duplicate_loc, LOC, LLOC };
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
		// Any failure (NiCad execution, XML parsing, cloc, file I/O) is caught
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

export default calculateDuplication;
