import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only talks to Vite; Vite forwards API and image requests to the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true }, // the live channels
    },
  },
});
