import type { FileNode } from '$lib/source-tree-node';
import {
	SOURCE_DOT_DIR_ALLOW,
	SOURCE_SKIP_DIR_NAMES,
	shouldListSourceFile
} from '$lib/source-view-policy';
import { readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

const ROOT = process.cwd();

async function walk(dir: string, base = ''): Promise<FileNode[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const nodes: FileNode[] = [];

	for (const e of entries) {
		if (SOURCE_SKIP_DIR_NAMES.has(e.name)) continue;
		if (e.isDirectory() && e.name.startsWith('.') && !SOURCE_DOT_DIR_ALLOW.has(e.name)) continue;

		const rel = base ? `${base}/${e.name}` : e.name;
		const full = join(dir, e.name);

		if (e.isDirectory()) {
			const children = await walk(full, rel);
			if (children.length) nodes.push({ name: e.name, path: rel, children });
		} else if (e.isFile()) {
			if (shouldListSourceFile(rel, e.name)) nodes.push({ name: e.name, path: rel });
		}
	}

	return nodes.sort((a, b) => {
		const aIsDir = 'children' in a && a.children;
		const bIsDir = 'children' in b && b.children;
		if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

function safePath(input: string): string | null {
	const normalized = resolve(ROOT, input).replace(/\\/g, '/');
	const root = ROOT.replace(/\\/g, '/');
	if (!normalized.startsWith(root) || normalized === root) return null;
	return relative(ROOT, normalized).replace(/\\/g, '/');
}

export async function load() {
	const files = await walk(ROOT);
	return { files };
}
