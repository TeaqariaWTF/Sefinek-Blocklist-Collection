const { writeFile } = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { resolve } = require('node:path');
const readline = require('readline');
const getAllTxtFiles = require('./utils/getAllTxtFiles.js');

const formatCount = count => count.toLocaleString('en-US', { minimumIntegerDigits: 8, useGrouping: true }).replace(/,/g, ' ');

const createUpdatedContents = (lines, domainCount) => {
	const countText = domainCount?.toLocaleString('en-US') || 'Unknown';
	return lines.join('\n').replace(
		/^(#\s*)(Domains|Count|Entries|Number of entries|Number of unique domains|Total number of network filters)(:\s*)(\d*[\d,]*)$/im,
		(_, prefix, key, separator) => `${prefix}${key}${separator}${countText}`
	);
};

const countDomains = async file => {
	const lines = [];
	let domainCount = 0;

	const rl = readline.createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
	for await (const line of rl) {
		if (line.startsWith('0.0.0.0 ')) domainCount++;
		lines.push(line);
	}

	return { lines, domainCount };
};

const processFile = async file => {
	try {
		const { lines, domainCount } = await countDomains(file);
		const updatedContent = createUpdatedContents(lines, domainCount);
		await writeFile(file, updatedContent, 'utf8');

		console.log(`${formatCount(domainCount)} domains → ${file}`);
	} catch (err) {
		console.error(`Failed to process ${file}:`, err.message);
	}
};

(async () => {
	try {
		const files = await getAllTxtFiles(resolve(__dirname, '..', 'blocklists', 'templates'));
		await Promise.all(files.map(processFile));
	} catch (err) {
		console.error(err);
	}
})();