# 開發里程碑

各階段的實作內容、驗收結果與關鍵數據。README 只放狀態總表，細節在這裡。

| Phase | 期間 | 狀態 | 核心成果 |
|-------|------|------|----------|
| [Phase 0](#phase-0基礎建置與安全機制) | 2025-11-08 | ✅ | API Key 加密儲存、統一錯誤處理 |
| [Phase 1](#phase-1whisper-管線與字幕顯示) | 2025-11-09 ~ 11-15 | ✅ | Whisper 管線、OverlapProcessor、動態時間同步（MVP） |
| [Phase 2](#phase-2deepgram-streaming) | 2025-11-16 ~ 12-02 | ✅ | Deepgram 即時串流、模型與語言選擇 |
| [Phase 3](#phase-3ui-優化與翻譯功能) | — | 🔲 | 字幕樣式自訂、翻譯整合、雙層字幕 |

---

## Phase 0：基礎建置與安全機制

**完成日期**：2025-11-08

### 專案架構
- Vite 建置系統（Manifest V3）
- 統一錯誤處理：`BabelBridgeError` + `ErrorCodes`
- 全域配置系統：`STORAGE_KEYS`、`COST_CONFIG`

### API Key 管理系統
- **格式驗證**：支援 4 種 OpenAI Key 格式（Standard / Project / Admin / Org）
- **真實性驗證**：呼叫 OpenAI `/v1/models` 測試端點
- **加密儲存**：AES-256-GCM + PBKDF2-SHA256（100,000 迭代）
- **金鑰衍生**：以瀏覽器指紋（UserAgent + 硬體特徵）產生，使用者無需記憶密碼
- **成本追蹤**：Whisper 與 GPT 使用量記錄
- **預算警告**：達 80% / 100% 提醒

### 驗收
API Key 能安全儲存與驗證，Extension 可成功載入。6 項安全性測試通過。

**產出規模**：`crypto-utils.js` 約 260 行、`api-key-manager.js` 約 450 行、`popup.js` 約 220 行。建置產物 popup 5.33 KB、service-worker 8.75 KB（皆為 gzip 後）。

---

## Phase 1：Whisper 管線與字幕顯示

**期間**：2025-11-09 ~ 2025-11-15

這個階段的三個關鍵修復都不是加功能，而是拆掉錯誤的架構選擇。原始記錄見 [archive/NewWay.md](archive/NewWay.md) 與 [archive/NewWay2.md](archive/NewWay2.md)。

### 音訊管線遷移（2025-11-09 ~ 11-11）

**問題**：瀏覽器完全凍結。

**根因**：`ScriptProcessorNode`（已 deprecated）+ `AudioContext` 在 Offscreen Document 中與 `tabCapture` 組合，觸發 Chrome 底層死鎖。

**解法**：整條管線改用 `MediaRecorder`，直接對 MediaStream 以 3 秒 timeslice 產生 `audio/webm` chunk。順帶移除 lamejs（LGPL-3.0）依賴與 MP3 編碼步驟。

**教訓**：架構選擇錯誤 > 實作細節錯誤。優先替換問題模組，而非修補症狀。

### WebM Header 補強（2025-11-11）

**問題**：只有第一個 chunk 能被 Whisper 轉錄，後續 95% 都回 `WHISPER_UNSUPPORTED_FORMAT`。

**根因**：MediaRecorder 以 timeslice 切片時，chunk1 之後不帶 EBML header，無法獨立解碼。

**解法**：`extractWebMHeader()` 從 chunk0 解析 header（尋找 Cluster signature `0x1F 0x43 0xB6 0x75`），`prepareWebMChunk()` 對後續 chunk 自動 `concat(header + chunk)`。

**成果**：Whisper 辨識成功率 **4.3% → 100%**（chunk0-50 全數通過，逐一上傳驗證）。

### 動態字幕定位（2025-11-11）

**問題**：字幕顯示在 viewport 外的錯誤位置。

**解法**：`getBoundingClientRect()` 動態計算 + `ResizeObserver` 監聽尺寸變化，採 `position: fixed` + 動態座標，不注入容器到頁面 DOM。

**成果**：normal / theater / fullscreen 三種模式皆精確對齊播放器。

**參考**：[igrigorik/videospeed](https://github.com/igrigorik/videospeed)（MIT）、[siloor/youtube.external.subtitle](https://github.com/siloor/youtube.external.subtitle)（MIT）

### 動態時間同步（2025-11-15）

**問題**：舊方案用累積計算（`captureTime + audioElapsed`），影片一暫停就產生 25-35 秒誤差。

**解法**：改為 Whisper 辨識完成後即時查詢 `video.currentTime`，往回推算音訊起點：

```javascript
const audioDuration = audioEndTime - audioStartTime;
const correctedVideoStartTime = currentVideoTime - audioDuration;
```

**測試結果**（TED Talk 2 分鐘，完整播放不暫停）：
- 處理 36 個 chunks，成功率 100%
- timeDiff 穩定在 **0.7-2.5 秒**（誤差主要來自 Whisper 處理延遲本身）
- 暫停不再累積誤差，字幕連續產生無中斷

**參考**：[JavascriptSubtitlesOctopus](https://github.com/libass/JavascriptSubtitlesOctopus)（MIT，timeOffset 機制）、[netflix_subtitles_adder](https://github.com/chamika1/netflix_subtitles_adder)（MIT，currentTime 同步）

### Whisper 路徑的延遲極限

```
MediaRecorder 累積     3 秒
Whisper API 處理     2-3 秒
網路傳輸           0.5-1 秒
─────────────────────────
總計               5.5-7 秒
```

這是雲端 Whisper 架構的下限，無法再壓。要更低只能換本地模型（如 transformers.js）。這也是後來做 Deepgram 引擎的直接動機。

### Git 提交記錄

| Commit | 內容 | 日期 |
|--------|------|------|
| `86b5777` | MediaRecorder 管線遷移 | 2025-11-09 |
| `0253052` | WebM Header 修復，100% Whisper 成功率 | 2025-11-11 |
| `897c38c` | 動態字幕定位 | 2025-11-11 |
| `d766d30` | VideoMonitor getter 修復 | 2025-11-11 |
| `13a8abd` | 動態時間同步實作 | 2025-11-15 |

---

## Phase 2：Deepgram Streaming

**期間**：2025-11-16 ~ 2025-12-02。接手指南見 [archive/NewWay3.md](archive/NewWay3.md)。

### 2.0 API Key 管理
`DeepgramKeyManager` 獨立管理 Deepgram 金鑰（與 OpenAI 分開），Popup 增設 Deepgram 頁籤，驗證時檢查 `usage:write` 權限。

### 2.1 WebSocket Streaming MVP
- `DeepgramStreamClient`：WebSocket 連線、interim/final transcript 處理、重連與 KeepAlive
- `pcm-processor.js`：AudioWorklet 即時 48kHz → 16kHz 降採樣，輸出 20ms Int16 frames
- **Tab 靜音修復**：Chrome tabCapture 會強制靜音原分頁（Chromium issue 387750），解法是在 Offscreen Document 用 `<audio>` 元素鏡射播放 MediaStream

### 2.2 模型與語言選擇（2025-11-30）
- Nova-2（$0.0043/min）/ Nova-3（$0.0077/min）
- 12 種語言 + Nova-3 的 `multi` 自動偵測
- Nova-2 選取時自動禁用「自動偵測」選項

### 2.3 實體測試驗證（2025-12-02）

**API 整合測試**：12/12 通過。Nova-2 所有語言正常；Nova-3 的 `multi`、`en-US`、`en`、`ja` 正常，`zh-TW` / `zh` 回 HTTP 400。

**YouTube 實測**：

| 場景 | 配置 | 結果 |
|------|------|------|
| 英文（TED Talk） | Nova-2 + multi | ✅ 字幕流暢 |
| 純中文 | Nova-2 + zh-TW | ✅ 辨識準確 |
| 中英夾雜 | Nova-2 + zh-TW | ❌ 英文變亂碼 |
| 中英夾雜 | Nova-3 + multi | ❌ 回傳空白 |

**Deepgram 語言限制**（實測結論）：
- `multi` 自動偵測**不支援中文與韓文**
- Nova-3 **不支援** `zh-TW` / `zh`
- **中英夾雜內容目前無解**：選中文則英文亂碼，選自動偵測則中文消失

**Whisper 實體測試決議**：不做。5-7 秒延遲違背即時字幕的目的，且無價格優勢（$0.006/min vs Deepgram $0.0043-0.0077/min）。

### Git 提交記錄

| Commit | 內容 | 日期 |
|--------|------|------|
| `ab9802a` | Deepgram Streaming pipeline 整合 | 2025-11-16 |
| `fd0c44c` | 修復 WebSocket Schema Error 與語言設定 | 2025-11-16 |
| `09dd7bd` | 新增模型與語言選擇功能 | 2025-11-30 |

---

## Phase 3：UI 優化與翻譯功能

**狀態**：待開發

- 🔲 字幕樣式自訂（大小、顏色、位置、透明度）
- 🔲 雙層字幕（原文 + 翻譯同時顯示）
- 🔲 翻譯引擎整合
- 🔲 成本統計視覺化

**翻譯引擎選型待定**：原訂 GPT-4o-mini，但即時字幕的競品其實是專用翻譯 API（LLM 有 TTFT 加逐 token 生成的固有延遲）。DeepL 等選項待評估。

**驗收標準**：字幕樣式可自訂，能同時顯示原文與翻譯。

---

## 已知問題

| 問題 | 影響 | 優先度 |
|------|------|--------|
| 中英夾雜內容無可用配置（見 Phase 2.3） | 雙語影片辨識品質差 | 中 |
| 整體測試覆蓋率 41.47%，未達 70% 目標 | 六個模組完全無測試（見下） | 中 |
| `tests/e2e/` 為空，Playwright 尚未寫任何測試 | 無端對端自動化驗證 | 中 |
| Deepgram 延遲「2-3 秒」未經實測，且未區分 interim first-paint 與 final 定版 | 對外數據無依據，也影響 Phase 3 的 UI 決策 | 中 |
| `vitest.config.js` 未排除 `scripts/`，一次性腳本計入覆蓋率分母 | 整體數字被低估 | 低 |
| `offscreen.html` 第 8 行有 inline `<script>`，違反 CSP | 該段診斷 log 不執行，主功能正常 | 低 |
| MCP chrome-devtools 控制的 Chrome 無法載入 Extension | 只能用正常 Chrome 視窗手動測試 | 低 |

### 覆蓋率現況（2026-08-11 實測）

| 模組 | Stmts | 備註 |
|------|------:|------|
| `config.js` | 100% | |
| `subtitle-processor.js` | 93.5% | OverlapProcessor，早期文件誤記為 100% |
| `deepgram-stream-client.js` | 90.8% | |
| `text-similarity.js` | 89.1% | |
| `deepgram-key-manager.js` | 85.8% | |
| `errors.js` | 85.3% | |
| `language-rules.js` | 67.8% | |
| `service-worker.js` | 62.2% | |
| `audio-chunker.js` | 42.5% | |
| `api-key-manager.js` | 42.3% | |
| `crypto-utils.js` | 27.5% | |
| `content-script.js`、`popup.js`、`offscreen.js`、`pcm-processor.js`、`whisper-client.js`、`audio-capture.js`、`error-handler.js` | **0%** | 完全無測試 |

---

## 未來改進方向

尚未排程，記錄下來避免遺忘。

**加密**
- 支援使用者自訂密碼（可選，補足瀏覽器指紋換裝置就失效的缺點）
- API Key 輪換提醒（每 90 天）
- 瀏覽器指紋變更警告

**效能**
- Subtitle Cache：避免重複辨識相同片段
- 音訊 Buffer 記憶體優化

**使用者體驗**
- 預算通知系統（達 80% / 100% 彈出通知）
- 離線模式：快取最近使用的字幕
- 多語言 UI（目前僅繁體中文）
