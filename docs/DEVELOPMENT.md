# 開發指南

**現行架構的主文件。** 要知道系統現在長什麼樣、為什麼這樣設計、出問題怎麼查，看這裡。

- 各階段的驗收數據與根因分析 → [MILESTONES.md](MILESTONES.md)
- 變更記錄 → [../CHANGELOG.md](../CHANGELOG.md)
- 當初的設計稿（架構已變更，僅供追溯）→ [SPEC.md](SPEC.md)、[PRD.md](PRD.md)

---

## 快速開始

### 環境需求

- Node.js ≥ 18
- Chrome ≥ 116（Offscreen Document API 需求）
- OpenAI API Key（Whisper 引擎）或 Deepgram API Key（串流引擎），擇一即可

### 安裝與建置

```bash
npm install
npm run dev      # watch 模式，改檔自動重新打包
npm run build    # 生產版本
```

`npm run build` 除了 Vite 打包，還會複製 icons、複製 `pcm-processor.js`（AudioWorklet 必須是獨立檔案），並執行 `scripts/fix-paths.js` 修正 Vite 對 `offscreen.html` 產生的錯誤相對路徑。這三步都在 npm script 裡，不需要手動做。

### 載入 Extension

1. `chrome://extensions/` → 開啟「開發人員模式」
2. 「載入未封裝項目」→ 選 `dist/`
3. 點擊 Extension 圖標 → 輸入 API Key → 「驗證並儲存」

Popup 有 OpenAI 與 Deepgram 兩個頁籤，各自獨立儲存金鑰。

---

## 專案結構

```
src/
├── background/                    # Service Worker 與辨識客戶端
│   ├── service-worker.js          # 核心控制器，編排雙引擎管線
│   ├── deepgram-stream-client.js  # Deepgram WebSocket 串流
│   ├── whisper-client.js          # Whisper API 整合
│   ├── subtitle-processor.js      # OverlapProcessor 去重與斷句
│   ├── audio-capture.js           # 音訊擷取
│   └── audio-chunker.js           # Rolling Window 切塊（Whisper 路徑）
├── offscreen/                     # Offscreen Document（MV3 音訊處理）
│   ├── offscreen.html
│   ├── offscreen.js               # MediaRecorder + 鏡射播放
│   └── pcm-processor.js           # AudioWorklet：48kHz → 16kHz PCM
├── content/
│   ├── content-script.js          # VideoMonitor 與字幕渲染
│   └── subtitle-overlay.css
├── popup/
│   ├── popup.html / popup.css
│   └── popup.js                   # 雙金鑰管理、模型與語言選擇
└── lib/
    ├── config.js                  # DEEPGRAM_CONFIG、WHISPER_CONFIG、CHUNK_CONFIG
    ├── api-key-manager.js         # OpenAI 金鑰、成本追蹤
    ├── deepgram-key-manager.js    # Deepgram 金鑰
    ├── crypto-utils.js            # AES-256-GCM 加解密
    ├── errors.js / error-handler.js
    ├── language-rules.js          # 多語言斷句規則
    └── text-similarity.js         # Levenshtein 相似度
```

`pcm-processor.js` 放在 `src/offscreen/` 但不經 Vite 打包——AudioWorklet 要求獨立檔案，由 build script 直接複製。

---

## 現行架構

### 三層

| 層 | 位置 | 職責 |
|----|------|------|
| **Background Service Worker** | `src/background/` | 核心控制器，編排音訊流程、呼叫 API、分發字幕 |
| **Offscreen Document** | `src/offscreen/` | 音訊擷取與處理。MV3 的 Service Worker 沒有 DOM 與 Web Audio，音訊工作只能在這裡做 |
| **Content Script** | `src/content/` | 注入目標網頁，渲染字幕 Overlay，監聽影片事件 |
| **Popup** | `src/popup/` | 金鑰設定、引擎切換、成本統計 |

各層透過 `chrome.runtime.sendMessage()` 通訊，訊息格式為 `{ type, data, timestamp }`。

**訊息類型的真相來源是 `src/lib/config.js` 的 `MessageTypes`**：

