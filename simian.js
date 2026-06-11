import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import shell from "shelljs";
import xml2js from "xml2js";

const simianAnalysis = async (analysisDirectory) => {
	const {
		JAVA_17_PATH: java17Path,
	} = process.env;

	const dirname = path.dirname(fileURLToPath(import.meta.url));
	const simianPath = path.join(dirname, "utils", "simian-4.0.0.jar");
	const simianLogFilePath = `${analysisDirectory}/simian-log.xml`;

	const filesPattern = `-includes=${analysisDirectory}/**/*.java`;

	// create cli command to run simian analysis
	const command = `"${java17Path}" -jar "${simianPath}" -threshold=15 -failOnDuplication- -formatter=xml:${simianLogFilePath} ${filesPattern}`;
	const proc = shell.exec(command, { silent: true });

	// read simian analysis output from an xlm file
	// and translate the results to a json file
	const violFile = fs.readFileSync(simianLogFilePath, { encoding: "utf8", flag: "r" });
	const parser = new xml2js.Parser();
	const data = await parser.parseStringPromise(violFile);
	const cloneInfo = [];
	const set = data?.simian?.check[0]?.set;
	const duplicateLOC = Number.parseInt(data?.simian?.check[0]?.summary[0]?.$?.duplicateLineCount, 10);
	const duplicateInstances = Number.parseInt(data?.simian?.check[0]?.summary[0]?.$?.duplicateBlockCount, 10);
	const duplicateFileCount = Number.parseInt(data?.simian?.check[0]?.summary[0]?.$?.duplicateFileCount, 10);
	if (set) {
		for (const duplicate of set) {
			// format instances to be compatible with jscpd analyses results
			const instances = [];
			for (const instance of duplicate.block) {
				instances.push({
					path: instance?.$?.sourceFile,
					lines: [instance?.$?.startLineNumber, instance?.$?.endLineNumber],
				});
			}

			if (instances.length > 1) cloneInfo.push({ instances });
		}
	}

	return { proc, cloneInfo, duplicateLOC, duplicateInstances, duplicateFileCount };
};

export default simianAnalysis;
