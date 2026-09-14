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
 * Runs NiCad (through WSL) against all .java files under `analysisDirectory`
 * and parses the resulting clone-classes XML into the normalized duplication
 * report shape used by the pipeline.
 *
 * Requires a WSL distribution with NiCad available at ~/Open-NiCad.
 *
 * @param {string} analysisDirectory - Root directory to scan for Java sources.
 * @returns {Promise<object>} {
 *   proc         - shelljs child-process result of the NiCad run,
 *   general_info - { duplicate_instances, duplicate_loc, classes_containing_clones },
 *   code_clones  - [{ clone_instances, clone_loc, files: [{ filePath, start_line, end_line }] }]
 * }
 */
const nicadAnalysis = async (analysisDirectory) => {
	// NiCad needs a POSIX path, so translate the Windows location with wslpath.
	const absoluteCodePath = path.resolve(analysisDirectory);
	const wslCodePath = shell.exec(`wsl wslpath -u "${absoluteCodePath}"`, { silent: true }).stdout.trim();

	// NiCad names every artifact after the basename of the analyzed directory.
	const systemName = path.basename(absoluteCodePath);

	// NiCad only reads configurations from its own lib directory, so install the
	// bundled one there before running. NiCad parses the file line by line and
	// would read a trailing CR as part of each value, so force LF endings.
	const dirname = path.dirname(fileURLToPath(import.meta.url));
	const configPath = path.join(dirname, "utils", `${CONFIG_NAME}.cfg`);
	const wslConfigPath = shell.exec(`wsl wslpath -u "${configPath}"`, { silent: true }).stdout.trim();
	const installedConfigPath = `${NICAD_DIRECTORY}/lib/nicad/config/${CONFIG_NAME}.cfg`;
	shell.exec(`wsl -e bash -lc "cp '${wslConfigPath}' ${installedConfigPath} && sed -i 's/\\r$//' ${installedConfigPath}"`, { silent: true });

	// Expects nicadclones/ to have been cleared beforehand.
	const command = `wsl -e bash -lc "cd ${NICAD_DIRECTORY} && ./bin/nicad ${GRANULARITY} java '${wslCodePath}' ${CONFIG_NAME}"`;
	const proc = shell.exec(command, { silent: true });

	// Results live under ~/Open-NiCad/nicadclones; reach them from Windows via
	// the UNC path that wslpath reports. NiCad encodes the configured renaming
	// and normalization in the directory name, so match it by suffix rather than
	// rebuilding it from the configuration.
	const nicadClonesPath = shell.exec(`wsl -e bash -lc "wslpath -w ${NICAD_DIRECTORY}/nicadclones"`, { silent: true }).stdout.trim();
	const systemPath = path.join(nicadClonesPath, systemName);
	const resultsDirectory = path.join(
		systemPath,
		fs.readdirSync(systemPath).find((entry) => entry.startsWith(`${systemName}_${GRANULARITY}`) && entry.endsWith("-clones")),
	);

	// NiCad embeds the threshold in the file name, so select the clone-classes
	// report by its suffix instead of rebuilding the name.
	const classesFile = fs.readdirSync(resultsDirectory).find((file) => file.endsWith("-classes.xml"));
	const nicadLogFilePath = path.join(resultsDirectory, classesFile);

	// Read the clone-classes report NiCad produced and parse it into a JS object.
	const violFile = fs.readFileSync(nicadLogFilePath, { encoding: "utf8", flag: "r" });
	const parser = new xml2js.Parser();
	const data = await parser.parseStringPromise(violFile);

	const codeClones = [];
	const classes = data?.clones?.class;

	let duplicateLOC = 0;
	let duplicateInstances = 0;
	const duplicateFiles = new Set();

	if (classes) {
		for (const cloneClass of classes) {
			// Each <class> groups the occurrences of one near-miss clone.
			const files = [];
			for (const instance of cloneClass.source) {
				// NiCad reports paths inside its own working copy of the sources
				// ("nicadclones/<system>/<system>/..."); drop that prefix so the
				// path points back at the original file.
				const relativePath = instance?.$?.file.split("/").slice(3).join("/");
				const startLine = instance?.$?.startline;
				const endLine = instance?.$?.endline;

				files.push({
					filePath: path.resolve(absoluteCodePath, relativePath),
					start_line: startLine,
					end_line: endLine,
				});

				duplicateLOC += (Number.parseInt(endLine, 10) - Number.parseInt(startLine, 10)) + 1;
				duplicateInstances += 1;
				duplicateFiles.add(relativePath);
			}

			codeClones.push({
				// Number of locations where this clone appears.
				clone_instances: files.length,
				// Size of the clone in lines, derived from the first instance's range.
				clone_loc: Math.abs(Number.parseInt(files[0].end_line, 10) - Number.parseInt(files[0].start_line, 10)),
				files,
			});
		}
	}

	return {
		proc,
		general_info: {
			duplicate_instances: duplicateInstances,
			duplicate_loc: duplicateLOC,
			classes_containing_clones: duplicateFiles.size,
		},
		code_clones: codeClones,
	};
};

export default nicadAnalysis;