| 方向 | 類型 |
|------|------|
| Popup → Background | `ENABLE_SUBTITLES`、`DISABLE_SUBTITLES`、`UPDATE_SETTINGS`、`VERIFY_API_KEY`、`GET_COST_STATS` |
| Background → Content | `SUBTITLE_UPDATE`、`STYLE_UPDATE`、`CLEAR_SUBTITLES` |
| Content → Background | `VIDEO_STATE_CHANGED`、`SUBTITLE_RENDERED` |
| 錯誤回報 | `ERROR` |

Service Worker ↔ Offscreen Document 之間另有一組訊息，目前直接寫字串、未納入 `MessageTypes`：`OFFSCREEN_START_AUDIO_CAPTURE`、`OFFSCREEN_STOP_AUDIO_CAPTURE`、`PCM_FRAME`、`DEEPGRAM_PCM_FRAME`、`GET_VIDEO_CURRENT_TIME`、`STATS`。

**錯誤處理**統一走 `BabelBridgeError`（`src/lib/errors.js`），帶 `code`、`details`、`timestamp`，交由 `ErrorHandler.handle()` 處理重試與使用者提示。錯誤碼共 26 個，定義在同檔的 `ErrorCodes`——**以該檔為準**，[SPEC.md § 5.2](SPEC.md) 的錯誤碼表已與實作脫節。

### 雙引擎

| 引擎 | 延遲 | 準確度 | 適用 |
|------|------|--------|------|
| Deepgram Streaming | 2-3 秒（估計值，**尚未實測驗證**） | 高 | 即時對話、直播、會議 |
| OpenAI Whisper | 5.5-7 秒（已實測） | 極高 | 預錄影片、高品質字幕 |

> Deepgram 的「2-3 秒」沿用自官方文件的量級，本專案尚未實測。而且 interim first-paint（第一個字上螢幕）與 final 定版（字幕不再變動）是兩個不同指標，混為一談會誤導。實測後需訂正此表。

### Deepgram 串流管線

```
chrome.tabCapture → getUserMedia(tab audio) → AudioWorklet (pcm-processor.js)
→ 48kHz → 16kHz PCM 降採樣 → Int16 frames (20ms)
→ Service Worker → DeepgramStreamClient (WebSocket)
→ Deepgram Nova-2/Nova-3 → interim/final transcript
→ Content Script（即時顯示）
```

**模型與語言**（配置在 `src/lib/config.js` 的 `DEEPGRAM_CONFIG`、`DEEPGRAM_MODELS`、`DEEPGRAM_LANGUAGES`）：

| 模型 | 成本 | 特性 |
|------|------|------|
| Nova-2 | $0.0043/min | 需手動選語言 |
| Nova-3 | $0.0077/min | 支援 `language=multi` 自動偵測 |

支援 12 種語言：`zh-TW`、`zh-CN`、`en-US`、`en-GB`、`ja`、`ko`、`de`、`fr`、`es`、`it`、`pt`、`ru`，加上 Nova-3 專屬的 `multi`。

