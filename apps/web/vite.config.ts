import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5041,
    proxy: {
      '/api': 'http://localhost:5040',
      '/health': 'http://localhost:5040',
    },
  },
});
