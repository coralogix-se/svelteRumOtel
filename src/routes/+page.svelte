<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import type { PageData } from './$types';
	import { randomUuidV4 } from '$lib/random-uuid-client';
	import ChatMessageBody from '$lib/ChatMessageBody.svelte';

	type ChatMsg = { id: string; role: 'user' | 'assistant'; content: string };

	let { data }: { data: PageData } = $props();

	const STORAGE_MESSAGES = 'svelteRum:chatMessages';
	const STORAGE_INPUT = 'svelteRum:chatInput';

	function loadChatFromStorage(): { messages: ChatMsg[]; input: string } {
		if (typeof sessionStorage === 'undefined') return { messages: [], input: '' };
		try {
			const raw = sessionStorage.getItem(STORAGE_MESSAGES);
			const inputDraft = sessionStorage.getItem(STORAGE_INPUT) ?? '';
			if (!raw) return { messages: [], input: inputDraft };
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return { messages: [], input: inputDraft };
			const messages: ChatMsg[] = [];
			for (const m of parsed) {
				if (
					m &&
					typeof m === 'object' &&
					'id' in m &&
					'role' in m &&
					'content' in m &&
					typeof (m as ChatMsg).id === 'string' &&
					((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant') &&
					typeof (m as ChatMsg).content === 'string'
				) {
					messages.push(m as ChatMsg);
				}
			}
			return { messages, input: inputDraft };
		} catch {
			return { messages: [], input: '' };
		}
	}

	function persistChatToStorage(msgs: ChatMsg[], inputValue: string) {
		if (typeof sessionStorage === 'undefined') return;
		try {
			sessionStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs));
			sessionStorage.setItem(STORAGE_INPUT, inputValue);
		} catch {
			/* private mode or quota */
		}
	}

	beforeNavigate(({ from, to }) => {
		if (from?.url.pathname !== '/') return;
		if (to?.url.pathname === '/') return;
		persistChatToStorage(messages, input);
	});

	onMount(() => {
		const { messages: saved, input: savedInput } = loadChatFromStorage();
		if (saved.length) messages = saved;
		if (savedInput) input = savedInput;
	});

	let input = $state('');
	let messages = $state<ChatMsg[]>([]);
	let loading = $state(false);
	/** Elapsed whole seconds while the assistant bubble is in "Thinking..." state (RUM-friendly). */
	let thinkingSeconds = $state(0);
	/**
	 * Plain variable (not $state): Svelte can batch $state writes, so a second send() in the
	 * same tick could still see sending === false if the mutex were $state — duplicate bubbles.
	 */
	let sendInFlight = false;
	/** Monotonic counter for correlating duplicate-debug logs (browser console vs API / Coralogix). */
	let chatSendSeq = 0;
	let messagesEl: HTMLDivElement | undefined = $state();

	function scrollMessagesToBottom() {
		if (!messagesEl) return;
		messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
	}

	$effect(() => {
		const _count = messages.length;
		const _loading = loading;
		void tick().then(scrollMessagesToBottom);
	});

	$effect(() => {
		if (!loading) {
			thinkingSeconds = 0;
			return;
		}
		const startedAt = Date.now();
		const updateElapsed = () => {
			thinkingSeconds = Math.floor((Date.now() - startedAt) / 1000);
		};
		updateElapsed();
		const id = setInterval(updateElapsed, 1000);
		return () => clearInterval(id);
	});

	async function send() {
		if (sendInFlight) return;
		const text = input.trim();
		if (!text || loading) return;
		// Same text as the last user bubble with no assistant reply yet = duplicate submit burst
		const last = messages[messages.length - 1];
		if (last?.role === 'user' && last.content === text) return;

		sendInFlight = true;
		const userMsgId = randomUuidV4();
		const seq = ++chatSendSeq;
		messages = [...messages, { id: userMsgId, role: 'user', content: text }];
		// Filter DevTools console by "svelteRum chat" — compare line count to Coralogix / API logs
		console.info('[svelteRum chat] user message', {
			seq,
			messageId: userMsgId,
			text,
			length: text.length,
			at: new Date().toISOString()
		});
		input = '';
		loading = true;

		// Dev: use same-origin `/api` (Vite proxy → :8000) for local APIs so the browser host matches
		// (avoids "Failed to fetch" when the tab is http://127.0.0.1:5173 but .env points at http://localhost:8000).
		const explicit = import.meta.env.VITE_CHAT_API_URL?.trim();
		const localDevApi =
			explicit &&
			/^https?:\/\/(localhost|127\.0\.0\.1):8000\/?$/i.test(explicit.replace(/\/+$/, ''));
		// Prod / Docker + Ingress: same-origin `/api/*` when VITE_CHAT_API_URL is unset (see deploy/k8s).
		const apiBase =
			import.meta.env.DEV && (!explicit || localDevApi)
				? ''
				: explicit || (import.meta.env.DEV ? '' : '');
		try {
			const res = await fetch(`${apiBase}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: text,
					history: messages.slice(0, -1)
				})
			});
			const data = await res.json();

			if (!res.ok) {
				const detail =
					typeof data.detail === 'string'
						? data.detail
						: data.error != null
							? String(data.error)
							: 'Unknown error';
				messages = [
					...messages,
					{ id: randomUuidV4(), role: 'assistant', content: `Error: ${detail}` }
				];
				return;
			}
			messages = [...messages, { id: randomUuidV4(), role: 'assistant', content: data.message }];
		} catch (e) {
			messages = [
				...messages,
				{
					id: randomUuidV4(),
					role: 'assistant',
					content: `Error: ${e instanceof Error ? e.message : 'Request failed'}`
				}
			];
		} finally {
			loading = false;
			sendInFlight = false;
		}
	}
</script>

<div class="chatbot">
	<header>
		<h1>{data.chatTitle}</h1>
		<p>Powered by Strands multi-agent orchestration and Gemini 2.5 Flash Lite</p>
	</header>

	<div class="messages" role="log" bind:this={messagesEl}>
		{#if messages.length === 0}
			<p class="placeholder">Send a message to start the conversation.</p>
		{:else}
			{#each messages as msg (msg.id)}
				<div class="message" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
					<span class="role">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
					<ChatMessageBody content={msg.content} />
				</div>
			{/each}
		{/if}
		{#if loading}
			<div class="message assistant loading">
				<span class="role">Assistant</span>
				<p>
					Thinking…
					<span class="thinking-elapsed" aria-live="polite">{thinkingSeconds}s</span>
				</p>
			</div>
		{/if}
	</div>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			void send();
		}}
	>
		<input
			type="text"
			bind:value={input}
			placeholder="Type a message..."
			disabled={loading}
			aria-label="Chat message"
		/>
		<button type="submit" disabled={loading}>Send</button>
	</form>
</div>

<style>
	.chatbot {
		box-sizing: border-box;
		max-width: 42rem;
		width: 100%;
		margin: 0 auto;
		padding: 2rem;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	header {
		text-align: center;
		margin-bottom: 2rem;
	}

	header h1 {
		font-size: 1.75rem;
		font-weight: 600;
		margin: 0 0 0.25rem 0;
		color: var(--text);
	}

	header p {
		color: var(--text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 0;
	}

	.placeholder {
		color: var(--text-muted);
		text-align: center;
		padding: 2rem;
	}

	.message {
		padding: 1rem 1.25rem;
		border-radius: 0.75rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
	}

	.message.user {
		align-self: flex-end;
		background: var(--accent-dim);
		border-color: var(--accent);
	}

	.message .role {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
		color: var(--text-muted);
	}

	.message.user .role {
		color: rgba(255, 255, 255, 0.8);
	}

	.message.loading p {
		opacity: 0.7;
	}

	.thinking-elapsed {
		margin-left: 0.35rem;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--accent);
		opacity: 1;
	}

	form {
		display: flex;
		gap: 0.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	input {
		flex: 1;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid var(--border);
		background: var(--bg-card);
		color: var(--text);
		font-size: 1rem;
	}

	input:focus {
		outline: none;
		border-color: var(--accent);
	}

	input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	button {
		padding: 0.75rem 1.25rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-weight: 500;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--accent-dim);
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
