import path from "node:path";

import shell from "shelljs";

import { extractionCacheExists, seedWholeExtraction } from "./extraction-cache.js";
import {
	CHANGED_SYSTEM,
	CONFIG_NAME,
	GRANULARITY,
	NICAD_DIRECTORY,
	STAGING_DIRECTORY,
	WHOLE_SYSTEM,
	findResultsDirectory,
	installConfig,
	readClonePairs,
	runInNicad,
	toWslPath,
} from "./nicad-common.js";

/**
 * Runs NiCadCross (through WSL) between the new version of the whole project
 * and the set of files the commit changed.
 *
 * NiCadCross reports only clones of fragments of the first system in the
 * second, so every reported pair has a changed file on one side: changed to
 * changed, and changed to unchanged. Pairs between two unchanged files are
 * deliberately not covered, since those carry over from the previous analysis.
 *
 * Because each changed file is present in both systems, a block always matches
 * its own copy; those self-pairs are dropped here. The filter compares line
 * ranges as well as paths, so genuine clones between two different blocks of
 * the same file are kept.
 *
 * @param {string} wholeProjectDirectory - Root of the project after the commit.
 * @param {string} changedFilesDirectory - Root of the mirrored tree of changed files.
 * @param {object} [reuse] - When an extraction cache is available, lets the whole
 *   project be reconstructed from it instead of re-extracted.
 * @param {string} [reuse.resultsPath]        - Directory holding "extraction-nicad.xml".
 * @param {Set<string>} [reuse.changedFiles]  - Project-relative paths the commit touched.
 * @param {Set<string>} [reuse.currentFiles]  - Project-relative paths that exist after the commit.
 * @returns {Promise<object>} {
 *   proc       - shelljs child-process result of the NiCadCross run,
 *   clonePairs - [{ similarity, files: [{ filePath, start_line, end_line }, ...] }]
 *                with every filePath relative to the project root
 * }
 */
const nicadCrossAnalysis = async (wholeProjectDirectory, changedFilesDirectory, reuse = {}) => {
	const wslWholePath = toWslPath(path.resolve(wholeProjectDirectory));
	const wslChangedPath = toWslPath(path.resolve(changedFilesDirectory));

	installConfig();

	const wholeStagingPath = `${STAGING_DIRECTORY}/${WHOLE_SYSTEM}`;
	const changedStagingPath = `${STAGING_DIRECTORY}/${CHANGED_SYSTEM}`;
	shell.exec(
		`wsl -e bash -lc "cd ${NICAD_DIRECTORY} && mkdir -p ${STAGING_DIRECTORY}`
		+ ` && rm -f ${wholeStagingPath} ${changedStagingPath}`
		+ ` && ln -s '${wslWholePath}' ${wholeStagingPath}`
		+ ` && ln -s '${wslChangedPath}' ${changedStagingPath}"`,
		{ silent: true },
	);

	const { resultsPath, changedFiles, currentFiles } = reuse;
	const canReuse = Boolean(resultsPath && changedFiles && currentFiles && extractionCacheExists(resultsPath));

	if (canReuse) {
		// Extract only the changed files, then splice them with the cached blocks
		// of the unchanged ones to rebuild the whole project's database. NiCadCross
		// finds it already in place and skips extracting the whole project itself.
		runInNicad(
			`rm -rf nicadclones/${WHOLE_SYSTEM} nicadclones/${CHANGED_SYSTEM}`
			+ ` && ./bin/nicad ${GRANULARITY} java ${changedStagingPath} ${CONFIG_NAME}`,
		);
		await seedWholeExtraction({ resultsPath, changedFiles, currentFiles });
	}

	// Expects nicadclones/ to have been cleared beforehand (reuse seeds it instead).
	const proc = runInNicad(
		`./bin/nicadcross ${GRANULARITY} java ${wholeStagingPath} ${changedStagingPath} ${CONFIG_NAME}`,
	);

	// NiCadCross stores its results under the first system.
	const reportedPairs = await readClonePairs(findResultsDirectory(WHOLE_SYSTEM, "-crossclones"));

    // Each changed file sits in both systems, so every block also matched its own copy. 
	const clonePairs = reportedPairs.filter(({ files }) => !(files[0].filePath === files[1].filePath
		&& files[0].start_line === files[1].start_line
		&& files[0].end_line === files[1].end_line));

	return { proc, clonePairs };
};

export default nicadCrossAnalysis;
