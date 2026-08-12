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
        // 只排除除錯用的一次性腳本。
        // scripts/fix-paths.js 與 scripts/package.js 刻意留在分母——它們是
        // build / package 每次都會執行的 production pipeline，fix-paths 若
        // 靜默改錯路徑，dist 會壞掉而 build 照樣 PASS。排除它們等於宣告
        // 這段不需要測，那個缺口就再也不會被看見。
        'scripts/debug/',
      ],
    },
  },
});
