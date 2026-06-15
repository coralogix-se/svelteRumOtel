<script lang="ts">
	import type { FileNode } from '$lib/source-tree-node';
	import Self from './SourceTree.svelte';

	let { nodes, selected, onSelect } = $props<{
		nodes: FileNode[];
		selected: string | null;
		onSelect: (path: string) => void;
	}>();
</script>

{#each nodes as node}
	{#if node.children}
		<details open>
			<summary>{node.name}/</summary>
			<div class="tree-children">
				<Self nodes={node.children} {selected} {onSelect} />
			</div>
		</details>
	{:else}
		<button
			class="file"
			class:active={selected === node.path}
			onclick={() => onSelect(node.path)}
		>
			{node.name}
		</button>
	{/if}
{/each}

<style>
	.tree-children {
		margin-left: 1rem;
		margin-top: 0.25rem;
	}

	details summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--text);
		padding: 0.2rem 0;
	}

	.file {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.35rem 0.5rem;
		font-size: 0.8rem;
		background: transparent;
		border: none;
		border-radius: 0.35rem;
		color: var(--text);
		cursor: pointer;
		transition: background 0.15s;
	}

	.file:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.file.active {
		background: var(--accent-dim);
		color: var(--accent);
	}
</style>
