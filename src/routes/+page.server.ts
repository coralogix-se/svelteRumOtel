import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	chatTitle: process.env.PUBLIC_CHAT_PAGE_TITLE?.trim() || 'Chat Bot'
});
