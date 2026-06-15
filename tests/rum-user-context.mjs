/** Anonymized RUM demo personas for harness (mirrors src/lib/rum-identities.ts). */
const RUM_PERSONAS = {
	vega: { userId: 'vega-k7', userName: 'Vega', stack: 'US2' },
	orion: { userId: 'orion-m3', userName: 'Orion', stack: 'EU1' },
	guest: { userId: 'guest-n7', userName: 'Guest', stack: null }
};

/** @param {string | undefined} personaHint */
function resolveHarnessPersona(personaHint) {
	const hint = (personaHint || '').trim().toLowerCase();
	if (hint in RUM_PERSONAS) return hint;
	const team = (process.env.RUM_HARNESS_TEAM || '').trim().toLowerCase();
	if (team === 'team-a' || team === 'vega' || team === 'a') return 'vega';
	if (team === 'team-b' || team === 'orion' || team === 'b') return 'orion';
	return 'guest';
}

/** @param {import('puppeteer').Page} page */
export async function waitForRumInit(page, timeoutMs = 15000) {
	const fromHarness = page
		.evaluate(async (ms) => {
			if (typeof window.__svelteRumHarness?.waitForRumInit === 'function') {
				return window.__svelteRumHarness.waitForRumInit(ms);
			}
			return Boolean(window.CoralogixRum?.isInited);
		}, timeoutMs)
		.catch(() => false);
	const fromSdk = page
		.waitForFunction(() => window.CoralogixRum?.isInited === true, { timeout: timeoutMs })
		.then(() => true)
		.catch(() => false);
	const ok = (await Promise.race([fromHarness, fromSdk])) || false;
	if (!ok) {
		console.warn(`[rum-harness] RUM init not ready after ${timeoutMs}ms`);
	}
	return ok;
}

/** @param {import('puppeteer').Page} page */
export async function applyHarnessRumUserContext(page, { runId, personaHint }) {
	await waitForRumInit(page);
	const personaKey = resolveHarnessPersona(personaHint);
	const persona = RUM_PERSONAS[personaKey];
	const userId = `harness-${persona.userId}-${runId.slice(0, 8)}`;
	await page
		.evaluate(
			({ userId, runId, personaKey, persona }) => {
				const ctx = {
					user_id: userId,
					user_name: `Harness ${persona.userName}`,
					user_email: `harness+${runId.slice(0, 8)}@observability-demo.local`,
					user_metadata: {
						source: 'puppeteer',
						platform: 'linux',
						run_id: runId,
						persona: personaKey,
						stack: persona.stack
					}
				};
				if (typeof window.__svelteRumHarness?.setRumUserContext === 'function') {
					window.__svelteRumHarness.setRumUserContext(ctx);
				} else if (typeof window.CoralogixRum?.setUserContext === 'function') {
					window.CoralogixRum.setUserContext(ctx);
				}
			},
			{ userId, runId, personaKey, persona }
		)
		.catch(() => {});
	console.log(`[rum-harness] RUM user context user_id=${userId} persona=${personaKey}`);
}
