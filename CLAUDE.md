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
chrome.tabCapture → AudioChunker (Rolling Window) → Web Worker (MP3 編碼)
→ Whisper API → OverlapProcessor (斷句優化) → GPT 翻譯 → Content Script 顯示
```

**Rolling Window 策略**:
- 每段 3 秒音訊,前後重疊 1 秒
- 重疊區用於比對與優化斷句,避免句子被切斷
- 配置: `CHUNK_CONFIG` in `audio-chunker.js`

**OverlapProcessor** (`src/background/subtitle-processor.js`):
- 專案最核心的技術模組
- 比對相鄰音訊段的重疊區文字 (時間戳 + 文字相似度)
- 合併破碎句子,去除重複內容

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
- 驗證流程: 格式檢查 → 呼叫 OpenAI `/v1/models` 測試 → 儲存到 `chrome.storage.local`
- 成本追蹤: 記錄每次 Whisper/GPT 呼叫的 tokens/時長,計算成本 ($0.37/小時影片)
- 預算警告: 當月使用超過設定預算的 80% 時提醒

API Key 格式: `sk-` 開頭,共 51 字元 (正則: `/^sk-[A-Za-z0-9]{48}$/`)

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

## 常見問題除錯

### 字幕延遲過高 (> 8 秒)
檢查點:
1. 音訊編碼時間 (應 < 500ms)
2. Whisper API 響應時間 (通常 2-3 秒)
3. 網路連線品質
4. 是否啟用翻譯 (翻譯額外增加 2-3 秒)

### Content Script 未注入
1. 檢查 `manifest.json` 的 `content_scripts.matches` 是否涵蓋目標網站
2. 確認 `run_at: "document_idle"` 時機正確
3. 在 DevTools Console 檢查是否有載入錯誤

### API 呼叫失敗
1. 驗證 API Key 是否有效 (`APIKeyManager.verifyAndSave()`)
2. 檢查 OpenAI 帳戶額度
3. 查看 Network tab 是否有 CORS 或 429 (Rate Limit) 錯誤

## 專案狀態

目前專案處於**規劃階段**,已完成:
- ✅ PRD (產品需求文件)
- ✅ SPEC (技術規格文件)
- ✅ README (架構總覽)

待開發 (按 Milestone 順序):
- Phase 1: 基礎辨識 (音訊擷取 + Whisper 整合)
- Phase 2: 字幕顯示 (Content Script + Popup UI)
- Phase 3: 翻譯功能 (GPT 整合 + 雙層字幕)

## 參考文件

完整規格與 API 契約請查閱:
- [PRD.md](PRD.md) - 產品需求與使用者故事
- [SPEC.md](SPEC.md) - 系統規格與 API 詳細定義
- [README.md](README.md) - 專案架構與技術棧總覽
