import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './',
  define: {
    __PHEVERE_DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
  resolve: {
    alias: {
      '@phevere/core': path.resolve(root, '../../packages/core/src'),
    },
  },
  optimizeDeps: {
    include: ['sql.js'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/__pv/etymonline': {
        target: 'https://www.etymonline.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p: string) => p.replace(/^\/__pv\/etymonline/, '') || '/',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader(
              'User-Agent',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            );
            proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
            proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml');
          });
        },
      },
      '/__pv/youdao': {
        target: 'https://dict.youdao.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p: string) => p.replace(/^\/__pv\/youdao/, '') || '/',
      },
      '/__pv/youdao-http': {
        target: 'http://dict.youdao.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/__pv\/youdao-http/, '') || '/',
      },
    },
  },
});
