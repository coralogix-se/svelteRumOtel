/** Call after init to set user session info (e.g. after login or harness run). */
import { rumIdentityForPersona } from '$lib/rum-identities';

type SdkUserContext = {
	user_id: string;
	user_name: string;
	user_email?: string;
	user_metadata?: Record<string, unknown>;
};

export function setCoralogixUserContext(user: {
	userId: string;
	userName?: string;
	userEmail?: string;
	userMetadata?: Record<string, unknown>;
}) {
	applySdkUserContext(toSdkUserContext(user));
}

export type RumUserContext = {
	userId: string;
	userName?: string;
	userEmail?: string;
	userMetadata?: Record<string, unknown>;
};

/** Must match `@coralogix/browser` `CoralogixDomainsApiUrlMap` keys used in this app. */
export type CoralogixRumDomain = 'US2' | 'EU1';

/** Set when SDK marks session_context.hasRecording on an outbound RUM event (harness poll). */
let rumSessionHasRecording = false;
let rumInitPromise: Promise<void> | null = null;
let activeSdkUserContext: SdkUserContext | null = null;

function toSdkUserContext(userContext?: RumUserContext): SdkUserContext {
	const guest = rumIdentityForPersona('guest');
	return {
		user_id: userContext?.userId?.trim() || guest.userId,
		user_name: userContext?.userName?.trim() || guest.userName,
		user_email: userContext?.userEmail || guest.userEmail,
		user_metadata: userContext?.userMetadata || {
			platform: 'web',
			source: 'svelte-chatbot',
			persona: guest.persona
		}
	};
}

function enrichSessionContext(event: {
	session_context?: {
		user_id?: string;
		user_name?: string;
		user_email?: string;
		user_metadata?: Record<string, unknown>;
	};
}) {
	if (!activeSdkUserContext || !event?.session_context) return;
	const sc = event.session_context;
	if (!sc.user_id) sc.user_id = activeSdkUserContext.user_id;
	if (!sc.user_name) sc.user_name = activeSdkUserContext.user_name;
	if (!sc.user_email && activeSdkUserContext.user_email) {
		sc.user_email = activeSdkUserContext.user_email;
	}
	if (!sc.user_metadata && activeSdkUserContext.user_metadata) {
		sc.user_metadata = activeSdkUserContext.user_metadata;
	}
}

function markRumSessionRecording(event: { session_context?: { hasRecording?: boolean } }) {
	if (event?.session_context?.hasRecording === true) {
		rumSessionHasRecording = true;
	}
}

function applySdkUserContext(context: SdkUserContext) {
	activeSdkUserContext = context;
	if (typeof window === 'undefined') return;
	const rum = window.CoralogixRum;
	if (rum?.isInited && typeof rum.setUserContext === 'function') {
		rum.setUserContext(context);
	}
}

export function isRumSessionRecording(): boolean {
	return rumSessionHasRecording;
}

/** Wait until CoralogixRum.init() has finished (harness must set user context after this). */
export async function waitForRumInit(timeoutMs = 15000): Promise<boolean> {
	if (typeof window === 'undefined') return false;
	if (window.CoralogixRum?.isInited) return true;
	if (!rumInitPromise) return Boolean(window.CoralogixRum?.isInited);
	const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
	while (Date.now() < deadline) {
		await rumInitPromise.catch(() => {});
		if (window.CoralogixRum?.isInited) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return Boolean(window.CoralogixRum?.isInited);
}

/** Poll until session replay is active so AI Explorer can correlate RUM with traces. */
export async function waitForRumSessionRecording(timeoutMs = 15000): Promise<boolean> {
	if (rumSessionHasRecording) return true;
	if (typeof window === 'undefined') return false;
	const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
	while (Date.now() < deadline) {
		if (rumSessionHasRecording) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return rumSessionHasRecording;
}

/** Push final session-recording chunk before harness closes the page (no public SDK flush API). */
export async function flushRum(timeoutMs = 15000): Promise<boolean> {
	if (typeof window === 'undefined') return false;
	const hadRecording = rumSessionHasRecording;
	const { CoralogixRum } = await import('@coralogix/browser');
	if (typeof CoralogixRum.stopSessionRecording === 'function') {
		CoralogixRum.stopSessionRecording();
	}
	const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 250));
	}
	return hadRecording;
}

