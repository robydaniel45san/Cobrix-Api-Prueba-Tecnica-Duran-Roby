import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The panel is served by the Cobrix server (npm start) from panel/dist.
// `npm run dev` runs Vite on 5173 and forwards /api to the running Cobrix server.
export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [react(), tailwindcss()],
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4300' } },
	build: { outDir: 'dist', emptyOutDir: true },
})
