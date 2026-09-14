import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import shell from "shelljs";
import xml2js from "xml2js";

// NiCad is executed through WSL from this directory (installation-free option).
const NICAD_DIRECTORY = "~/Open-NiCad";

// Clone granularity and the name of the bundled configuration in utils/.
const GRANULARITY = "blocks";
const CONFIG_NAME = "progressive-analysis";

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
	const nicadClonesPath = shell
		.exec(`wsl -e bash -lc "wslpath -w ${NICAD_DIRECTORY}/nicadclones"`, { silent: true })
		.stdout
		.trim();
	const systemPath = path.join(nicadClonesPath, systemName);

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
 * @param {string} resultsDirectory
 * @returns {Promise<object[]>} [{ similarity, files: [{ filePath, start_line, end_line }, ...] }]
 */
const readClonePairs = async (resultsDirectory) => {
	const pairsFile = fs.readdirSync(resultsDirectory)
		.find((file) => file.endsWith(".xml") && !file.includes("-classes"));

	if (!pairsFile) {
		throw new Error(`No clone-pairs report found in "${resultsDirectory}".`);
	}

	const report = fs.readFileSync(path.join(resultsDirectory, pairsFile), { encoding: "utf8", flag: "r" });
	const data = await new xml2js.Parser().parseStringPromise(report);

	const clones = data?.clones?.clone ?? [];

	return clones.map((clone) => ({
		similarity: clone?.$?.similarity,
		files: clone.source.map((instance) => ({
			filePath: toSystemRelativePath(instance?.$?.file),
			start_line: instance?.$?.startline,
			end_line: instance?.$?.endline,
		})),
	}));
};

export {
	CONFIG_NAME,
	GRANULARITY,
	NICAD_DIRECTORY,
	findResultsDirectory,
	installConfig,
	readClonePairs,
	runInNicad,
	toWslPath,
};
