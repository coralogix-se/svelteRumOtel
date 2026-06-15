import { isForbiddenSourceRead } from '$lib/source-view-policy';
import { readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

const ROOT = process.cwd();

function safePath(input: string): string | null {
	const normalized = resolve(ROOT, input).replace(/\\/g, '/');
	const root = ROOT.replace(/\\/g, '/');
	if (!normalized.startsWith(root) || normalized === root) return null;
	return relative(ROOT, normalized).replace(/\\/g, '/');
}

export async function GET({ url }) {
	const pathParam = url.searchParams.get('path');
	if (!pathParam) {
		return new Response('Missing path', { status: 400 });
	}
	const safe = safePath(pathParam);
	if (!safe) {
		return new Response('Invalid path', { status: 403 });
	}
	if (isForbiddenSourceRead(safe)) {
		return new Response('Forbidden', { status: 403 });
	}
	try {
		const content = await readFile(join(ROOT, safe), 'utf-8');
		return new Response(content, {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8'
			}
		});
	} catch (err) {
		return new Response('File not found', { status: 404 });
	}
}
