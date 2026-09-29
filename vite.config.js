import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
});
