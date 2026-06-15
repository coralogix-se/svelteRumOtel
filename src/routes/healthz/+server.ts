import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BACKEND_CHECK_MS = 2000;

/**
 * K8s readiness/liveness: process is up; optionally verify chat API when CHAT_API_ORIGIN is set (EKS).
 * Not a substitute for collector export health — scrape otel-collector-chatbot:8888/metrics for that.
 */
export const GET: RequestHandler = async () => {
	const origin = process.env.CHAT_API_ORIGIN?.trim().replace(/\/$/, '');
	if (!origin) {
		return json({ status: 'ok', backend: 'skipped' });
	}

	try {
		const res = await fetch(`${origin}/health`, {
			signal: AbortSignal.timeout(BACKEND_CHECK_MS)
		});
		if (!res.ok) {
			return json(
				{ status: 'degraded', backend: 'unreachable', httpStatus: res.status },
				{ status: 503 }
			);
		}
		return json({ status: 'ok', backend: 'ok' });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ status: 'degraded', backend: 'error', message }, { status: 503 });
	}
};
