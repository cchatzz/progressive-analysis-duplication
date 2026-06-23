import fs from "node:fs";
import path from "node:path";

/**
 * Ensures that no clone entry references a line number beyond the end of its
 * source file. Simian can occasionally report an end_line that exceeds the
 * actual file length; this function clamps it to the real line count.
 *
 * Also tags each clone group with its zero-based `index` in the code_clones
 * array, which downstream consumers use for cross-referencing.
 *
 * @param {object} duplicationInfo   - Normalized report with a code_clones[] array.
 * @param {string} analysisDirectory - Base directory used to resolve relative file paths.
 * @returns {object} The mutated duplicationInfo (modified in-place).
 */
const ensureNonExceedingEndLines = (duplicationInfo, analysisDirectory) => {
	for (const [index, instance] of duplicationInfo.code_clones.entries()) {
		// Attach the clone's position in the list for downstream reference.
		duplicationInfo.code_clones[index].index = index;

		for (const [findex, f] of instance.files.entries()) {
			// Read the actual source file to determine its true line count.
			const file = fs.readFileSync(path.join(analysisDirectory, f.filePath), { encoding: "utf8", flag: "r" });
			const numLines = file.split("\n").length;

			// Clamp end_line: use the smaller of the reported value and the real
			// file length so line-range consumers never go out of bounds.
			duplicationInfo.code_clones[index].files[findex].end_line = Math.min(
				duplicationInfo.code_clones[index].files[findex].end_line, numLines,
			).toString();
		}
	}

	return duplicationInfo;
};

export default ensureNonExceedingEndLines;
