import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // manifest.webmanifest is hand-maintained in public/; the plugin only
      // builds the service worker (precache + offline shell).
      manifest: false,
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5041,
    proxy: {
      '/api': 'http://localhost:5040',
      '/health': 'http://localhost:5040',
    },
  },
});
