/** Anonymized RUM demo personas — fictional codenames only (no customer/company names). */
export type RumDemoPersona = 'vega' | 'orion' | 'guest';

export type RumDemoIdentity = {
	persona: RumDemoPersona;
	userId: string;
	userName: string;
	userEmail: string;
	stack: 'US2' | 'EU1' | null;
};

export const RUM_DEMO_IDENTITIES: Record<RumDemoPersona, RumDemoIdentity> = {
	vega: {
		persona: 'vega',
		userId: 'vega-k7',
		userName: 'Vega',
		userEmail: 'demo+vega@observability-demo.local',
		stack: 'US2'
	},
	orion: {
		persona: 'orion',
		userId: 'orion-m3',
		userName: 'Orion',
		userEmail: 'demo+orion@observability-demo.local',
		stack: 'EU1'
	},
	guest: {
		persona: 'guest',
		userId: 'guest-n7',
		userName: 'Guest',
		userEmail: 'demo+guest@observability-demo.local',
		stack: null
	}
};

/** Map deployment hints to a persona without exposing customer names. */
export function resolveRumDemoPersona(hints: {
	persona?: string;
	team?: string;
	stack?: string;
}): RumDemoPersona {
	const persona = hints.persona?.trim().toLowerCase();
	if (persona === 'vega' || persona === 'orion' || persona === 'guest') {
		return persona;
	}
	const team = hints.team?.trim().toLowerCase();
	if (team === 'team-a' || team === 'vega' || team === 'a') return 'vega';
	if (team === 'team-b' || team === 'orion' || team === 'b') return 'orion';
	const stack = hints.stack?.trim().toUpperCase();
	if (stack === 'EU1') return 'orion';
	if (stack === 'US2') return 'vega';
	return 'guest';
}

export function rumIdentityForPersona(persona: RumDemoPersona): RumDemoIdentity {
	return RUM_DEMO_IDENTITIES[persona];
}
