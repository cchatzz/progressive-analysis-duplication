
import fs from "node:fs";
import path from "node:path";

import shell from "shelljs";
import { globby } from "globby";

const comparePaths = (path1, path2) => {
	const formattedPath1 = path.normalize(path1)
		.replaceAll("\\", "/")
		.replace(/\/$/, "")
		.replace(/^\//, "")
		.replace(/^.$/, "");
	const formattedPath2 = path.normalize(path2)
		.replaceAll("\\", "/")
		.replace(/\/$/, "")
		.replace(/^\//, "")
		.replace(/^.$/, "");

	return (formattedPath1 === formattedPath2);
};

const findFilePaths = async (dir, filesToExclude = []) => {
	const allFiles = await globby(`${dir}/**/*`, { dot: true });

	const files = allFiles.reduce((acc, file) => {
		// Exclude files
		if (filesToExclude.some((fExclude) => comparePaths(file, fExclude, dir))) {
			return acc;
		}

		// Csharp files
		if (file.endsWith(".cs")) {
			acc.csharp.push(file);
		}

		// Dart files
		if (file.endsWith(".dart")) {
			acc.dart.push(file);
		}

		// Java files
		if (file.endsWith(".java")) {
			acc.java.push(file);
		}

		// Javascript files
		if (
			(file.endsWith(".js") || file.endsWith(".jsx") || file.endsWith(".mjs"))
			&& (!file.endsWith(".min.js") && !file.replace(dir, "").includes("/static/"))
		) {
			acc.javascript.push(file);
		}

		// Kotlin files
		if (file.endsWith(".kt")) {
			acc.kotlin.push(file);
		}

		// PHP files
		if (file.endsWith(".php") || file.endsWith(".xml")) {
			acc.php.push(file);
		}

		// Python files
		if (file.endsWith(".py")) {
			acc.python.push(file);
		}

		if (
			(file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".mts"))
			&& (!file.endsWith(".min.ts") && !file.replace(dir, "").includes("/static/"))
		) {
			acc.typescript.push(file);
		}

		if (file.endsWith(".vue")) {
			acc.vue.push(file);
		}

		return acc;
	}, { csharp: [], dart: [], java: [], javascript: [], kotlin: [], php: [], python: [], typescript: [], vue: [] });

	return files;
};

const calculateLoc = async (analysisDirectory) => {
	const { java: javaFiles } = await findFilePaths(analysisDirectory);
	let allJavaFiles = "";
	if (process.platform === "win32") {
		allJavaFiles = javaFiles.reduce((acc, cur) => `${acc}${cur.replace(/^\//, "")}\n`, "");
	} else {
		for (const file of javaFiles) {
			allJavaFiles += `${path.relative(path.normalize(analysisDirectory).replaceAll("\\", "/").replace(/\/$/, "").replace(/^\//, ""), file.replace(/^\//, ""))}\n`;
		}
	}

	fs.writeFileSync(path.join(analysisDirectory, "simian_files.txt"), allJavaFiles);
	const cdlog = path.join(analysisDirectory, "simian_prepCD.txt");
	const command = `cloc . --list-file="${path.join(analysisDirectory, "simian_files.txt")}" --by-file --json --skip-uniqueness --out="${path.join(analysisDirectory, "simian_CDreport.json")}" --quiet`;
	shell.exec(command, { silent: true, cwd: analysisDirectory }).to(cdlog);

	const { SUM: { code, comment, blank } } = JSON.parse(fs.readFileSync(`${path.join(analysisDirectory, "simian_CDreport.json")}`));

	const LOC = blank + comment + code;
	const LLOC = code;

	return {
		LOC,
		LLOC,
	};
};

export default calculateLoc;
