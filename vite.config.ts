import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	/** Dev: browser calls same-origin `/api/*` → proxied to FastAPI (avoids localhost vs 127.0.0.1 “Failed to fetch”). */
	server: {
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:8000',
				changeOrigin: true
			}
		}
	},
	ssr: {
		noExternal: ['@google/genai']
	}
});
