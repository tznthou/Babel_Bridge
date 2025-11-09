# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

Babel Bridge 是一個 Chrome Extension (Manifest V3),為網路影片提供 AI 驅動的即時字幕與多語言翻譯。核心技術棧:
- **語音辨識**: OpenAI Whisper API
- **翻譯**: GPT-4o-mini
- **音訊擷取**: chrome.tabCapture + Web Audio API
- **架構**: Background Service Worker + Content Script + Popup UI

## 常用開發命令

```bash
# 安裝依賴
npm install

# 開發模式 (熱重載)
npm run dev

# 執行測試
npm run test              # 全部測試
npm run test:unit         # 單元測試
npm run test:e2e          # E2E 測試 (Playwright)
npm run test:coverage     # 測試覆蓋率報告

# 打包與發布
npm run build             # 打包生產版本
npm run package           # 生成 Chrome Web Store 上架 .zip 檔

# Linting
npm run lint              # 執行 ESLint
npm run format            # Prettier 格式化
```

載入 Extension 到 Chrome:
1. `chrome://extensions/` → 開啟「開發人員模式」
2. 「載入未封裝項目」→ 選擇 `dist/` 資料夾

## 核心架構要點

### 三層架構
1. **Background Service Worker** (`src/background/`)
   - 核心控制器,編排音訊處理流程
   - 管理 API 呼叫 (Whisper, GPT)
   - 透過 `chrome.runtime.sendMessage()` 與其他模組通訊

2. **Content Script** (`src/content/`)
   - 注入目標網頁,渲染字幕 Overlay UI
   - 監聽影片 play/pause/seek 事件
   - 接收 Background 傳來的字幕資料並顯示

3. **Popup UI** (`src/popup/`)
   - 使用者控制介面 (啟用/停用、API Key 設定、樣式調整)
   - 顯示成本統計與使用量

### 音訊處理流程 (Critical Path)

```
chrome.tabCapture → AudioCapture → AudioChunker (Rolling Window)
→ MP3Encoder Worker (lamejs) → WhisperClient (API)
→ OverlapProcessor (斷句優化 + 去重) → Content Script (時間同步顯示)
```

**完整流程細節**:
1. **AudioCapture**: 使用 `chrome.tabCapture.capture()` 擷取 tab 音訊流
2. **AudioChunker**: 3 秒音訊段 + 1 秒重疊區 (Rolling Window)
3. **MP3Encoder Worker**: Float32 → Int16 → MP3 (16kHz, 單聲道, 128kbps)
4. **WhisperClient**: 上傳 MP3 → Whisper API → verbose_json (含 segments 與時間戳)
5. **OverlapProcessor**:
   - 調整 segments 時間戳為絕對時間
   - 比對重疊區 (80% time OR 50% time + 80% text similarity)
   - 過濾重複 segments (15-25% 過濾率)
   - 多語言斷句優化
6. **Content Script**:
   - VideoMonitor 監聽 video.currentTime
   - 根據時間動態顯示對應 segment
   - 支援 play/pause/seek 事件

**Rolling Window 策略**:
- 每段 3 秒音訊,前後重疊 1 秒
- 重疊區用於比對與優化斷句,避免句子被切斷
- 配置: `CHUNK_CONFIG` in `src/lib/config.js`

**OverlapProcessor** (`src/background/subtitle-processor.js`):
- **專案最核心的技術模組** (418 lines)
- 雙重去重策略: 80% 時間戳重疊 OR (50% 時間戳 + 80% 文字相似度)
- Levenshtein Distance 計算文字相似度
- 多語言斷句規則 (中/英/日/韓/歐洲語系)
- 測試覆蓋率: 100%

## 重要技術規範

### 通訊協定

Background ↔ Content Script 使用統一的 Message 格式:

```javascript
interface Message {
  type: string            // 訊息類型 (如 'SUBTITLE_UPDATE')
  data: any               // 訊息資料
  timestamp: number       // 時間戳記
}
```

