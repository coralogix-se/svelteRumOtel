<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import SourceTree from './SourceTree.svelte';
	import hljs from 'highlight.js/lib/core';
	import typescript from 'highlight.js/lib/languages/typescript';
	import javascript from 'highlight.js/lib/languages/javascript';
	import json from 'highlight.js/lib/languages/json';
	import css from 'highlight.js/lib/languages/css';
	import xml from 'highlight.js/lib/languages/xml';
	import python from 'highlight.js/lib/languages/python';
	import 'highlight.js/styles/atom-one-dark.min.css';

	hljs.registerLanguage('typescript', typescript);
	hljs.registerLanguage('javascript', javascript);
	hljs.registerLanguage('json', json);
	hljs.registerLanguage('css', css);
	hljs.registerLanguage('xml', xml);
	hljs.registerLanguage('python', python);

	const EXT_TO_LANG: Record<string, string> = {
		'.ts': 'typescript',
		'.tsx': 'typescript',
		'.js': 'javascript',
		'.jsx': 'javascript',
		'.cjs': 'javascript',
		'.mjs': 'javascript',
		'.json': 'json',
		'.css': 'css',
		'.html': 'xml',
		'.svelte': 'xml',
		'.py': 'python',
		'.txt': 'plaintext'
	};

	function getLanguage(path: string): string {
		const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
		return EXT_TO_LANG[ext] ?? 'plaintext';
	}

	function highlightCode(node: HTMLElement, code: string, lang: string) {
		node.textContent = code;
		if (lang !== 'plaintext') {
			try {
				hljs.highlightElement(node);
			} catch {
				node.textContent = code;
			}
		}
	}

	const STORAGE_PATH = 'svelteRum:sourceViewerPath';
	const STORAGE_SCROLL = 'svelteRum:sourceViewerScrollByPath';

	function loadScrollMap(): Record<string, number> {
		if (typeof sessionStorage === 'undefined') return {};
		try {
			return JSON.parse(sessionStorage.getItem(STORAGE_SCROLL) ?? '{}') as Record<string, number>;
		} catch {
			return {};
		}
	}

	function saveScrollForPath(path: string, y: number) {
		if (typeof sessionStorage === 'undefined') return;
		const m = loadScrollMap();
		m[path] = y;
		sessionStorage.setItem(STORAGE_SCROLL, JSON.stringify(m));
	}

	let { data } = $props();
	let selected = $state<string | null>(null);
	let content = $state<string>('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let codeEl: HTMLElement | null = $state(null);
	let preEl: HTMLElement | null = $state(null);
	let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleScrollPersist() {
		if (!selected || !preEl) return;
		if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
		scrollSaveTimer = setTimeout(() => {
			scrollSaveTimer = null;
			if (selected && preEl) saveScrollForPath(selected, preEl.scrollTop);
		}, 150);
	}

	beforeNavigate(({ from, to }) => {
		if (from?.url.pathname !== '/source') return;
		if (to?.url.pathname === '/source') return;
		if (selected && preEl) {
			saveScrollForPath(selected, preEl.scrollTop);
			try {
				sessionStorage.setItem(STORAGE_PATH, selected);
			} catch {
				/* private mode */
			}
		}
	});

	onMount(() => {
		const saved = sessionStorage.getItem(STORAGE_PATH);
		if (saved) void select(saved);
	});

	$effect(() => {
		if (codeEl && content && !loading && !error && selected) {
			highlightCode(codeEl, content, getLanguage(selected));
			void tick().then(() => {
				if (preEl && selected) {
					const y = loadScrollMap()[selected];
					preEl.scrollTop = typeof y === 'number' ? y : 0;
				}
			});
		}
	});

	async function select(path: string) {
		if (selected && preEl && selected !== path) {
			saveScrollForPath(selected, preEl.scrollTop);
		}
		selected = path;
		try {
			sessionStorage.setItem(STORAGE_PATH, path);
		} catch {
			/* private mode */
		}
		loading = true;
		error = null;
		try {
			const res = await fetch(`/source/file?path=${encodeURIComponent(path)}`);
			if (!res.ok) {
				content = '';
				error = res.status === 403 ? 'Access denied' : 'File not found';
				return;
			}
			content = await res.text();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load';
			content = '';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Source – svelteRum</title>
</svelte:head>

<div class="source-viewer">
	<aside class="sidebar">
		<h2>Source Files</h2>
		<nav class="tree">
			<SourceTree nodes={data.files} {selected} onSelect={select} />
		</nav>
	</aside>
	<main class="content">
		{#if selected}
			<header>
				<span class="path">{selected}</span>
			</header>
			{#if loading}
				<p class="loading">Loading...</p>
			{:else if error}
				<p class="error">{error}</p>
			{:else}
				<pre bind:this={preEl} onscroll={scheduleScrollPersist}
					><code bind:this={codeEl} class="hljs">{content}</code></pre>
			{/if}
		{:else}
			<p class="hint">Select a file from the sidebar.</p>
		{/if}
	</main>
</div>

<style>
	.source-viewer {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
	}

	.sidebar {
		width: 280px;
		flex-shrink: 0;
		border-right: 1px solid var(--border);
		padding: 1rem;
		overflow-y: auto;
		background: var(--bg-card);
	}

	.sidebar h2 {
		font-size: 0.9rem;
		font-weight: 600;
		margin: 0 0 1rem 0;
		color: var(--text-muted);
	}

	.tree {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.content header {
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-card);
	}

	.content .path {
		font-size: 0.85rem;
		color: var(--text-muted);
		word-break: break-all;
	}

	.content pre {
		flex: 1;
		margin: 0;
		padding: 1.5rem 2rem;
		overflow: auto;
		font-size: 0.85rem;
		line-height: 1.6;
		tab-size: 4;
		background: var(--bg-dark);
	}

	.content pre code {
		background: transparent;
		padding: 0;
	}

	.loading,
	.error,
	.hint {
		padding: 2rem;
		color: var(--text-muted);
	}

	.error {
		color: #f87171;
	}
</style>
