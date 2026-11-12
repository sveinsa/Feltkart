import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' gjør at bygget fungerer både lokalt og på GitHub Pages (under /<repo>/)
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
