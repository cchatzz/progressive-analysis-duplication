const duplicationResultsAnalysis = (results) => {
	const info = {
		general_info: {
			duplicate_instances: results.duplicateInstances,
			duplicate_loc: results.duplicateLOC,
			classes_containing_clones: results.duplicateFileCount,
		},
		code_clones: [],
	};

	// This is required given that old results use jsinspect
	const clonesData = results?.cloneInfo ?? results.jsinspect ?? results?.duplicates ?? results?.duplication;

	// If we now want to show only duplicates with at least 25+ lines
	// we should directly set the simian threshold to the desired value.
	for (const el of clonesData) {
		const files = [];
		for (const el2 of el.instances) {
			files.push({
				filePath: el2.path,
				start_line: el2.lines[0],
				end_line: el2.lines[1],
			});
		}

		info.code_clones.push({
			clone_instances: el.instances.length,
			clone_loc: Math.abs(Number.parseInt(el.instances[0].lines[1], 10) - Number.parseInt(el.instances[0].lines[0], 10)),
			files,
		});
	}

	return info;
};

export default duplicationResultsAnalysis;
