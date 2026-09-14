import path from "node:path";

import {
	CONFIG_NAME,
	GRANULARITY,
	findResultsDirectory,
	installConfig,
	readClonePairs,
	runInNicad,
	toWslPath,
} from "./nicad-common.js";

/**
 * Runs NiCad (through WSL) against all .java files under `analysisDirectory`
 * and returns the clone pairs it reported.
 *
 * Requires a WSL distribution with NiCad available at ~/Open-NiCad.
 *
 * @param {string} analysisDirectory - Root directory to scan for Java sources.
 * @returns {Promise<object>} {
 *   proc       - shelljs child-process result of the NiCad run,
 *   clonePairs - [{ similarity, files: [{ filePath, start_line, end_line }, ...] }]
 *                with every filePath relative to `analysisDirectory`
 * }
 */
const nicadAnalysis = async (analysisDirectory) => {
	const absoluteCodePath = path.resolve(analysisDirectory);
	const wslCodePath = toWslPath(absoluteCodePath);

	// NiCad names every artifact after the basename of the analyzed directory.
	const systemName = path.basename(absoluteCodePath);

	installConfig();

	// Expects nicadclones/ to have been cleared beforehand.
	const proc = runInNicad(`./bin/nicad ${GRANULARITY} java '${wslCodePath}' ${CONFIG_NAME}`);

	const clonePairs = await readClonePairs(findResultsDirectory(systemName, "-clones"));

	return { proc, clonePairs };
};

export default nicadAnalysis;
