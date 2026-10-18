import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import {
	CHANGED_SYSTEM,
	WHOLE_SYSTEM,
	blocksDbPath,
	toSystemRelativePath,
} from "./nicad-common.js";

// Name of the extraction database copied out of NiCad after a full run and
// reused, unchanged files and all, by the next incremental run.
const CACHE_FILE = "extraction-nicad.xml";

// NiCad labels every extracted block with the path it was found at, i.e.
// "nicadclones/<system>/<system>/<relative path>". The reused database must
// carry the whole-project cross-run's system name so NiCad treats it as its own.
const WHOLE_PREFIX = `nicadclones/${WHOLE_SYSTEM}/${WHOLE_SYSTEM}/`;

/**
 * Returns a writer that honors backpressure, so a database larger than V8's
 * maximum string length can be streamed out without being held in memory.
 *
 * @param {import("node:fs").WriteStream} stream
 * @returns {(chunk: string) => Promise<void>}
 */
const backpressuredWriter = (stream) => (chunk) => new Promise((written) => {
	if (stream.write(chunk)) written();
	else stream.once("drain", written);
});

/**
 * Streams a NiCad blocks database, keeping only the blocks of selected files and
 * rewriting each block's recorded path.
 *
 * NiCad stores the database as a flat sequence of
 *   <source file="..." startline="..." endline="...">
 *   ...block source...
 *   </source>
 * groups, with the markers on their own lines and the body left as raw source
 * (not XML-escaped). It is read a line at a time, holding at most a single block
 * (bounded by the configured maxsize) rather than the whole document.
 *
 * @param {object} params
 * @param {string} params.sourcePath - Database to read.
 * @param {(chunk: string) => Promise<void>} params.writeChunk - Backpressured writer.
 * @param {string} params.prefix - Prefix to prepend to each block's relative path.
 * @param {(relativePath: string) => boolean} params.keep - Whether to carry a block over.
 * @returns {Promise<void>}
 */
const transformBlocksDb = ({ sourcePath, writeChunk, prefix, keep }) => new Promise((resolve, reject) => {
	const input = fs.createReadStream(sourcePath, { encoding: "utf8" });
	const lines = readline.createInterface({ input, crlfDelay: Infinity });

	let block = null;
	let chain = Promise.resolve();
	const enqueue = (text) => { chain = chain.then(() => writeChunk(text)); };

	lines.on("line", (line) => {
		if (line.startsWith("<source ")) {
			const match = line.match(/file="([^"]*)"/);
			const relativePath = match ? toSystemRelativePath(match[1]) : "";
			const header = line.replace(/file="[^"]*"/, `file="${prefix}${relativePath}"`);
			block = { relativePath, lines: [header] };
		} else if (line.trim() === "</source>") {
			if (block) {
				block.lines.push(line);
				if (keep(block.relativePath)) enqueue(`${block.lines.join("\n")}\n`);
				block = null;
			} else {
				enqueue(`${line}\n`);
			}
		} else if (block) {
			block.lines.push(line);
		} else {
			enqueue(`${line}\n`);
		}
	});

	input.on("error", reject);
	lines.on("error", reject);
	lines.on("close", () => { chain.then(resolve).catch(reject); });
});

/**
 * Finalizes a write stream, resolving once its buffered contents are flushed.
 *
 * @param {import("node:fs").WriteStream} stream
 * @returns {Promise<void>}
 */
const endStream = (stream) => new Promise((resolve, reject) => {
	stream.on("error", reject);
	stream.end(resolve);
});

/**
 * Whether a reusable extraction database from a previous full run is present.
 *
 * @param {string} resultsPath
 * @returns {boolean}
 */
const extractionCacheExists = (resultsPath) => fs.existsSync(path.join(resultsPath, CACHE_FILE));

/**
 * Copies the blocks NiCad extracted during a full run out of its working
 * directory, so the next incremental run can reuse them instead of re-parsing
 * the whole project.
 *
 * The recorded paths are normalized to be relative to the project root, so the
 * database does not depend on the system name the full run happened to use.
 *
 * @param {object} params
 * @param {string} params.systemName  - Name NiCad derived from the analyzed directory.
 * @param {string} params.resultsPath - Directory to write "extraction-nicad.xml" into.
 * @returns {Promise<void>}
 */
const saveExtractionCache = async ({ systemName, resultsPath }) => {
	const destination = fs.createWriteStream(path.join(resultsPath, CACHE_FILE), { encoding: "utf8" });

	await transformBlocksDb({
		sourcePath: blocksDbPath(systemName),
		writeChunk: backpressuredWriter(destination),
		prefix: "",
		keep: () => true,
	});

	await endStream(destination);
};

/**
 * Reconstructs the whole-project extraction database for the new version without
 * re-parsing anything that did not change, and seeds it into NiCad's working
 * directory so the cross run skips extracting the whole project.
 *
 * The result is the extraction NiCad would have produced from scratch: unchanged
 * files come from the cached database, while changed and added files come from a
 * fresh extraction of the changed set. Deleted files are left out. Clone
 * detection sorts blocks itself, so the order in which the two sources are
 * concatenated does not affect the pairs found.
 *
 * @param {object} params
 * @param {string} params.resultsPath - Directory holding "extraction-nicad.xml".
 * @param {Set<string>} params.changedFiles - Project-relative paths the commit touched.
 * @param {Set<string>} params.currentFiles - Project-relative paths that exist after the commit.
 * @returns {Promise<void>}
 */
const seedWholeExtraction = async ({ resultsPath, changedFiles, currentFiles }) => {
	const seedPath = blocksDbPath(WHOLE_SYSTEM);
	fs.mkdirSync(path.dirname(seedPath), { recursive: true });

	const seed = fs.createWriteStream(seedPath, { encoding: "utf8" });
	const writeChunk = backpressuredWriter(seed);

	// Unchanged files still present after the commit: reuse the cached blocks.
	await transformBlocksDb({
		sourcePath: path.join(resultsPath, CACHE_FILE),
		writeChunk,
		prefix: WHOLE_PREFIX,
		keep: (relativePath) => currentFiles.has(relativePath) && !changedFiles.has(relativePath),
	});

	// Changed and added files: take the freshly extracted blocks instead.
	await transformBlocksDb({
		sourcePath: blocksDbPath(CHANGED_SYSTEM),
		writeChunk,
		prefix: WHOLE_PREFIX,
		keep: (relativePath) => currentFiles.has(relativePath) && changedFiles.has(relativePath),
	});

	await endStream(seed);
};

export { extractionCacheExists, saveExtractionCache, seedWholeExtraction };
