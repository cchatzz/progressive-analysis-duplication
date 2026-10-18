import fs from "node:fs";
import path from "node:path";

import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";

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
 * Reads the clone pairs of the previous analysis and keeps a copy of the file
 * as "duplication-nicad-old.json".
 *
 * The results file can grow past V8's maximum string length, so it is streamed
 * and only the "clone_pairs" array is pulled out rather than slurped and parsed
 * in one piece. The file is copied rather than renamed so that a failure later
 * in the run cannot leave the directory without a baseline to start from.
 *
 * @param {string} resultsPath - Directory holding "duplication-nicad.json".
 * @returns {Promise<object[]>} The stored clone pairs.
 */
const readPreviousClonePairs = (resultsPath) => new Promise((resolve, reject) => {
	const previousPath = path.join(resultsPath, "duplication-nicad.json");

	if (!fs.existsSync(previousPath)) {
		reject(new Error(`Incremental analysis needs a previous "${previousPath}". Run a full analysis first.`));
		return;
	}

	fs.copyFileSync(previousPath, path.join(resultsPath, "duplication-nicad-old.json"));

	const clonePairs = [];
	const source = fs.createReadStream(previousPath);
	const jsonParser = parser.asStream();
	const picker = pick.asStream({ filter: "duplication.clone_pairs" });
	const arrayStream = streamArray.asStream();

	for (const stream of [source, jsonParser, picker, arrayStream]) {
		stream.on("error", reject);
	}

	arrayStream.on("data", ({ value }) => clonePairs.push(value));
	arrayStream.on("end", () => resolve(clonePairs));

	source.pipe(jsonParser).pipe(picker).pipe(arrayStream);
});

/**
 * Combines the clone pairs carried over from the previous analysis with the ones
 * NiCadCross found for the changed files.
 *
 * @param {object} params
 * @param {string} params.resultsPath        - Directory holding the previous analysis.
 * @param {Set<string>} params.changedFiles  - Project-relative paths the commit touched.
 * @param {Set<string>} params.currentFiles  - Project-relative paths that exist after the commit.
 * @param {object[]} params.crossClonePairs  - Pairs reported by NiCadCross.
 * @returns {Promise<object[]>} The merged clone pairs.
 */
const mergeClonePairs = async ({
	resultsPath,
	changedFiles,
	currentFiles,
	crossClonePairs,
}) => {
	const oldClonePairs = await readPreviousClonePairs(resultsPath);

	return [...carryOverClonePairs(oldClonePairs, changedFiles, currentFiles), ...crossClonePairs];
};

export default mergeClonePairs;
