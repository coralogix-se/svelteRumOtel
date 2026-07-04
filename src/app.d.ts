// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		CoralogixRum?: {
			isInited?: boolean;
			startSessionRecording?(): void;
			stopSessionRecording?(): void;
			setUserContext(context: {
				user_id: string;
				user_name?: string;
				user_email?: string;
				user_metadata?: Record<string, unknown>;
			}): void;
		};
		/** Puppeteer harness (tests/rum-harness.mjs) — RUM session replay readiness. */
		__svelteRumHarness?: {
			isReady(): boolean;
			isRumSessionRecording(): boolean;
			waitForRumInit(timeoutMs?: number): Promise<boolean>;
			waitForRumSessionRecording(timeoutMs?: number): Promise<boolean>;
			flushRum(timeoutMs?: number): Promise<boolean>;
			setRumUserContext(context: {
				user_id: string;
				user_name?: string;
				user_email?: string;
				user_metadata?: Record<string, unknown>;
			}): void;
		};
	}
}

export {};
