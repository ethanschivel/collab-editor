import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :1234. Proxying /api means the client can
// always call relative URLs, the same as in production.
export default defineConfig({
  plugins: [react()],
  build: {
    // The editor chunk (CodeMirror + Markdown/HTML/JS highlighting) is ~240 kB
    // gzipped and is lazy-loaded, so this size is expected.
    chunkSizeWarningLimit: 800,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:1234',
    },
  },
});
