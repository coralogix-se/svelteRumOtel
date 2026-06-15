import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Liveness: Node process is serving HTTP (no downstream checks). */
export const GET: RequestHandler = async () => json({ status: 'ok' });
