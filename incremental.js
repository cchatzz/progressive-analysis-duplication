import fs from "node:fs";
import path from "node:path";

import { globby } from "globby";

/**
 * Lists the Java files under `directory` as paths relative to it, using the
 * same forward-slash form NiCad reports.
 *
 * @param {string} directory
 * @returns {Promise<Set<string>>}
 */
const listJavaFiles = async (directory) => {
	const files = await globby(`${directory}/**/*.java`, { dot: true });

	return new Set(files.map((file) => path.relative(directory, file).replaceAll("\\", "/")));
};

/**
 * Selects the clone pairs of the previous analysis that the commit cannot have
 * invalidated.
 *
 * A pair survives only when neither of its two files was changed and both still
 * exist, so pairs that merely ran through a changed file are dropped rather than
 * carried over. That matters because a clone class records which blocks belong
 * together but not which of them were actually similar: keeping classes instead
 * of pairs would leave behind groups whose only link was the changed file.
 *
 * @param {object[]} oldClonePairs - clone_pairs of the stored analysis.
 * @param {Set<string>} changedFiles - Project-relative paths the commit touched.
 * @param {Set<string>} currentFiles - Project-relative paths that exist after the commit.
 * @returns {object[]}
 */
const carryOverClonePairs = (oldClonePairs, changedFiles, currentFiles) => oldClonePairs
	.filter(({ files }) => files.every(({ filePath }) => !changedFiles.has(filePath) && currentFiles.has(filePath)));

/**
 * Reads the previous analysis and keeps a copy of it as "duplication-nicad-old.json".
 *
 * The previous file is copied rather than renamed so that a failure later in the
 * run cannot leave the directory without a baseline to start from.
 *
 * @param {string} resultsPath - Directory holding "duplication-nicad.json".
 * @returns {object} The stored results object.
 */
const readPreviousAnalysis = (resultsPath) => {
	const previousPath = path.join(resultsPath, "duplication-nicad.json");

	if (!fs.existsSync(previousPath)) {
		throw new Error(`Incremental analysis needs a previous "${previousPath}". Run a full analysis first.`);
	}

	fs.copyFileSync(previousPath, path.join(resultsPath, "duplication-nicad-old.json"));

	return JSON.parse(fs.readFileSync(previousPath, { encoding: "utf8", flag: "r" }));
};

/**
 * Combines the clone pairs carried over from the previous analysis with the ones
 * NiCadCross found for the changed files.
 *
 * @param {object} params
 * @param {string} params.resultsPath           - Directory holding the previous analysis.
 * @param {string} params.wholeProjectDirectory - Root of the project after the commit.
 * @param {string} params.changedFilesDirectory - Root of the mirrored tree of changed files.
 * @param {object[]} params.crossClonePairs     - Pairs reported by NiCadCross.
 * @returns {Promise<object[]>} The merged clone pairs.
 */
const mergeClonePairs = async ({
	resultsPath,
	wholeProjectDirectory,
	changedFilesDirectory,
	crossClonePairs,
}) => {
	const previous = readPreviousAnalysis(resultsPath);
	const oldClonePairs = previous?.duplication?.clone_pairs;

	if (!oldClonePairs) {
		throw new Error("The previous analysis holds no \"clone_pairs\". Re-run a full analysis to produce them.");
	}

	const [changedFiles, currentFiles] = await Promise.all([
		listJavaFiles(changedFilesDirectory),
		listJavaFiles(wholeProjectDirectory),
	]);

	return [...carryOverClonePairs(oldClonePairs, changedFiles, currentFiles), ...crossClonePairs];
};

export default mergeClonePairs;
