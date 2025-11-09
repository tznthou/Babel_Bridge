import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  plugins: [
    webExtension({
      manifest: './manifest.json',
      watchFilePaths: ['src/**/*', 'icons/**/*'],
      additionalInputs: [
        'src/workers/mp3-encoder.worker.js',
        'src/offscreen/offscreen.html'
      ],
    }),
  ],
  // ✅ 關鍵修復：使用相對路徑而非絕對路徑
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  worker: {
    format: 'es',
  },
});
