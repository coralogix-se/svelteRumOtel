<script lang="ts">
	import { browser } from '$app/environment';
	import favicon from '$lib/assets/favicon.svg';
	import { ensureRumInit } from '$lib/coralogix-rum';
	import '$lib/app.css';

	let { children, data } = $props();

	// Start RUM as early as possible on the client — onMount is too late for session metadata.
	if (browser) {
		const rumKey = data.rumPublicKey || import.meta.env.VITE_CORALOGIX_RUM_KEY;
		const rumDomain = data.rumCoralogixDomain;
		void ensureRumInit(rumKey ?? '', rumDomain, data.rumUserContext).catch((err: unknown) => {
			console.error('[Coralogix RUM] init failed', rumDomain, err);
		});
	}
</script>

<style>
	/* Full-viewport column: nav stays visible; each route scrolls inside its main area. */
	.app-shell {
		height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.app-main {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.app-nav {
		flex-shrink: 0;
		display: flex;
		gap: 1rem;
		padding: 0.5rem 1rem;
		background: var(--bg-card);
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
	}
	.app-nav a {
		color: var(--text-muted);
		text-decoration: none;
	}
	.app-nav a:hover {
		color: var(--accent);
	}
</style>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-shell">
	<nav class="app-nav">
		<a href="/">Chat</a>
		<a href="/source">Source</a>
	</nav>
	<div class="app-main">
		{@render children()}
	</div>
</div>
