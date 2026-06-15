
import fs from "node:fs";
import path from "node:path";

import shell from "shelljs";
import { globby } from "globby";

/**
 * Normalizes two file paths to a common format (forward-slashes, no leading or
 * trailing slashes) and checks whether they refer to the same location.
 * This prevents false mismatches caused by platform path differences.
 *
 * @param {string} path1
 * @param {string} path2
 * @returns {boolean}
 */
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

/**
 * Recursively globs all files under `dir` and buckets them by programming
 * language, applying skip rules for explicitly excluded paths, minified
 * bundles, and /static/ assets.
 *
 * @param {string}   dir            - Root directory to scan.
 * @param {string[]} filesToExclude - List of file paths to omit from results.
 * @returns {Promise<object>} Files grouped by language:
 *   { csharp, dart, java, javascript, kotlin, php, python, typescript, vue }
 */
const findFilePaths = async (dir, filesToExclude = []) => {
	const allFiles = await globby(`${dir}/**/*`, { dot: true });

	const files = allFiles.reduce((acc, file) => {
		// Skip any path that matches an entry in the exclusion list.
		if (filesToExclude.some((fExclude) => comparePaths(file, fExclude, dir))) {
			return acc;
		}

		// C# files
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

		// JavaScript files — skip minified bundles and /static/ assets
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

		// PHP files (XML is grouped here as it often accompanies PHP projects)
		if (file.endsWith(".php") || file.endsWith(".xml")) {
			acc.php.push(file);
		}

		// Python files
		if (file.endsWith(".py")) {
			acc.python.push(file);
		}

		// TypeScript files — skip minified bundles and /static/ assets
		if (
			(file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".mts"))
			&& (!file.endsWith(".min.ts") && !file.replace(dir, "").includes("/static/"))
		) {
			acc.typescript.push(file);
		}

		// Vue single-file components
		if (file.endsWith(".vue")) {
			acc.vue.push(file);
		}

		return acc;
	}, { csharp: [], dart: [], java: [], javascript: [], kotlin: [], php: [], python: [], typescript: [], vue: [] });

	return files;
};

/**
 * Counts lines of code for the Java files in `analysisDirectory` using the
 * external `cloc` CLI tool.
 *
 * Side effects: writes two temporary files inside `analysisDirectory`:
 *   - simian_files.txt   — newline-separated list of Java file paths fed to cloc
 *   - simian_CDreport.json — cloc's raw JSON output
 *   - simian_prepCD.txt  — cloc's stdout/stderr log
 *
 * @param {string} analysisDirectory - Directory whose Java files are measured.
 * @returns {Promise<{LOC: number, LLOC: number}>}
 *   LOC  = blank + comment + code (total physical lines)
 *   LLOC = code only (logical lines of code)
 */
const calculateLoc = async (analysisDirectory) => {
	const { java: javaFiles } = await findFilePaths(analysisDirectory);

	// Build a newline-separated file list for cloc.
	// On Windows, paths must be absolute; on POSIX, cloc expects paths relative
	// to the working directory (analysisDirectory).
	let allJavaFiles = "";
	if (process.platform === "win32") {
		allJavaFiles = javaFiles.reduce((acc, cur) => `${acc}${cur.replace(/^\//, "")}\n`, "");
	} else {
		for (const file of javaFiles) {
			allJavaFiles += `${path.relative(path.normalize(analysisDirectory).replaceAll("\\", "/").replace(/\/$/, "").replace(/^\//, ""), file.replace(/^\//, ""))}\n`;
		}
	}

	// Write the file list so cloc can consume it with --list-file.
	fs.writeFileSync(path.join(analysisDirectory, "simian_files.txt"), allJavaFiles);

	const cdlog = path.join(analysisDirectory, "simian_prepCD.txt");
	// Run cloc in JSON mode; --by-file emits per-file rows plus a SUM entry.
	const command = `cloc . --list-file="${path.join(analysisDirectory, "simian_files.txt")}" --by-file --json --skip-uniqueness --out="${path.join(analysisDirectory, "simian_CDreport.json")}" --quiet`;
	shell.exec(command, { silent: true, cwd: analysisDirectory }).to(cdlog);

	// Read the SUM totals from cloc's JSON output.
	const { SUM: { code, comment, blank } } = JSON.parse(fs.readFileSync(`${path.join(analysisDirectory, "simian_CDreport.json")}`));

	const LOC = blank + comment + code; // Total physical lines (all categories)
	const LLOC = code;                  // Logical lines (executable code only)

	return {
		LOC,
		LLOC,
	};
};

export default calculateLoc;
