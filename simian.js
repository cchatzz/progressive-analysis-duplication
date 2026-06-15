import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import shell from "shelljs";
import xml2js from "xml2js";

/**
 * Runs the bundled Simian JAR against all .java files under `analysisDirectory`
 * and parses the resulting XML report into a normalized clone list.
 *
 * Requires the JAVA_17_PATH environment variable to point to a Java 17 binary.
 *
 * @param {string} analysisDirectory - Root directory to scan for Java sources.
 * @returns {Promise<object>} {
 *   proc              - shelljs child-process result,
 *   cloneInfo         - array of clone groups: [{ instances: [{ path, lines }] }],
 *   duplicateLOC      - total duplicated line count reported by Simian,
 *   duplicateInstances - total number of duplicate blocks,
 *   duplicateFileCount - number of files that contain at least one clone
 * }
 */
const simianAnalysis = async (analysisDirectory) => {
	// Java 17 runtime location supplied via environment variable.
	const {
		JAVA_17_PATH: java17Path,
	} = process.env;

	// Resolve the bundled Simian JAR path relative to this ES module.
	const dirname = path.dirname(fileURLToPath(import.meta.url));
	const simianPath = path.join(dirname, "utils", "simian-4.0.0.jar");

	// Simian will write its XML report to this file in the analysis directory.
	const simianLogFilePath = `${analysisDirectory}/simian-log.xml`;

	// Glob pattern passed to Simian to pick up every Java file recursively.
	const filesPattern = `-includes=${analysisDirectory}/**/*.java`;

	// Build the full Simian CLI command:
	//   -threshold=15         minimum block length (lines) to consider a clone
	//   -failOnDuplication-   suppress non-zero exit code when duplicates exist
	//   -formatter=xml:...    write results as XML to simianLogFilePath
	const command = `"${java17Path}" -jar "${simianPath}" -threshold=15 -failOnDuplication- -formatter=xml:${simianLogFilePath} ${filesPattern}`;
	const proc = shell.exec(command, { silent: true });

	// Read the XML report Simian produced and parse it into a JS object.
	const violFile = fs.readFileSync(simianLogFilePath, { encoding: "utf8", flag: "r" });
	const parser = new xml2js.Parser();
	const data = await parser.parseStringPromise(violFile);

	const cloneInfo = [];
	const set = data?.simian?.check[0]?.set;

	// Extract summary-level totals from the XML <summary> element's attributes.
	const duplicateLOC = Number.parseInt(data?.simian?.check[0]?.summary[0]?.$?.duplicateLineCount, 10);
	const duplicateInstances = Number.parseInt(data?.simian?.check[0]?.summary[0]?.$?.duplicateBlockCount, 10);
	const duplicateFileCount = Number.parseInt(data?.simian?.check[0]?.summary[0]?.$?.duplicateFileCount, 10);

	if (set) {
		for (const duplicate of set) {
			// Each <set> groups identical code blocks; collect every occurrence.
			const instances = [];
			for (const instance of duplicate.block) {
				instances.push({
					path: instance?.$?.sourceFile,
					lines: [instance?.$?.startLineNumber, instance?.$?.endLineNumber],
				});
			}

			// Only keep groups where the same block appears in more than one place.
			if (instances.length > 1) cloneInfo.push({ instances });
		}
	}

	return { proc, cloneInfo, duplicateLOC, duplicateInstances, duplicateFileCount };
};

export default simianAnalysis;
