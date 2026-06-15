/**
 * Rules for the /source demo file tree and for blocking sensitive reads on /source/file.
 */

export const SOURCE_SKIP_DIR_NAMES = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'build',
	'.venv',
	'.output',
	'.logs',
	'.vercel',
	'.netlify',
	'.wrangler',
	'.cursor',
	'.playwright'
]);

/** Extensions shown in the /source tree (text / config / infra). */
export const SOURCE_TEXT_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.svelte',
	'.js',
	'.jsx',
	'.cjs',
	'.mjs',
	'.json',
	'.css',
	'.html',
	'.py',
	'.md',
	'.yaml',
	'.yml',
	'.sh',
	'.txt',
	'.template',
	'.toml',
	'.graphql',
	'.xml',
	'.svg'
]);

const BACKEND_EXTRA_FILES = new Set(['requirements.txt', '.env.template']);

const ROOT_NAME_ALLOW = new Set([
	'.env.example',
	'.env.template',
	'.gitignore',
	'.dockerignore',
	'.prettierignore',
	'.editorconfig',
	'AGENTS.md',
	'README.md',
	'LICENSE',
	'LICENSE.md',
	'Makefile'
]);

/** Dot-directories we still traverse (others starting with "." are skipped). */
export const SOURCE_DOT_DIR_ALLOW = new Set(['.github']);

/** Block reading these via /source/file even if they appeared on disk (e.g. mis-copy). */
export function isForbiddenSourceRead(relPosix: string): boolean {
	const norm = relPosix.replace(/\\/g, '/');
	if (norm.includes('/node_modules/') || norm.startsWith('node_modules/')) return true;
	const base = norm.split('/').pop() ?? '';
	if (base === '.env' || base === 'secret-generator.env') return true;
	if (base === '.npmrc') return true;
	if (base.startsWith('.env') && base !== '.env.example' && base !== '.env.template') return true;
	if (base.endsWith('.pem') || base.endsWith('.key')) return true;
	return false;
}

export function shouldListSourceFile(relPosix: string, fileName: string): boolean {
	const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
	const inBackend = relPosix.startsWith('backend/');
	if (ROOT_NAME_ALLOW.has(fileName)) return true;
	if (fileName.startsWith('Dockerfile')) return true;
	if (SOURCE_TEXT_EXTENSIONS.has(ext)) return true;
	if (inBackend && BACKEND_EXTRA_FILES.has(fileName)) return true;
	return false;
}
