import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:5055';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'healthz-endpoint',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/healthz') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end('ok');
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 3050,
    strictPort: true,
    host: '0.0.0.0',
    watch: {
      usePolling: true,
      interval: 100,
    },
    hmr: {
      clientPort: 3050,
    },
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    strictPort: true,
    port: 3050,
  },
});
