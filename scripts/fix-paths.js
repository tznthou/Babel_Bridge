#!/usr/bin/env node

/**
 * Post-build 腳本：修正 Vite 生成的錯誤路徑
 *
 * 問題：Vite 在建置 offscreen.html 時會生成錯誤的相對路徑
 * 解決：將 ../../src/offscreen/offscreen.js 修正為 ./offscreen.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OFFSCREEN_HTML = path.join(__dirname, '../dist/src/offscreen/offscreen.html');

console.log('🔧 [Fix Paths] 開始修正建置路徑...');

try {
  // 讀取 offscreen.html
  let content = fs.readFileSync(OFFSCREEN_HTML, 'utf-8');

  console.log('📄 [Fix Paths] 讀取 offscreen.html');

  // 記錄原始路徑
  const originalScriptPath = content.match(/src="([^"]+offscreen\.js)"/);
  const originalPreloadPath = content.match(/href="([^"]+modulepreload-polyfill\.js)"/);

  if (originalScriptPath) {
    console.log(`   原始 script 路徑: ${originalScriptPath[1]}`);
  }
  if (originalPreloadPath) {
    console.log(`   原始 preload 路徑: ${originalPreloadPath[1]}`);
  }

  // 修正 script 路徑
  content = content.replace(
    /src="\.\.\/\.\.\/src\/offscreen\/offscreen\.js"/g,
    'src="./offscreen.js"'
  );

  // 修正 modulepreload 路徑（如果需要）
  content = content.replace(
    /href="\.\.\/\.\.\/modulepreload-polyfill\.js"/g,
    'href="../../modulepreload-polyfill.js"'
  );

  // 寫回檔案
  fs.writeFileSync(OFFSCREEN_HTML, content, 'utf-8');

  console.log('✅ [Fix Paths] 路徑修正完成');
  console.log('   新 script 路徑: ./offscreen.js');
  console.log('');
} catch (error) {
  console.error('❌ [Fix Paths] 修正失敗:', error.message);
  process.exit(1);
}
