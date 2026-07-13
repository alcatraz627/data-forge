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
        // The shell (index.html) is deliberately NOT precached: serving it
        // cache-first made every deploy invisible until a second reload —
        // the phone always opened the previous version. Navigations go
        // network-first (the shell is <1KB and references hashed assets, so
        // a fresh fetch IS the update); the cached copy answers offline or
        // after the 3s timeout. Hashed assets stay precached for offline.
        globPatterns: ['**/*.{js,css,svg,png,webmanifest}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'shell',
              networkTimeoutSeconds: 3,
            },
          },
        ],
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
