/**
 * Builds a stable identity for one clone block, used as the union-find node key.
 *
 * @param {object} block - { filePath, start_line, end_line }
 * @returns {string}
 */
const blockKey = ({ filePath, start_line, end_line }) => `${filePath}:${start_line}-${end_line}`;

/**
 * Builds an order-independent identity for a clone pair, so that a pair and its
 * mirror collapse into a single entry.
 *
 * @param {object} pair - { files: [block, block] }
 * @returns {string}
 */
const pairKey = ({ files }) => [blockKey(files[0]), blockKey(files[1])].sort().join("|");

/**
 * Removes mirrored and repeated clone pairs.
 *
 * @param {object[]} pairs
 * @returns {object[]} The first occurrence of each distinct pair.
 */
const dedupePairs = (pairs) => {
	const seen = new Map();
	for (const pair of pairs) {
		const key = pairKey(pair);
		if (!seen.has(key)) seen.set(key, pair);
	}

	return [...seen.values()];
};

/**
 * Groups clone pairs into clone classes and derives the report-level counters.
 *
 * NiCad clusters pairs into classes by transitive closure, so the same grouping
 * is reproduced here with union-find. Running both the full and the incremental
 * mode through this function is what makes their outputs comparable.
 *
 * @param {object[]} clonePairs - [{ similarity, files: [block, block] }]
 * @returns {object} {
 *   general_info: { duplicate_instances, duplicate_loc, classes_containing_clones },
 *   code_clones:  [{ index, clone_instances, clone_loc, files: [block] }],
 *   clone_pairs:  the deduplicated input pairs
 * }
 */
const clusterClonePairs = (clonePairs) => {
	const pairs = dedupePairs(clonePairs);

	const parents = new Map();
	const blocks = new Map();

	const find = (key) => {
		let root = key;
		while (parents.get(root) !== root) root = parents.get(root);

		// Path compression keeps repeated lookups flat on large pair sets.
		let current = key;
		while (parents.get(current) !== root) {
			const next = parents.get(current);
			parents.set(current, root);
			current = next;
		}

		return root;
	};

	const add = (block) => {
		const key = blockKey(block);
		if (!parents.has(key)) {
			parents.set(key, key);
			blocks.set(key, block);
		}

		return key;
	};

	for (const { files } of pairs) {
		const rootA = find(add(files[0]));
		const rootB = find(add(files[1]));
		if (rootA !== rootB) parents.set(rootA, rootB);
	}

	// Collect the members of every connected component.
	const components = new Map();
	for (const key of parents.keys()) {
		const root = find(key);
		if (!components.has(root)) components.set(root, []);
		components.get(root).push(blocks.get(key));
	}

	let duplicateLOC = 0;
	let duplicateInstances = 0;
	const duplicateFiles = new Set();
	const codeClones = [];

	// Sort so that equal clone sets always serialize identically, which is what
	// lets a full and an incremental run be compared directly.
	const sortBlocks = (a, b) => a.filePath.localeCompare(b.filePath)
		|| (Number.parseInt(a.start_line, 10) - Number.parseInt(b.start_line, 10));

	// Members are ordered first: classes are then ordered by their first member,
	// which is only stable once each class holds its own lowest block there.
	const cloneClasses = [...components.values()];
	for (const files of cloneClasses) files.sort(sortBlocks);
	cloneClasses.sort((a, b) => sortBlocks(a[0], b[0]));

	for (const files of cloneClasses) {
		for (const file of files) {
			duplicateLOC += (Number.parseInt(file.end_line, 10) - Number.parseInt(file.start_line, 10)) + 1;
			duplicateInstances += 1;
			duplicateFiles.add(file.filePath);
		}

		codeClones.push({
			index: codeClones.length,
			clone_instances: files.length,
			clone_loc: Math.abs(Number.parseInt(files[0].end_line, 10) - Number.parseInt(files[0].start_line, 10)),
			files,
		});
	}

	return {
		general_info: {
			duplicate_instances: duplicateInstances,
			duplicate_loc: duplicateLOC,
			classes_containing_clones: duplicateFiles.size,
		},
		code_clones: codeClones,
		clone_pairs: pairs,
	};
};

export { blockKey, clusterClonePairs };
export default clusterClonePairs;
