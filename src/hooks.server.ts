import type { Handle } from '@sveltejs/kit';

/**
 * When the browser hits this Node server at `/api/*` (e.g. kubectl port-forward to :3000 only),
 * forward to FastAPI — same pattern as Ingress splitting `/api` → backend in-cluster.
 * Set CHAT_API_ORIGIN (e.g. http://chat-backend:8000). Unset in `vite dev` — Vite proxies `/api` instead.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const origin = process.env.CHAT_API_ORIGIN?.trim().replace(/\/$/, '');
	if (!origin || !event.url.pathname.startsWith('/api')) {
		return resolve(event);
	}

	const target = new URL(event.url.pathname + event.url.search, origin).href;
	const headers = new Headers(event.request.headers);
	headers.delete('host');

	const init: RequestInit = {
		method: event.request.method,
		headers
	};
	if (!['GET', 'HEAD'].includes(event.request.method)) {
		init.body = await event.request.arrayBuffer();
	}

	return fetch(target, init);
};
