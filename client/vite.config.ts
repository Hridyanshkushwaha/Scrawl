import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the Vite dev server proxies WebSocket and API traffic to the
// game server, so the browser only ever talks to one origin (no CORS setup needed).
const SERVER = process.env.VITE_DEV_SERVER_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: SERVER, ws: true, changeOrigin: true },
      '/api': { target: SERVER, changeOrigin: true },
    },
  },
});