常見訊息類型:
- `SUBTITLE_UPDATE`: Background → Content (新字幕產生)
- `STYLE_UPDATE`: Background → Content (樣式變更)
- `ENABLE_SUBTITLES`: Popup → Background (啟用功能)
- `DISABLE_SUBTITLES`: Popup → Background (停用功能)

詳細規格見 [SPEC.md](SPEC.md) § 4.1

### 錯誤處理

統一使用 `BabelBridgeError` 類別:

```javascript
class BabelBridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.code = code      // 錯誤碼 (如 'API_KEY_INVALID')
    this.details = details
    this.timestamp = Date.now()
  }
}
```

所有模組的錯誤應傳遞至 `ErrorHandler.handle(error)` 統一處理,包含重試邏輯與使用者提示。

錯誤碼表見 [SPEC.md](SPEC.md) § 5.2

### API Key 管理

`APIKeyManager` (`src/lib/api-key-manager.js`) 負責:
- **驗證流程**: 格式檢查 → 呼叫 OpenAI `/v1/models` 測試 → AES-GCM 加密 → 儲存到 `chrome.storage.local`
- **加密儲存**: 使用 Web Crypto API (AES-256-GCM + PBKDF2-SHA256) 加密保護 API Key
- **成本追蹤**: 記錄每次 Whisper/GPT 呼叫的 tokens/時長,計算成本 ($0.37/小時影片)
- **預算警告**: 當月使用超過設定預算的 80% 時提醒

**支援的 API Key 格式**:
- Standard Key: `sk-[48字元]` (舊格式)
- Project Key: `sk-proj-[字串]` (新格式，推薦)
- Admin Key: `sk-admin-[字串]`
- Organization Key: `sk-org-[字串]`

正則表達式: `/^sk-(?:proj-|admin-|org-)?[A-Za-z0-9_-]{20,}$/`

**加密技術規格** (`src/lib/crypto-utils.js`):
- 演算法: AES-256-GCM (AEAD)
- 金鑰衍生: PBKDF2-SHA256 (100,000 迭代)
- IV: 12 bytes 隨機生成
- Salt: 16 bytes 隨機生成
- 瀏覽器指紋: UserAgent + 硬體特徵

## 開發規範

### 程式碼風格
- **語言**: TypeScript 優先,JavaScript (ES6+) 可接受
- **Linting**: ESLint + Prettier
- **命名**:
  - 類別: `PascalCase` (如 `AudioCapture`)
  - 函數: `camelCase` (如 `startCapture()`)
  - 常數: `UPPER_SNAKE_CASE` (如 `CHUNK_CONFIG`)
  - 檔案: `kebab-case` (如 `audio-capture.js`)

### Commit 規範
遵循 Conventional Commits:
```
feat: add Whisper API integration
fix: resolve overlap detection bug
docs: update API documentation
test: add unit tests for AudioChunker
refactor: simplify error handling
```

### 測試要求
- **目標覆蓋率**: ≥ 70%
- Audio Processing 模組: ≥ 80%
- 每個公開函數都應有 JSDoc 註解
- 關鍵流程需有整合測試 (如 `audio-pipeline.test.js`)

## 關鍵技術決策

1. **為何使用 Manifest V3**
   Chrome 從 2023 年起強制新 Extension 使用 V3,Service Worker 取代 Background Page。

2. **為何選擇 Rolling Window 而非固定切段**
   固定切段會在句子中間切斷,導致斷句錯誤。重疊區讓我們能事後優化斷句點。

3. **為何音訊編碼在 Web Worker**
   MP3 編碼是 CPU 密集操作,在 Worker 執行避免阻塞 Service Worker 主執行緒。

4. **為何使用 GPT-4o-mini 而非 GPT-4o**
   成本考量。翻譯字幕是簡單任務,mini 版已足夠 (價格低 10 倍)。

5. **為何需要 OverlapProcessor**
   Whisper 無法保證相鄰音訊段的辨識結果在重疊區一致,需要人工比對去重與斷句優化。

