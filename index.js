import fs from "node:fs";
import path from "node:path";

import calculateLoc from "./loc.js";
import simianAnalysis from "./simian.js";
import duplicationResultsAnalysis from "./results.js";
import ensureNonExceedingEndLines from "./exceeding-lines.js";

const calulateDuplication = async ({
	codePath,
	resultsPath = null,
}) => {
	try {
		const analysesResults = await simianAnalysis(codePath);

		const tmpDuplication = duplicationResultsAnalysis(analysesResults);
		const analysisDirectory = path.normalize(codePath).replaceAll("\\", "/").replace(/\/$/, "");
		const duplication = ensureNonExceedingEndLines(tmpDuplication, analysisDirectory, root);
		const { LOC, LLOC } = await calculateLoc(analysisDirectory);
		const duplicationMetrics = { duplicateLOC: duplication.general_info.duplicate_loc, LOC, LLOC };
		const results = { duplication, duplicationMetrics };

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
