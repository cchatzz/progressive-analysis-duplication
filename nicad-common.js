import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globby } from "globby";
import sax from "sax";
import shell from "shelljs";

// NiCad is executed through WSL from this directory (installation-free option).
const NICAD_DIRECTORY = "~/Open-NiCad";

// Clone granularity and the name of the bundled configuration in utils/.
const GRANULARITY = "blocks";
const CONFIG_NAME = "progressive-analysis";

// The incremental cross run stages both trees under NiCad's working directory
// under these names, so their results (and extraction databases) stay apart.
const STAGING_DIRECTORY = ".staging";
const WHOLE_SYSTEM = "whole";
const CHANGED_SYSTEM = "changed";

/**
 * Translates a Windows path into the POSIX path WSL expects.
 *
 * @param {string} windowsPath
 * @returns {string}
 */
const toWslPath = (windowsPath) => shell
	.exec(`wsl wslpath -u "${windowsPath}"`, { silent: true })
	.stdout
	.trim();

/**
 * Runs a command inside the NiCad installation directory.
 *
 * @param {string} command
 * @returns {object} shelljs child-process result.
 */
const runInNicad = (command) => shell.exec(
	`wsl -e bash -lc "cd ${NICAD_DIRECTORY} && ${command}"`,
	{ silent: true },
);

/**
 * Copies the bundled configuration into NiCad's own config directory.
 *
 * NiCad parses the file line by line and would read a trailing CR as part of
 * each value, so the copy is forced to LF endings.
 */
const installConfig = () => {
	const dirname = path.dirname(fileURLToPath(import.meta.url));
	const wslConfigPath = toWslPath(path.join(dirname, "utils", `${CONFIG_NAME}.cfg`));
	const installedConfigPath = `${NICAD_DIRECTORY}/lib/nicad/config/${CONFIG_NAME}.cfg`;

	shell.exec(
		`wsl -e bash -lc "cp '${wslConfigPath}' ${installedConfigPath} && sed -i 's/\\r$//' ${installedConfigPath}"`,
		{ silent: true },
	);
};

/**
 * Returns the Windows (UNC) path to NiCad's working directory, so its artifacts
 * can be read and written directly from the host.
 *
 * @returns {string}
 */
const nicadClonesWindowsPath = () => shell
	.exec(`wsl -e bash -lc "wslpath -w ${NICAD_DIRECTORY}/nicadclones"`, { silent: true })
	.stdout
	.trim();

/**
 * Returns the Windows (UNC) path to a system's extracted blocks database.
 *
 * @param {string} systemName - Name NiCad derived from the analyzed directory.
 * @returns {string}
 */
const blocksDbPath = (systemName) => path.join(
	nicadClonesWindowsPath(),
	systemName,
	`${systemName}_${GRANULARITY}.xml`,
);

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
 * Locates the results directory NiCad wrote for a system.
 *
 * NiCad encodes the configured renaming and normalization in the directory
 * name, so it is matched by prefix and suffix rather than rebuilt from the
 * configuration.
 *
 * @param {string} systemName - Name NiCad derived from the analyzed directory.
 * @param {string} suffix     - "-clones" for a normal run, "-crossclones" for a cross run.
 * @returns {string} Absolute (UNC) path to the results directory.
 */
const findResultsDirectory = (systemName, suffix) => {
	const systemPath = path.join(nicadClonesWindowsPath(), systemName);

	const resultsDirectory = fs.readdirSync(systemPath).find((entry) => entry.startsWith(`${systemName}_${GRANULARITY}`)
		&& entry.endsWith(suffix)
		// "-clones" is also a suffix of "-crossclones", so keep the two apart.
		&& (suffix === "-crossclones" || !entry.endsWith("-crossclones")));

	if (!resultsDirectory) {
		throw new Error(`NiCad produced no ${suffix} results for "${systemName}". Check the run log under nicadclones/${systemName}.`);
	}

	return path.join(systemPath, resultsDirectory);
};

/**
 * Strips the prefix of NiCad's working copy from a reported source path, so the
 * result is relative to the analyzed system's root.
 *
 * NiCad reports paths as "nicadclones/<system>/<system>/<path within system>".
 *
 * @param {string} reportedPath
 * @returns {string}
 */
const toSystemRelativePath = (reportedPath) => {
	const segments = reportedPath.split("/");

	return segments[0] === "nicadclones" ? segments.slice(3).join("/") : reportedPath;
};

/**
 * Reads the clone-pairs report from a NiCad results directory.
 *
 * The directory also holds a "-classes.xml" clustering of the same data, which
 * is deliberately ignored: classes record membership but not which blocks were
 * actually similar, and the incremental merge needs those individual pairs.
 *
 * The report is parsed as a stream: these files can exceed V8's maximum string
 * length, so the whole document is never held in memory at once.
 *
 * @param {string} resultsDirectory
 * @returns {Promise<object[]>} [{ similarity, files: [{ filePath, start_line, end_line }, ...] }]
 */
const readClonePairs = (resultsDirectory) => new Promise((resolve, reject) => {
	const pairsFile = fs.readdirSync(resultsDirectory)
		.find((file) => file.endsWith(".xml") && !file.includes("-classes"));

	if (!pairsFile) {
		reject(new Error(`No clone-pairs report found in "${resultsDirectory}".`));
		return;
	}

	const clonePairs = [];
	let currentPair = null;

	const parser = sax.createStream(true, { trim: true });

	parser.on("opentag", (node) => {
		if (node.name === "clone") {
			currentPair = { similarity: node.attributes.similarity, files: [] };
		} else if (node.name === "source" && currentPair) {
			currentPair.files.push({
				filePath: toSystemRelativePath(node.attributes.file),
				start_line: node.attributes.startline,
				end_line: node.attributes.endline,
			});
		}
	});

	parser.on("closetag", (name) => {
		if (name === "clone" && currentPair) {
			clonePairs.push(currentPair);
			currentPair = null;
		}
	});

	parser.on("error", reject);
	parser.on("end", () => resolve(clonePairs));

	fs.createReadStream(path.join(resultsDirectory, pairsFile)).pipe(parser);
});

export {
	CHANGED_SYSTEM,
	CONFIG_NAME,
	GRANULARITY,
	NICAD_DIRECTORY,
	STAGING_DIRECTORY,
	WHOLE_SYSTEM,
	blocksDbPath,
	findResultsDirectory,
	installConfig,
	listJavaFiles,
	nicadClonesWindowsPath,
	readClonePairs,
	runInNicad,
	toSystemRelativePath,
	toWslPath,
};