6. **為何使用 AES-GCM 加密 API Key**
   防止惡意 Extension 或本地惡意軟體竊取 API Key。使用 AES-256-GCM (AEAD) 提供機密性與完整性保護,PBKDF2-100k 迭代符合 OWASP 2023 建議,瀏覽器指紋衍生金鑰無需使用者記憶密碼。安全評分: 96/100。

## 常見問題除錯

### 字幕延遲過高 (> 8 秒)
檢查點:
1. **音訊編碼時間** (應 < 500ms) - 查看 Console `[SubtitleService] MP3 編碼完成`
2. **Whisper API 響應時間** (通常 2-3 秒) - 查看 Console `[SubtitleService] Whisper 辨識完成`
3. **OverlapProcessor 處理時間** (應 < 10ms) - 查看 Console `[SubtitleService] OverlapProcessor 處理完成`
4. **網路連線品質** - 檢查 Network tab
5. **是否啟用翻譯** (翻譯額外增加 2-3 秒) - 目前 Phase 1 未實作

**預期總延遲**: 5.3-6.5 秒 (3s 累積 + 0.5s 編碼 + 2-3s Whisper)

### 字幕未顯示或不同步
檢查點:
1. **VideoMonitor 是否附加** - Console 應顯示 `[VideoMonitor] 已附加到 video 元素`
2. **Segments 是否接收** - Console 應顯示 `[ContentScript] 接收字幕資料`
3. **當前時間是否有對應 segment** - Console 顯示 `[ContentScript] 顯示字幕`
4. **影片是否正在播放** - 暫停時字幕會停止更新
5. **CSS 是否載入** - 檢查 `subtitle-overlay.css` 是否正確注入

**除錯指令**:
```javascript
// 在 DevTools Console 執行
document.querySelector('video').currentTime  // 檢查影片時間
document.querySelector('#babel-bridge-subtitle-overlay')  // 檢查字幕容器
```

### OverlapProcessor 過濾率異常
正常過濾率: **15-25%**

**過濾率過高 (> 40%)**:
- 可能原因: `similarityThreshold` 設定過低
- 解決: 調整 `OVERLAP_CONFIG.similarityThreshold` (預設 0.8)

**過濾率過低 (< 5%)**:
- 可能原因: Whisper 在重疊區產生完全不同的辨識結果
- 解決: 檢查音訊品質,考慮增加重疊區長度

### Content Script 未注入
1. 檢查 `manifest.json` 的 `content_scripts.matches` 是否涵蓋目標網站
2. 確認 `run_at: "document_idle"` 時機正確
3. 在 DevTools Console 檢查是否有載入錯誤
4. 確認 Extension 已啟用且有權限

### API 呼叫失敗
1. **驗證 API Key** - 使用 `APIKeyManager.verifyAndSave()`
2. **檢查 OpenAI 帳戶額度** - 登入 OpenAI 查看餘額
3. **Network tab 檢查**:
   - CORS 錯誤: 檢查 `manifest.json` 的 `host_permissions`
   - 429 Too Many Requests: 達到 Rate Limit,稍後重試
   - 401 Unauthorized: API Key 無效或過期

### API Key 解密失敗
1. **可能原因**: 更換了瀏覽器或電腦 (瀏覽器指紋改變)
2. **解決方法**: 點擊「更換 API Key」重新輸入
3. **安全考量**: 這是設計的安全特性,防止跨裝置複製加密資料
4. **技術細節**: 使用瀏覽器指紋 (UserAgent + 硬體) 衍生加密金鑰

## 已知問題與技術債務

### ⚠️ 待解決問題

1. **Vite 建置路徑問題**
   - 現象: `popup.html` 中的資源路徑被轉為絕對路徑
   - 影響: 需要手動調整建置後的路徑
   - 臨時方案: 建置後手動修復
   - TODO: 調整 `vite.config.js` 的 `base` 和 `build.rollupOptions` 配置

