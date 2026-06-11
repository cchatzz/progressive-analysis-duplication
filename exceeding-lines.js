const ensureNonExceedingEndLines = (duplicationInfo, analysisDirectory) => {
	for (const [index, instance] of duplicationInfo.code_clones.entries()) {
		duplicationInfo.code_clones[index].index = index;
		for (const [findex, f] of instance.files.entries()) {
			const file = fs.readFileSync(path.join(analysisDirectory, f.filePath), { encoding: "utf8", flag: "r" });
			const numLines = file.split("\n").length;
			duplicationInfo.code_clones[index].files[findex].end_line = Math.min(
				duplicationInfo.code_clones[index].files[findex].end_line, numLines,
			).toString();
		}
	}

	return duplicationInfo;
};

export default ensureNonExceedingEndLines;