function installHarnessHooks() {
	if (typeof window === 'undefined') return;
	window.__svelteRumHarness = {
		isReady: () => Boolean(document.querySelector('input[aria-label="Chat message"]')),
		isRumSessionRecording,
		waitForRumInit,
		waitForRumSessionRecording,
		flushRum,
		setRumUserContext(context: SdkUserContext) {
			applySdkUserContext(context);
		}
	};
}

/** Idempotent client init — call as early as possible (not deferred to late onMount). */
export function ensureRumInit(
	publicKey: string,
	coralogixDomain: CoralogixRumDomain = 'US2',
	userContext?: RumUserContext
): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	if (!rumInitPromise) {
		rumInitPromise = initCoralogixRum(publicKey, coralogixDomain, userContext);
	}
	return rumInitPromise;
}

export async function initCoralogixRum(
	publicKey: string,
	coralogixDomain: CoralogixRumDomain = 'US2',
	userContext?: RumUserContext
) {
	if (typeof window === 'undefined') return;
	const key = publicKey?.trim() ?? '';
	if (!key) {
		console.warn(
			'[Coralogix RUM] No public key — set VITE_CORALOGIX_RUM_KEY or PUBLIC_CORALOGIX_RUM_KEY in .env (browser RUM disabled).'
		);
		return;
	}
	if (key.startsWith('your_')) {
		console.warn(
			'[Coralogix RUM] Key is still a template (starts with your_) — use the real RUM public key from Coralogix; browser RUM not initialized.'
		);
		return;
	}
	rumSessionHasRecording = false;
	const sdkUserContext = toSdkUserContext(userContext);
	activeSdkUserContext = sdkUserContext;
	const { CoralogixRum } = await import('@coralogix/browser');
	CoralogixRum.init({
		public_key: key,
		environment: import.meta.env.DEV ? 'development' : 'production',
		application: 'svelte-chatbot',
		version: '1.0.0',
		coralogixDomain,
		user_context: sdkUserContext,
		sessionConfig: {
			sessionSampleRate: 100
		},
		sessionRecordingConfig: {
			enable: true,
			autoStartSessionRecording: true,
			recordConsoleEvents: true,
			sessionRecordingSampleRate: 100,
			immediateFlush: true,
			inlineImages: true,
			dataURLOptions: { type: 'image/webp', quality: 0.75 }
		},
		traceParentInHeader: {
			enabled: true,
			options: {
				propagateTraceHeaderCorsUrls: [
					new RegExp('http://localhost:8000.*'),
					new RegExp('http://127\\.0\\.0\\.1:8000.*'),
					new RegExp('http://127\\.0\\.0\\.1:\\d+.*'),
					new RegExp('http://localhost:\\d+.*'),
					new RegExp('https?:\\/\\/[^/]+\\/api/.*')
				]
			}
		},
		beforeSend: (event) => {
			enrichSessionContext(event);
			markRumSessionRecording(event);
			return event;
		}
	});
	if (typeof CoralogixRum.setUserContext === 'function') {
		CoralogixRum.setUserContext(sdkUserContext);
	}
	installHarnessHooks();
}

/** Log when a chat image finishes loading (searchable in RUM logs; complements session replay). */
export function logChatImageDisplayed(url: string, alt: string) {
	if (typeof window === 'undefined') return;
	import('@coralogix/browser').then(({ CoralogixRum }) => {
		CoralogixRum.info('[svelteRum chat] image displayed', {
			image_url: url,
			image_alt: alt,
			image_host: (() => {
				try {
					return new URL(url).hostname;
				} catch {
					return '';
				}
			})()
		});
	});
}
