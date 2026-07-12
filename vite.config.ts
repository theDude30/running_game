import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works on the web and inside Capacitor's
  // local file server on iOS/Android.
  base: './',
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    proxy: {
      // dev-only yt-dlp extraction server (npm run dev:audio)
      '/api': 'http://localhost:5181',
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600, // Phaser alone is ~1.2 MB minified
  },
});