2. **測試覆蓋率不足**
   - 現狀: 部分模組測試覆蓋率低 (OverlapProcessor: 100%, 其他模組: 0-30%)
   - 影響: 無法全面自動驗證功能正確性
   - TODO: 新增單元測試 (目標覆蓋率 ≥ 70%)
   - TODO: 新增 E2E 測試 (Playwright)
   - 已完成: ✅ OverlapProcessor 100% 覆蓋率 + Demo 頁面 5 個互動測試

3. **ScriptProcessorNode 已過時**
   - 現象: AudioChunker 使用的 `ScriptProcessorNode` 已被 W3C 標記為 deprecated
   - 影響: 未來瀏覽器版本可能移除此 API
   - 建議: 遷移至 AudioWorklet API
   - 挑戰: Service Worker 對 AudioWorklet 的支援有限

4. **Chrome Automation Mode 限制**
   - 現象: MCP chrome-devtools 控制的 Chrome 無法載入 Extension
   - 影響: 無法使用自動化工具測試 Extension
   - 解決方案: 使用正常 Chrome 視窗手動測試

### ✅ 已修復問題

1. ~~**Content Script 時間同步問題**~~ (已於 2025-11-09 修復)
   - ~~現象: 字幕顯示完整文字,未根據影片時間逐句顯示~~
   - ~~影響: 使用者體驗不佳,字幕與影片不同步~~
   - ✅ **修復**: 實作 VideoMonitor 類別,監聽 video 元素的 timeupdate 事件
   - ✅ **修復**: 根據 `video.currentTime` 動態查找並顯示對應的 segment
   - ✅ **修復**: 支援 play/pause/seek 事件的即時響應
   - ✅ **驗證**: Demo 頁面測試 5 通過,字幕與影片完美同步

### 💡 未來改進方向

1. **加密增強**
   - 考慮支援使用者自訂密碼 (可選)
   - 實作 API Key 輪換提醒 (每 90 天)
   - 增加異常登入偵測 (瀏覽器指紋變更警告)

2. **效能優化**
   - 實作 Subtitle Cache 機制 (避免重複辨識相同片段)
   - Web Worker 池化 (減少 Worker 建立開銷)
   - 音訊 Buffer 記憶體優化

3. **使用者體驗**
   - 預算通知系統 (達 80% 和 100% 時彈出通知)
   - 離線模式 (快取最近使用的字幕)
   - 多語言 UI (目前僅繁體中文)

## 專案狀態

目前專案處於 **Phase 1 已完成,準備進入 Phase 2** 階段 (更新日期: 2025-11-09)

### Phase 0: 基礎建置與安全機制 ✅ (已完成)
- ✅ PRD (產品需求文件)
- ✅ SPEC (技術規格文件)
- ✅ README (架構總覽)
- ✅ Vite 建置系統配置 (Manifest V3)
- ✅ 專案結構建立 (Background/Content/Popup/Lib/Workers)
- ✅ API Key 驗證系統 (支援 4 種 OpenAI Key 格式)
- ✅ **API Key 加密儲存** (AES-256-GCM + PBKDF2)
- ✅ 統一錯誤處理機制 (BabelBridgeError)
- ✅ 成本追蹤框架
- ✅ 安全性測試 (6 項測試全過,評分 96/100)

**關鍵成果**:
- 新增 `crypto-utils.js` 加密模組 (~260 行)
- 更新 `api-key-manager.js` 整合加密 (~450 行)
- 更新 `popup.js` 支援遮罩顯示與更換 API Key 流程
- 建置產物大小: popup 5.33 KB (gzip), service-worker 8.75 KB (gzip)

