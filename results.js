/**
 * Normalizes raw Simian analysis output into the stable duplication-report
 * shape consumed by the rest of the pipeline.
 *
 * @param {object} results - Raw output from simianAnalysis(), or a legacy format
 *   (jsinspect / duplicates / duplication keys are supported for backwards
 *   compatibility with older runs).
 * @returns {object} {
 *   general_info: { duplicate_instances, duplicate_loc, classes_containing_clones },
 *   code_clones:  [{ clone_instances, clone_loc, files: [{ filePath, start_line, end_line }] }]
 * }
 */
const duplicationResultsAnalysis = (results) => {
	const info = {
		general_info: {
			duplicate_instances: results.duplicateInstances,
			duplicate_loc: results.duplicateLOC,
			classes_containing_clones: results.duplicateFileCount,
		},
		code_clones: [],
	};

	// Backwards compatibility: older pipeline runs stored clone data under
	// different property names (jsinspect, duplicates, duplication).
	const clonesData = results?.cloneInfo ?? results.jsinspect ?? results?.duplicates ?? results?.duplication;

	// Note: to raise the minimum clone size beyond Simian's -threshold value,
	// set that flag to the desired line count instead of filtering here.
	for (const el of clonesData) {
		// Collect one file entry per instance (occurrence) of this clone group.
		const files = [];
		for (const el2 of el.instances) {
			files.push({
				filePath: el2.path,
				start_line: el2.lines[0],
				end_line: el2.lines[1],
			});
		}

		info.code_clones.push({
			// Number of locations where this identical block appears.
			clone_instances: el.instances.length,
			// Size of the clone in lines, derived from the first instance's range.
			clone_loc: Math.abs(Number.parseInt(el.instances[0].lines[1], 10) - Number.parseInt(el.instances[0].lines[0], 10)),
			files,
		});
	}

	return info;
};

export default duplicationResultsAnalysis;
