import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:8787',
				changeOrigin: true,
				secure: false,
			},
		},
	},
});