實測出的語言限制（見 [MILESTONES.md § Phase 2.3](MILESTONES.md#phase-2deepgram-streaming)）：`multi` 不支援中文與韓文；Nova-3 不支援 `zh-TW` / `zh`；中英夾雜內容目前無可用配置。

### Whisper 批次管線

```
chrome.tabCapture → getUserMedia(tab audio) → MediaRecorder (3s timeslice)
→ audio/webm chunk → ArrayBuffer → WebM header 補強 → Base64 → Service Worker
→ createAudioBlob() 重建 → Whisper API → OverlapProcessor（去重 + 斷句）
→ Content Script（時間同步顯示）
```

逐步說明：

1. **音訊擷取（Offscreen）**：`getUserMedia({audio: {chromeMediaSource: 'tab'}})` 取得 tab 音訊流，設 `suppressLocalAudioPlayback: true`，再用 `<audio>` 元素鏡射播放，維持單一音訊路徑避免回音。

2. **MediaRecorder**：直接對 MediaStream 啟動，`mediaRecorder.start(3000)` 以 3 秒 timeslice 產生 `audio/webm` chunk。不需要 MP3 編碼。

3. **WebM header 補強**：MediaRecorder 的 chunk1 之後不帶 EBML header，無法獨立解碼。`extractWebMHeader()` 從 chunk0 解析 header（找 Cluster signature `0x1F 0x43 0xB6 0x75`），`prepareWebMChunk()` 對後續 chunk 做 `concat(header + chunk)`。

4. **Base64 傳輸**：Offscreen 把 chunk 轉成 `Blob → ArrayBuffer → Base64` 再附上 `mimeType`、`chunkIndex`、`duration` 送出。

5. **Service Worker 重建**：`createAudioBlob()` 反向做 `Base64 → ArrayBuffer → Blob`。優先讀 Base64，其次 ArrayBuffer，最後才是 Blob（向後相容）。重建失敗拋 `BabelBridgeError`。

6. **辨識與後處理**：`WhisperClient` 上傳 chunk 取回 verbose_json（含 segments 與時間戳），`OverlapProcessor` 校正時間戳、去重、優化斷句。

7. **顯示**：`VideoMonitor` 監聽 `video.currentTime`，依時間顯示對應 segment，支援 play/pause/seek。

**Rolling Window**：每段 3 秒，前後各重疊 1 秒。重疊區用於比對去重與斷句優化，避免句子被切在中間。配置在 `CHUNK_CONFIG`。

**OverlapProcessor**（`src/background/subtitle-processor.js`，約 418 行，statements 覆蓋率 93.5%）是專案最核心的模組。雙重去重判準：80% 時間戳重疊，或 50% 時間戳重疊 + 80% 文字相似度（Levenshtein）。正常過濾率 15-25%。

---

## 設計決策

有些選擇看起來繞路，但改回「直覺做法」會直接把系統弄壞。動這些之前先讀完理由。

### 為何用 MediaRecorder 而非 ScriptProcessorNode

`ScriptProcessorNode`（已 deprecated）+ `AudioContext` 在 Offscreen Document 中與 `tabCapture` 組合，會觸發 Chrome 底層死鎖，**整個瀏覽器凍結**。MediaRecorder 是 Chrome 原生優化路徑，順帶免去 MP3 編碼與 lamejs（LGPL-3.0）依賴，且 webm 可直接餵給 Whisper。

完整排查記錄見 [archive/NewWay.md](archive/NewWay.md)。

### 為何用 Base64 傳音訊而非直接傳 Blob

MV3 的 Service Worker ↔ Offscreen Document 之間，structured clone 對 Blob/File 支援不完整，直接傳會失真。`chrome.runtime.sendMessage` 只保證可序列化物件，所以自行做 Base64 編解碼。

### 為何要鏡射播放音訊

Chrome tabCapture 會強制靜音原分頁（[Chromium issue 387750](https://issues.chromium.org/issues/387750)）。解法是在 Offscreen Document 用 `<audio>` 元素播放同一個 MediaStream，把聲音還給使用者。拿掉這段，使用者會聽不到影片聲音。

### 為何用 Rolling Window 而非固定切段

固定切段會在句子中間切斷，斷句錯誤無法事後補救。重疊區讓 OverlapProcessor 有比對材料可以優化斷句點。

### 為何需要 OverlapProcessor

Whisper 不保證相鄰音訊段在重疊區給出一致結果，必須自行比對去重，否則字幕會重複。

### 為何用動態時間查詢而非累積計算

舊方案 `captureTime + audioElapsed` 在影片暫停時會累積 25-35 秒誤差。改為辨識完成後查詢 `video.currentTime` 往回推算 `currentTime - audioDuration`，實測 timeDiff 穩定在 0.7-2.5 秒。詳見 [MILESTONES.md § 動態時間同步](MILESTONES.md#phase-1whisper-管線與字幕顯示)。

### 為何用 AES-256-GCM 加密 API Key

防止其他 Extension 或本機惡意軟體讀走金鑰。AES-256-GCM 提供機密性與完整性（AEAD），PBKDF2 100k 迭代符合 OWASP 建議，金鑰由瀏覽器指紋衍生所以使用者不必記密碼。

副作用是換瀏覽器或換電腦後指紋改變、金鑰無法解密，必須重新輸入——這是刻意的設計，不是 bug。

### 為何 Manifest V3

Chrome 自 2023 年起強制新 Extension 使用 V3。連帶限制：Service Worker 沒有 DOM 與 Web Audio（所以需要 Offscreen Document）、會被系統回收（所以狀態不能只存在記憶體）。

### 翻譯引擎選型（未定）

原訂 GPT-4o-mini（比 GPT-4o 便宜約 10 倍，翻譯字幕這種任務足夠）。但即時字幕的競品其實是專用翻譯 API——LLM 有 TTFT 加逐 token 生成的固有延遲。DeepL 等選項待評估。

---

## 常用開發任務

```bash
npm run test              # 全部測試
npm run test:unit         # 單元測試
npm run test:integration  # 整合測試（需 Deepgram API Key，未設會跳過）
npm run test:e2e          # Playwright（目前 tests/e2e/ 為空）
npm run test:coverage     # 覆蓋率報告

npm run lint              # ESLint
npm run format            # Prettier

npm run build             # 生產版本
npm run package           # 產生 Chrome Web Store 上架 .zip
```

`test:integration` 會帶 `REQUIRE_DEEPGRAM_KEY=1`。沒設金鑰時測試跳過而非失敗，CI 才不會因為缺金鑰紅掉。

---

## 除錯

### 各 context 的 DevTools 入口

| 目標 | 怎麼開 |
|------|--------|
| Service Worker | `chrome://extensions/` → Babel Bridge → 點「Service Worker」 |
| Content Script | 目標網頁按 F12，log 直接顯示在該頁 Console |
| Popup | 右鍵 Extension 圖標 → 「檢查彈出式視窗」 |
| Offscreen Document | `chrome://extensions/` → Service Worker DevTools → 切換 context 下拉選單 |

### 正常流程的 Console 訊號

Deepgram 路徑：
```
[Offscreen] 鏡射音訊播放啟動
[DeepgramStreamClient] WebSocket 連線建立
[DeepgramStreamClient] interim transcript
[DeepgramStreamClient] final transcript
```

Whisper 路徑：
```
[Offscreen] 🎧 Chunk 準備完成
[SubtitleService] Whisper 辨識完成
[SubtitleService] OverlapProcessor 處理完成
[ContentScript] 接收字幕資料
[VideoMonitor] 已附加到 video 元素
```

### 症狀排查

#### 沒有字幕輸出（Deepgram）

1. Console 有沒有 `鏡射音訊播放啟動`——沒有代表音訊流沒接上
2. WebSocket 回 400：檢查模型與語言組合，Nova-2 不支援 `language=multi`
3. 拋 `DEEPGRAM_API_KEY_NOT_FOUND`：Popup 的 Deepgram 頁籤沒存金鑰

#### 字幕延遲過高（> 8 秒，Whisper）

依序量測，找出是哪一段超時：

1. 音訊 chunk 產生 —— 應 < 500ms（`[Offscreen] 🎧 Chunk 準備完成`）
2. Whisper API 響應 —— 通常 2-3 秒（`[SubtitleService] Whisper 辨識完成`）
3. OverlapProcessor —— 應 < 10ms（`[SubtitleService] OverlapProcessor 處理完成`）
4. 網路品質 —— 看 Network tab

Whisper 路徑的理論下限是 5.5-7 秒（MediaRecorder 3s + Whisper 2-3s + 網路 0.5-1s），這是雲端架構的物理極限。要更低只能換引擎或改用本地模型。

#### 字幕未顯示或不同步（Whisper）

1. `[VideoMonitor] 已附加到 video 元素` 有沒有出現
2. `[ContentScript] 接收字幕資料` 有沒有出現
3. 當前時間有沒有對應的 segment
4. 影片是不是暫停了——暫停時字幕不更新
5. `subtitle-overlay.css` 有沒有正確注入

```javascript
// 在目標頁面的 DevTools Console 執行
document.querySelector('video').currentTime
document.querySelector('#babel-bridge-subtitle-overlay')
```

#### OverlapProcessor 過濾率異常

正常 15-25%。

- **> 40%**：`OVERLAP_CONFIG.similarityThreshold` 設太低（預設 0.8）
- **< 5%**：Whisper 在重疊區給出完全不同的結果，檢查音訊品質，或考慮加長重疊區

#### Content Script 未注入

1. `manifest.json` 的 `content_scripts.matches` 有沒有涵蓋目標網站
2. `run_at: "document_idle"` 時機對不對
3. Console 有沒有載入錯誤
4. Extension 有沒有啟用、權限夠不夠

#### API 呼叫失敗

1. 用 Popup 的驗證按鈕確認金鑰有效
2. 檢查 OpenAI / Deepgram 帳戶額度
3. Network tab 看狀態碼：
   - CORS 錯誤 → `manifest.json` 的 `host_permissions`
   - 429 → 達 Rate Limit
   - 401 → 金鑰無效或過期

#### API Key 解密失敗

換瀏覽器或換電腦導致瀏覽器指紋改變。點「更換 API Key」重新輸入即可。這是設計上的安全特性，防止加密資料被跨裝置複製。

#### Extension 無法載入

1. `dist/` 存不存在（先跑 `npm run build`）
2. Chrome 開發人員模式有沒有開
3. `chrome://extensions/` 的錯誤訊息

#### 音訊擷取失敗

1. `tabCapture` 權限有沒有授予
2. 目標網站有沒有在播音訊
3. Chrome 音訊隱私設定有沒有擋

---

## 架構級問題診斷方法論

系統級的凍結、崩潰、死鎖不能靠逐行 debug，要從架構層下手。以下順序來自 2025-11 那次瀏覽器凍結的實戰教訓。

### 1. 先查 deprecated API 在非標準環境的已知問題

看有沒有用到過時 API（`ScriptProcessorNode`、`document.write` 之類），以及它們在特殊環境（Offscreen Document、Service Worker、Iframe）的相容性。查 [Chromium Issue Tracker](https://issues.chromium.org/)。

### 2. 質疑架構選擇，不要只調環境

問「為什麼需要這個模組？能不能用原生 API 取代？」「API A + API B + 環境 C 這個組合有沒有已知衝突？」

**優先移除問題模組，而不是修補它。** ScriptProcessorNode → MediaRecorder 就是這樣解決的。

### 3. 串起已有的知識線索

重看文件裡所有標著「潛在問題」「技術債務」「已過時」的描述，檢查跟當前問題有沒有關聯。避免知識孤島——A 文件的線索常常是 B 問題的答案。

### 4. 注意跨 context 傳輸陷阱（MV3 特有）

Service Worker ↔ Offscreen / Content Script 之間別直接傳 Blob、File、Function。優先用 ArrayBuffer、Base64、JSON。必要時自行序列化。

### 5. 最小化重現

砍到最小可重現程式碼，再逐步加回功能，精確定位出錯點。每步都留 console.log。

**核心教訓**：架構選擇錯誤 > 實作細節錯誤。

---

## 貢獻

### Commit 規範

遵循 Conventional Commits，型別用 `feat` / `fix` / `docs` / `test` / `refactor` / `style` / `perf` / `chore`。

```
feat: add Whisper API integration
fix: resolve overlap detection bug
```

### PR 流程

1. 開 feature branch：`git checkout -b feature/amazing-feature`
2. Commit 變更
3. 推上去開 PR

送 PR 前跑過 `npm run test` 與 `npm run lint`。

### 程式碼風格

- 類別 `PascalCase`、函數 `camelCase`、常數 `UPPER_SNAKE_CASE`、檔名 `kebab-case`
- 公開函數要有 JSDoc
- 測試覆蓋率目標 ≥ 70%，音訊處理模組 ≥ 80%

---

## License

MIT License，詳見 [LICENSE](../LICENSE)。
