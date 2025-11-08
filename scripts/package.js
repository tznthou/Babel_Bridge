/**
 * 打包腳本 - 生成 Chrome Web Store 上架用的 .zip 檔
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const outputFile = path.join(rootDir, 'babel-bridge.zip');

async function createZip() {
  // 檢查 dist 目錄是否存在
  if (!fs.existsSync(distDir)) {
    console.error('❌ dist/ 目錄不存在。請先執行 npm run build');
    process.exit(1);
  }

  // 刪除舊的 zip 檔
  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
    console.log('🗑️  已刪除舊的 zip 檔');
  }

  // 建立輸出串流
  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', {
    zlib: { level: 9 }, // 最大壓縮率
  });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const size = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`✅ 打包完成: ${outputFile}`);
      console.log(`📦 檔案大小: ${size} MB`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // 將 dist 目錄內容加入 zip
    archive.directory(distDir, false);

    archive.finalize();
  });
}

console.log('📦 開始打包 Babel Bridge...');
createZip()
  .then(() => {
    console.log('🎉 打包成功！可以上傳到 Chrome Web Store 了');
  })
  .catch((err) => {
    console.error('❌ 打包失敗:', err);
    process.exit(1);
  });
