/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes the build work from any sub-path (GitHub Pages project
// sites, folders on a static host, a custom domain). Routing uses the URL hash
// so no server-side SPA fallback is needed.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { sourcemap: false, target: 'es2022' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
  },
});
