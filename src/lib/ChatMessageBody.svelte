<script lang="ts">
	import { parseChatContent } from '$lib/parse-chat-content';
	import { logChatImageDisplayed } from '$lib/coralogix-rum';

	let { content }: { content: string } = $props();

	const parts = $derived(parseChatContent(content));

	function onImageError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		img.style.display = 'none';
		img.closest('figure')?.classList.add('image-failed');
	}
</script>

<div class="chat-body">
	{#each parts as part, i (i)}
		{#if part.type === 'text'}
			<p class="text">{part.value}</p>
		{:else}
			<figure class="inline-image">
				<img
					class="chat-image"
					src={part.url}
					alt={part.alt || 'Illustration'}
					crossorigin="anonymous"
					referrerpolicy="no-referrer"
					loading="eager"
					decoding="async"
					onload={() => logChatImageDisplayed(part.url, part.alt || 'Illustration')}
					onerror={onImageError}
				/>
				{#if part.alt}
					<figcaption>{part.alt}</figcaption>
				{/if}
			</figure>
		{/if}
	{/each}
</div>

<style>
	.chat-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.text {
		margin: 0;
		white-space: pre-wrap;
	}

	.inline-image {
		margin: 0;
		max-width: 100%;
	}

	.inline-image img {
		display: block;
		max-width: min(100%, 20rem);
		height: auto;
		border-radius: 0.5rem;
		border: 1px solid var(--border);
		background: var(--bg-card);
	}

	.inline-image.image-failed figcaption {
		color: var(--text-muted);
		font-style: italic;
	}

	.inline-image figcaption {
		margin-top: 0.35rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
</style>