### Phase 1: 基礎辨識功能 ✅ (已完成)
- ✅ 音訊擷取 (chrome.tabCapture) - `audio-capture.js` (182 lines)
- ✅ 音訊切塊 (Rolling Window: 3 秒音訊,重疊 1 秒) - `audio-chunker.js` (227 lines)
- ✅ MP3 編碼 (Web Worker + lamejs) - `mp3-encoder.js` (192 lines) + Worker (124 lines)
- ✅ Whisper API 整合 - `whisper-client.js` (265 lines)
- ✅ OverlapProcessor (斷句優化) - `subtitle-processor.js` (418 lines)
- ✅ 基礎字幕顯示 - `content-script.js` (329 lines) + CSS (96 lines)
- ✅ **時間同步字幕顯示** - VideoMonitor 類別,根據影片時間動態顯示
- ✅ 多語言斷句規則 - `language-rules.js` (352 lines)
- ✅ 文字相似度計算 - `text-similarity.js` (Levenshtein Distance)

**關鍵成果**:
- 完整音訊處理管線已建立 (~2,900 lines)
- OverlapProcessor 雙重去重策略 (80% time OR 50% time + 80% text)
- Content Script 時間同步修復 (支援 play/pause/seek)
- 測試覆蓋: OverlapProcessor 100%, 整體 Demo 頁面 5 個測試
- Git 提交: `1aa0cf5` (pipeline) + `051ee78` (time sync)

### 待開發 (按 Milestone 順序):

#### Phase 2: 使用者介面優化 (預計 2-3 天)
- 🔲 Popup UI 完善
- 🔲 字幕樣式自訂
- 🔲 成本統計圖表

#### Phase 3: 翻譯功能 (預計 2 天)
- 🔲 GPT-4o-mini 整合
- 🔲 雙層字幕顯示

## 參考文件

### 核心文件
- [PRD.md](PRD.md) - 產品需求與使用者故事
- [SPEC.md](SPEC.md) - 系統規格與 API 詳細定義
- [README.md](README.md) - 專案架構與技術棧總覽
- [CLAUDE.md](CLAUDE.md) - Claude 開發指引 (本文件)

### 開發記錄 (Serena 記憶)
- `.serena/memories/phase1-completion-2025-11-09.md` - **Phase 1 完整記錄** (11 個模組詳細規格)
- `.serena/memories/development-progress-2025-11-08.md` - 詳細開發進度記錄
- `.serena/memories/project-status-2025-11-08.md` - 專案狀態總覽
- `.serena/memories/testing-2025-11-08.md` - Extension 測試記錄

### 重要原始碼

**Phase 0 基礎架構**:
- `src/lib/crypto-utils.js` - 加密工具模組 (AES-GCM)
- `src/lib/api-key-manager.js` - API Key 管理與成本追蹤
- `src/lib/errors.js` - 統一錯誤處理
- `src/lib/config.js` - 全域配置 (CHUNK_CONFIG, WHISPER_CONFIG, OVERLAP_CONFIG)
- `manifest.json` - Extension 配置 (Manifest V3)

**Phase 1 音訊處理管線**:
- `src/background/audio-capture.js` - 音訊擷取 (chrome.tabCapture)
- `src/background/audio-chunker.js` - Rolling Window 切塊
- `src/background/mp3-encoder.js` - MP3 編碼器包裝
- `src/workers/mp3-encoder.worker.js` - MP3 編碼 Worker (lamejs)
- `src/background/whisper-client.js` - Whisper API 整合
- `src/background/subtitle-processor.js` - **OverlapProcessor** (核心去重與斷句)
- `src/lib/language-rules.js` - 多語言斷句規則
- `src/lib/text-similarity.js` - Levenshtein Distance 相似度計算

**Phase 1 字幕顯示**:
- `src/content/content-script.js` - Content Script (VideoMonitor + SubtitleOverlay)
- `src/content/subtitle-overlay.css` - 字幕樣式

**核心控制器**:
- `src/background/service-worker.js` - **主控制器** (編排整個音訊處理流程)
- `src/popup/popup.js` - Popup UI 邏輯

**測試與 Demo**:
- `tests/unit/overlap-processor.test.js` - OverlapProcessor 單元測試 (100% 覆蓋率)
- `demo/overlap-processor-demo.html` - 互動測試頁面 (5 個測試)
