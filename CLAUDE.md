# CLAUDE.md

Babel Bridge 是 Chrome Extension (Manifest V3)，為網路影片提供 AI 即時字幕。雙引擎：Deepgram Streaming（低延遲）與 OpenAI Whisper（高準確），使用者可切換。Phase 2 完成，Phase 3（UI 與翻譯）待開發。

這份是行為約束與導航。**專案知識不放這裡**——架構、決策、除錯都在 `docs/`，改動時只更新那邊。新 session 開始前先讀 `.claude/RESUME.md`（未進版控）。

## 開發命令

```bash
npm install
npm run dev               # watch 模式
npm run build             # 生產版本（含 fix-paths.js 後處理）
npm run package           # 產生上架 .zip

npm run test              # 全部測試
npm run test:unit         # 單元測試
npm run test:integration  # 整合測試（需 Deepgram Key，未設則跳過）
npm run test:coverage     # 覆蓋率
npm run lint              # ESLint
npm run typecheck         # JSDoc 型別檢查（checkJs），基線為零錯誤
npm run format            # Prettier
```

載入 Extension：`chrome://extensions/` → 開發人員模式 → 載入未封裝項目 → 選 `dist/`

---

## 動手前必讀的紅線

這些看起來像可以簡化的地方，改了會直接弄壞系統。理由見 [docs/DEVELOPMENT.md § 設計決策](docs/DEVELOPMENT.md)。

- **不要用 `ScriptProcessorNode`** — 在 Offscreen Document 中與 tabCapture 組合會觸發 Chrome 死鎖，整個瀏覽器凍結。音訊一律走 MediaRecorder 或 AudioWorklet
- **跨 context 不要直接傳 Blob/File** — MV3 structured clone 支援不完整會失真，用 Base64 或 ArrayBuffer
- **不要拿掉 Offscreen 的 `<audio>` 鏡射播放** — tabCapture 強制靜音原分頁，拿掉使用者就聽不到聲音
- **不要移除 WebM header 補強** — MediaRecorder 的 chunk1+ 不帶 EBML header，移除後 Whisper 成功率掉到 4.3%
- **不要改回累積式時間計算** — 影片暫停會累積 25-35 秒誤差，必須查詢 `video.currentTime` 往回推算
- **Deepgram 要送 KeepAlive、不要送自訂 `configure`** — 前者不送則靜音 10 秒斷線，後者會回 SchemaError

---

## 開發規範

- **語言**：TypeScript 優先，JavaScript (ES6+) 可接受
- **命名**：類別 `PascalCase`、函數 `camelCase`、常數 `UPPER_SNAKE_CASE`、檔案 `kebab-case`
- **Commit**：Conventional Commits（`feat` / `fix` / `docs` / `test` / `refactor` / `chore`）
- **測試**：覆蓋率目標 ≥ 70%，音訊處理模組 ≥ 80%。公開函數要有 JSDoc
- **錯誤**：一律用 `BabelBridgeError`，錯誤碼定義在 `src/lib/errors.js`
- **文件同步**：README.md 與 README_EN.md 須同步更新；架構有變更要回寫 `docs/DEVELOPMENT.md` 並在 `CHANGELOG.md` 記一筆

---

## 原始碼導航

| 職責 | 檔案 |
|------|------|
| 主控制器（雙引擎編排） | `src/background/service-worker.js` |
| Deepgram WebSocket 串流 | `src/background/deepgram-stream-client.js` |
| Whisper API | `src/background/whisper-client.js` |
| 字幕去重與斷句（核心模組） | `src/background/subtitle-processor.js` |
| 音訊擷取、MediaRecorder、鏡射播放 | `src/offscreen/offscreen.js` |
| AudioWorklet 48kHz→16kHz | `src/offscreen/pcm-processor.js` |
| 字幕渲染與 VideoMonitor | `src/content/content-script.js` |
| 雙金鑰、模型語言選擇 | `src/popup/popup.js` |
| **訊息類型、各項配置** | `src/lib/config.js`（`MessageTypes`、`DEEPGRAM_CONFIG`、`CHUNK_CONFIG`） |
| **錯誤碼** | `src/lib/errors.js`（`ErrorCodes`，共 26 個） |

---

## 文件導航

| 要做什麼 | 讀哪份 |
|----------|--------|
| 改架構、查管線流程、排查問題 | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) ← **現行架構主文件** |
| 搞懂某個設計為何這樣定 | [docs/DEVELOPMENT.md § 設計決策](docs/DEVELOPMENT.md) |
| 查各階段驗收數據、已知問題、覆蓋率現況 | [docs/MILESTONES.md](docs/MILESTONES.md) |
| 查某功能何時加入、某問題何時修的 | [CHANGELOG.md](CHANGELOG.md) |
| 手動測試步驟 | [docs/testing/](docs/testing/) |
| 追溯當初的設計意圖 | [docs/SPEC.md](docs/SPEC.md)、[docs/PRD.md](docs/PRD.md) ⚠️ **已過時，非現行架構** |
| 看當年問題排查的原始記錄 | [docs/archive/](docs/archive/) |
| 對外介紹專案 | [README.md](README.md) / [README_EN.md](README_EN.md) |
