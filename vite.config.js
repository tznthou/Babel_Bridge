import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  plugins: [
    webExtension({
      manifest: './manifest.json',
      watchFilePaths: ['src/**/*', 'icons/**/*'],
      additionalInputs: ['src/workers/mp3-encoder.worker.js'],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  worker: {
    format: 'es',
  },
});
