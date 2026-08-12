# Changelog

本專案的所有重要變更都記錄在此。

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號依循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

> **版本狀態**：`package.json` 與 `manifest.json` 自專案建立起固定為 `0.1.0`，尚未發布任何版本，也未建立 git tag。因此以下全部歸於 `[Unreleased]`，依開發階段分段。首次發布時再收斂為 `[0.1.0]` 並補打 tag。
>
> 各階段的驗收數據、根因分析與設計取捨見 [docs/MILESTONES.md](docs/MILESTONES.md)；此處只記「變更了什麼」。

---

## [Unreleased]

### 維護與品質（2026-08-10 ~ 2026-08-12）

#### Added
- 補上突變測試揭露的兩條未覆蓋路徑 (`42a8d81`)
- `npm run typecheck`：以 `checkJs` 檢查現有 JSDoc 的型別基線，不改副檔名、不動 build，刪掉 `tsconfig.json` 即可退回。同時新增 `types/globals.d.ts`，補上 V8 的 `Error.captureStackTrace`、tabCapture 的 `mandatory` legacy constraint、Service Worker 的 `WorkerGlobalScope` 三處全域宣告 (`08ba368`)
- `npm run format:check`：Prettier 只檢查不寫入，讓格式一致性有東西在守，PR 前與 CI 都用它 (`8396336`)
- `.prettierignore`：擋掉 `package-lock.json` 與產物目錄 (`8396336`)

#### Changed
- 整理專案資料夾結構為 `docs/` 與 `scripts/debug/`，收斂 `.gitignore` (`c31b8e4`)
- 重寫 README 為中英雙語版，開發里程碑抽出為獨立文件 (`14846b2`)
- 修正文件交叉引用並補上封存說明 (`4fc5447`)
- integration 測試改為缺 API Key 時跳過，而非直接失敗 (`a533409`)
- `@types/chrome` 0.0.258 → 0.2.5，修好 `getMediaStreamId` 被定義成 callback-only 的誤報；`chrome.storage` 回傳值同時從 `any` 收緊為 `unknown`，讀值處補上型別標註 (`08ba368`)
- 全 codebase 套用 Prettier（27 個檔案），`format` 範圍從 `src/` 擴大到 `tests/`、`scripts/`、根目錄設定檔與兩個 HTML。零語義變更，以格式化前後各 build 一次逐檔比對 dist/ 驗證：13 個經 bundler 的 JS 檔 minify 後位元組完全相同，另三個不經 bundler 的檔案差異逐一檢查（縮排、自閉合斜線、`<!DOCTYPE>` → `<!doctype>`）；`manifest.json` 以 `JSON.parse` 比對解析結果一致 (`8396336`)
- coverage 分母排除 `scripts/`——建置與除錯用的一次性腳本不進 dist、永遠是 0%，留在分母只是虛壓數字。整體覆蓋率 41.40% → 44.29% (`87f8896`)

#### Fixed
- 修復 Deepgram 測試套件 9 個失敗案例與 71 秒耗時 (`c738781`)
- 接上 Deepgram KeepAlive 並移除 `configure` 死 code——KeepAlive 是官方機制，靜音超過 10 秒會斷線 (`16ced2e`)
- 以世代編號與重連閂修復兩條連線生命週期併發問題 (`591b2e8`)
- 併發防護觸發時不再讓 Popup 誤報成啟用失敗 (`b2f8c53`)
- 三處 JSDoc 與實作矛盾（皆為文件錯誤，實作正確）：`APIKeyManager.verifyKey` 的 `@returns` 漏了 `modelsCount` 且與同檔 `verifyAndSave` 的宣告互相矛盾、`handlePCMFrame` 誤標 `@private` 但實為訊息進入點、`DeepgramStreamClient.init(config)` 的選填參數標成必填 (`08ba368`)
- ESLint `src/` 的 4 個既有 error 清零：`content-script` 的 case block 補大括號、`text-similarity` 標點 regex 移除字元類別內多餘的 `\[`（以 0-65535 全字元窮舉驗證新舊 regex 等價）、`.eslintrc.json` 以 `overrides` 補上 `crypto-utils` 的 `WorkerGlobalScope` 與 `pcm-processor` 的 AudioWorklet 全域。後兩者與 `types/globals.d.ts` 同根因——code 跑在非 window 環境，標準定義與 ESLint globals 都沒收 (`6025858`)

#### Removed
- `.mcp.json` 移出版控並加入 `.gitignore` (`b9ee95f`)

