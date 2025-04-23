const { Router } = require('express');
const router = Router();
const marked = require('marked');
const fs = require('node:fs/promises');
const path = require('node:path');

const PATHS = {
	GENERATED: path.join(__dirname, '..', '..', '..', 'blocklists', 'generated'),
	LOGS: path.join(__dirname, '..', '..', 'public', 'logs'),
	DOCS: path.join(__dirname, '..', '..', '..', 'docs'),
};

const FILE_CACHE = new Map();
const FILE_EXISTENCE_CACHE = new Map();
const CACHE_EXPIRATION_TIME = 5 * 60 * 60 * 1000;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.conf', '.log', '.md']);

const formatFileSize = bytes => {
	if (bytes === 0) return 'Empty';
	const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), SIZE_UNITS.length - 1);
	return `${(bytes / 1000 ** exponent).toFixed(2)} ${SIZE_UNITS[exponent]}`;
};

const getFileIcon = (fileName, isDirectory) =>
	isDirectory ? 'open-folder.png'
		: TEXT_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) ? 'word.png'
			: 'unknown-file.png';

const getDirectorySize = async dirPath => {
	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	const sizes = await Promise.all(entries.map(async entry => {
		const fullPath = path.join(dirPath, entry.name);
		return entry.isDirectory() ? await getDirectorySize(fullPath) : (await fs.stat(fullPath)).size;
	}));
	return sizes.reduce((sum, size) => sum + size, 0);
};

const getCachedFiles = async (dirPath, validExtensions = []) => {
	const now = Date.now();
	const cached = FILE_CACHE.get(dirPath);
	if (cached && now - cached.timestamp < CACHE_EXPIRATION_TIME) return cached.data;

	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	const fileList = await Promise.all(
		entries
			.filter(entry => {
				const name = entry.name?.trim();
				if (!name || name.startsWith('.')) return false;
				if (!entry.isDirectory()) {
					const ext = path.extname(name).toLowerCase();
					if (!ext || !validExtensions.includes(ext)) return false;
				}
				return true;
			})
			.map(async entry => {
				const name = entry.name;
				const fullPath = path.join(dirPath, name);
				const stats = await fs.stat(fullPath);
				const isDir = entry.isDirectory();
				const size = isDir ? await getDirectorySize(fullPath) : stats.size;

				return { name, isDirectory: isDir, size, lastModified: stats.mtime.getTime(), icon: getFileIcon(name, isDir), formattedSize: formatFileSize(size) };
			})
	);

	fileList.sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);
	FILE_CACHE.set(dirPath, { data: fileList, timestamp: now });
	return fileList;
};

const extractMatch = (regex, content) => regex.exec(content)?.[1] ?? null;

const handleRequest = async (req, res, baseDir, basePath, validExtensions, template) => {
	const relative = (req.params[0] || '').replace(/\/$/, '');
	const filePath = path.join(baseDir, relative);

	try {
		const now = Date.now();
		let stats = FILE_EXISTENCE_CACHE.get(filePath);
		if (!stats || now - stats.timestamp >= CACHE_EXPIRATION_TIME) {
			stats = { stats: await fs.stat(filePath), timestamp: now };
			FILE_EXISTENCE_CACHE.set(filePath, stats);
		}

		const fileStats = stats.stats;
		if (fileStats.isFile() && validExtensions.includes(path.extname(filePath))) return res.sendFile(filePath);

		if (fileStats.isDirectory()) {
			const files = await getCachedFiles(filePath, validExtensions);
			const currentPath = path.join(basePath, relative).replace(/\\/g, '/');
			return res.render(template, { files, currentPath });
		}

		if (relative.endsWith('.md')) {
			const md = await fs.readFile(filePath, 'utf-8');
			return res.render('markdown-viewer.ejs', {
				html: marked.parse(md),
				title: extractMatch(/#\s(.+)/, md),
				desc: extractMatch(/<!--\s*desc:\s*(.+?)\s*-->/, md),
				tags: extractMatch(/<!--\s*tags:\s*(.+?)\s*-->/, md),
				canonical: extractMatch(/<!--\s*canonical:\s*(.+?)\s*-->/, md),
			});
		}

		res.sendFile(filePath);
	} catch (err) {
		res.status(err.code === 'ENOENT' ? 404 : 500).end();
	}
};

// Routes
router.get(/^\/generated\/v1(.*)$/, (req, res) => handleRequest(req, res, PATHS.GENERATED, '/generated/v1', ['.txt', '.conf'], 'explorer/file.ejs'));
router.get(/^\/logs\/v1(.*)$/, (req, res) => handleRequest(req, res, PATHS.LOGS, '/logs/v1', ['.log'], 'explorer/log.ejs'));
router.get(/^\/markdown(.*)$/, (req, res) => handleRequest(req, res, PATHS.DOCS, '/markdown', ['.md'], 'explorer/markdown.ejs'));

module.exports = router;