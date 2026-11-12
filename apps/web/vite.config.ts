import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const workspaceRoot = resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, workspaceRoot, '');
  const proxy = { '/api': { target: `http://127.0.0.1:${env.API_PORT || 3000}` } };

  return {
    plugins: [react()],
    envDir: workspaceRoot,
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
  };
});