---

### Phase 2：Deepgram Streaming（2025-11-16 ~ 2025-12-02）

#### Added
- `DeepgramKeyManager`：獨立於 OpenAI 的 Deepgram 金鑰管理，驗證時檢查 `usage:write` 權限 (`f362770`, `40d54c3`)
- `DeepgramStreamClient`：WebSocket 即時串流，含 interim/final transcript 處理與重連機制 (`5e06c04`, `ab9802a`)
- `pcm-processor.js`：AudioWorklet 即時 48kHz → 16kHz 降採樣，輸出 20ms Int16 frames
- Nova-2 / Nova-3 模型選擇與 12 種語言設定，Nova-3 支援 `multi` 自動偵測 (`09dd7bd`)
- Popup 新增 Deepgram 頁籤與雙引擎切換 UI
- Tab 靜音修復：Offscreen Document 用 `<audio>` 元素鏡射播放 MediaStream，繞過 Chrome tabCapture 強制靜音（Chromium issue 387750）

#### Fixed
- Deepgram WebSocket Schema Error 與語言設定錯誤 (`fd0c44c`)
- Deepgram API 驗證改用 GET 方法並強化錯誤診斷 (`11ad733`)
- Content Script 改為被動啟用 (`bb76fcf`)
- 多項 UI 與啟用機制問題 (`d44deec`)

#### Notes
- Phase 2.3 實體測試驗證：API 整合測試 12/12 通過 (`df3b6bc`)
- 已知限制：`multi` 自動偵測不支援中文與韓文；Nova-3 不支援 `zh-TW` / `zh`；中英夾雜內容目前無可用配置

---

### Phase 1：Whisper 管線與字幕顯示（2025-11-09 ~ 2025-11-15）

#### Added
- Whisper 音訊處理管線與 `WhisperClient` (`1aa0cf5`)
- Content Script 影片時間同步字幕顯示 (`051ee78`)
- 動態字幕定位：`getBoundingClientRect()` + `ResizeObserver`，支援 normal / theater / fullscreen (`897c38c`, `d766d30`)
- 動態時間同步：辨識完成後查詢 `video.currentTime` 往回推算，取代累積計算 (`13a8abd`, `e575eb7`)
- 授權合規說明與致謝 (`6eb14d7`)

#### Changed
- 音訊處理遷移至 Offscreen Document 以符合 Manifest V3 (`ffea0e6`, `a0fd5e0`)
- **音訊管線由 `ScriptProcessorNode` 改為 `MediaRecorder`**——這是 Phase 1 最關鍵的架構變更 (`86b5777`)

#### Fixed
- 瀏覽器完全凍結：根因是 `ScriptProcessorNode` + `AudioContext` 在 Offscreen Document 中與 `tabCapture` 組合觸發 Chrome 底層死鎖 (`0c7a215`, `86b5777`)
- WebM header 缺失導致 95% chunk 回 `WHISPER_UNSUPPORTED_FORMAT`，辨識成功率 **4.3% → 100%** (`0253052`)
- `onaudioprocess` callback 中的阻塞 `await` (`3113591`)
- chunkBuffer 記憶體使用優化，移除 spread operator (`34d35bf`)
- buffer overflow 與過量 logging 造成的效能問題 (`1027740`)
- Worker timeout、路徑與穩定性問題 (`1616f3c`)
- AudioContext 未播放擷取音訊 (`ef35a7f`)

#### Removed
- lamejs 依賴（LGPL-3.0）與整個 MP3 編碼步驟——改用 MediaRecorder 後不再需要

---

### Phase 0：基礎建置與安全機制（2025-11-08 ~ 2025-11-09）

#### Added
- Manifest V3 專案骨架與 Vite 建置系統 (`4024bd7`)
- API Key AES-256-GCM 加密儲存，PBKDF2-SHA256 100,000 迭代 (`a7da2a8`)
- `BabelBridgeError` 統一錯誤處理與 `ErrorCodes`
- 成本追蹤與預算警告（達 80% / 100% 提醒）

#### Fixed
- Service Worker 環境下 crypto 指紋生成不相容 (`f9fb901`)
- 跨 context 瀏覽器指紋不一致 (`d031c68`)
- `WhisperClient` 改用 `APIKeyManager` 取得金鑰 (`54fe983`)

#### Removed
- 本機開發工具設定檔移出版控 (`328ebaa`)

---

[Unreleased]: https://github.com/tznthou/Babel_Bridge/commits/master
