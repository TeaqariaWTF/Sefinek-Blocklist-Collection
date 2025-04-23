const { readdir, readFile, writeFile } = require('node:fs/promises');
const { join, relative } = require('node:path');

const loadWhitelist = async whitelistPath => {
	const content = await readFile(whitelistPath, 'utf8');
	const whitelistMap = new Map();

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const [domain, file] = trimmed.split(' ').map(s => s.trim());
		if (!domain) continue;

		const key = file ? file.replace(/\\/g, '/') : '*';
		const domainSet = whitelistMap.get(key) || new Set();
		domainSet.add(domain);
		whitelistMap.set(key, domainSet);
	}

	return whitelistMap;
};

const processDirectory = async (dirPath, whitelist, basePath) => {
	const entries = await readdir(dirPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = join(dirPath, entry.name);

		if (entry.isDirectory()) {
			await processDirectory(fullPath, whitelist, basePath);
			continue;
		}

		if (!entry.name.endsWith('.txt')) continue;

		const relativePath = relative(basePath, fullPath).replace(/\\/g, '/').replace(/^templates\//, '');
		const content = await readFile(fullPath, 'utf8');
		const lines = content.split('\n');

		const seen = new Set();
		let domainsRemoved = 0;

		const filtered = lines.filter(originalLine => {
			const line = originalLine.trim();
			if (!line || line.startsWith('#') || line.startsWith('!')) return true;

			const cleanLine = line.split('#')[0].trim();
			const domain = cleanLine.replace(/^(0\.0\.0\.0|127\.0\.0\.1)\s+/, '');

			if (seen.has(domain)) return false;
			seen.add(domain);

			const global = whitelist.get('*');
			const fileSpecific = whitelist.get(relativePath);

			if ((global && global.has(domain)) || (fileSpecific && fileSpecific.has(domain))) {
				domainsRemoved++;
				return false;
			}

			return true;
		});

		if (domainsRemoved > 0) {
			await writeFile(fullPath, filtered.join('\n'), 'utf8');
			console.log(`🗑️ ${domainsRemoved} domains removed from ${fullPath}`);
		}
	}
};

(async () => {
	try {
		const whitelist = await loadWhitelist(join(__dirname, '..', 'whitelists', 'main.txt'));

		const basePath = join(__dirname, '..', 'blocklists');
		await processDirectory(join(basePath, 'templates'), whitelist, basePath);
	} catch (err) {
		console.error(err);
	}
})();