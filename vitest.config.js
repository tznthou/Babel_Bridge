import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '*.config.js',
        // 建置與除錯用的一次性腳本，不是 Extension runtime 的一部分，
        // 沒有測試需求。留在分母裡只會虛壓整體覆蓋率。
        'scripts/',
      ],
    },
  },
});
