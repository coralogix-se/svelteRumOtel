import type { LayoutServerLoad } from './$types';
import type { CoralogixRumDomain } from '$lib/coralogix-rum';
import { resolveRumDemoPersona, rumIdentityForPersona } from '$lib/rum-identities';

/** Kubernetes / Docker: PUBLIC_CORALOGIX_RUM_KEY + PUBLIC_CORALOGIX_DOMAIN (US2 | EU1). Local dev uses VITE_* / build defaults. */
export const load: LayoutServerLoad = async () => {
	const rumPublicKey = process.env.PUBLIC_CORALOGIX_RUM_KEY?.trim() ?? '';
	const rawDomain = process.env.PUBLIC_CORALOGIX_DOMAIN?.trim().toUpperCase() ?? '';
	const rumCoralogixDomain: CoralogixRumDomain =
		rawDomain === 'EU1' ? 'EU1' : 'US2';

	const persona = resolveRumDemoPersona({
		persona: process.env.PUBLIC_RUM_PERSONA,
		team: process.env.PUBLIC_RUM_TEAM,
		stack: rumCoralogixDomain
	});
	const identity = rumIdentityForPersona(persona);

	const rumUserContext = {
		userId: process.env.PUBLIC_RUM_USER_ID?.trim() || identity.userId,
		userName: process.env.PUBLIC_RUM_USER_NAME?.trim() || identity.userName,
		userEmail: process.env.PUBLIC_RUM_USER_EMAIL?.trim() || identity.userEmail,
		userMetadata: {
			platform: 'web',
			source: 'svelte-chatbot',
			persona: identity.persona,
			stack: identity.stack || rumCoralogixDomain
		}
	};

	return { rumPublicKey, rumCoralogixDomain, rumUserContext };
};
