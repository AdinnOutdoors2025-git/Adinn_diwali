import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Set VITE_API_PROXY_TARGET (shell or frontend/.env.local, e.g. http://localhost:6000) to develop against a local
  // backend. The default is the deployed API, so a stale deployment there will reject newer payloads.
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const apiTarget = env.VITE_API_PROXY_TARGET || 'https://adinn-diwali.onrender.com';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: apiTarget.startsWith('https'),
        },
      },
    },
  };
});
