# NewWay2 — Phase 1 影音字幕管線修復紀錄（2025-11-11）

## 背景
在 Phase 1 測試期間，我們成功讓 Offscreen Document → Service Worker → Content Script 的訊息管線運作，但仍遇到兩個阻塞：

1. **Trusted Types 限制**：YouTube 強制 TrustedHTML，導致 Content Script 以 `innerHTML` 更新字幕時被瀏覽器拒絕。
2. **Whisper `WHISPER_UNSUPPORTED_FORMAT`**：只有第一個 chunk 可以被 Whisper 轉錄，後續 95% chunk 都因「Invalid file format」而被拒絕。

目標是修復以上兩個核心阻塞，完成 Phase 1 的字幕產生驗證。

---

## 環境與快速上手
- **Branch**：`master`（2025-11-11 下午狀態）
- **套件版本**：`npm install` 後直接使用，Whisper API 需填入有效 Key。
- **建置指令**：`npm run build` → 將 `dist/` 載入 Chrome（開啟 `chrome://extensions` → Developer Mode → Load unpacked）。
- **測試影片**：YouTube - “A one minute TEDx Talk for the digital age | Woody Roseland”
- **觀察 Console**：
  - Content Script：字幕容器初始化與顯示 log。
  - Service Worker：`chunk diagnostics`、Whisper 回應、錯誤通知。

---

## 如何重現與驗證
1. `npm run build` → 重新載入 Extension。
2. 打開指定 YouTube 影片，啟用字幕（Popup 或指令）。
3. **驗證成功條件**：
   - Service Worker log 出現：
     - `[SubtitleService] chunk diagnostics` headerHex 為 `1a 45 df a3 ...`
     - `[SubtitleService] Whisper 辨識完成` (segments > 0)
     - `[SubtitleService] 📤 發送字幕到 Content Script`
   - Content Script 顯示字幕元素（可用 `document.querySelector('#babel-bridge-subtitle-overlay')` 檢查）。
4. **長時間測試**：讓影片播放 ≥ 1 分鐘，確保 chunk 不再報 `WHISPER_UNSUPPORTED_FORMAT`。
5. **Seek/Play/Pause**：隨機跳轉與暫停，確認 `baseVideoTime` 仍正確，字幕能自動更新/隱藏。

---

## 常見診斷資訊
- **Service Worker 必看 log**：
  ```text
  [SubtitleService] chunk diagnostics {
    chunkIndex: 4,
    mimeType: 'audio/webm;codecs=opus',
    blobSize: 49282,
    headerHex: '1a 45 df a3 ...',
    base64Preview: 'GkXf...'
  }
  ```
  若 `headerHex` 不是 `1a 45 df a3`，代表 Offscreen header 尚未補上，需重跑 `npm run build` 或檢查 MediaRecorder 邏輯。

- **Offscreen header 捕捉**：
  ```
  [Offscreen] 📎 WebM header captured { headerBytes: 4080 }
  ```
  沒看到此 log → 代表 chunk0 未解析成功，需檢查影片是否靜音或 Chrome 是否阻擋音訊。

- **錯誤通知範例**：
  ```
  [BabelBridge Error] { code: 'WHISPER_UNSUPPORTED_FORMAT', ... }
  ```
  若再度發生，可直接從 `chunk diagnostics` 的 `base64Preview` 取樣，或在 `logChunkDiagnostics()` 暫時 `window.__lastAudioBlob = audioBlob` 以便下載分析。

---

## 歷程與修復重點

### 1. Content Script 改用 DOM API（2025-11-11 早上）
* `SubtitleOverlay.show/clear()` 改為以 `createElement`、`appendChild`、`removeChild` 操作 DOM，不再操作 `innerHTML`。
* 重設 `baseVideoTime`，確保字幕時間以影片絕對時間呈現。
* 結果：字幕容器在 Trusted Types 環境下也能安全更新，第一個 chunk 的字幕確定會傳到畫面。

### 2. Service Worker 診斷與 Blob 重建（午間）
* `createAudioBlob()` 優先使用 `ArrayBuffer`，若收到 structured clone 形式則呼叫 `extractStructuredClone()` 還原。
* 加入 `logBufferShape()` 與 `chunk diagnostics`：每個 chunk 都會列出 blob size、MIME、Base64 前綴、前 8 bytes（hex + ascii）。
* 結果：第一個 chunk 仍能成功轉錄，但 log 顯示 chunk1 之後的 `headerHex` 變成 `43 c3 81 0b...`，確定問題在音訊本體缺 header。

### 3. Offscreen 自動補 WebM Header（下午）
* Offscreen Document 在 chunk0 解析出 EBML header（尋找 `1F 43 B6 75` 的 Cluster 起始）並快取。
* 後續所有 chunk 在送出前都會自動 `concat(header + chunk)`，Base64 備援亦使用補過的 buffer。
* 建立 log：「📎 WebM header captured」便於確認是否抓到 header。
* 重新 `npm run build`，將新版打包進 `dist/` 後重新載入 Extension。
* 結果：從 chunk1 開始，`headerHex` 也變成 `1a 45 df a3...`，Whisper 連續十幾個 chunk 皆成功轉錄，`APIKeyManager` 也開始累積使用量。

---

## 成功驗證結果
* `Service Worker` log 顯示：
  * `chunk diagnostics`：每個 chunk 都有 `1a 45 df a3 ...` 開頭的 header。
  * `Whisper 辨識完成`：chunk0–chunkN 都返回 `text` 與 `segments`。
  * `OverlapProcessor` 正常去重，並持續送字幕到 Content Script。
* Content Script console 確認 `Subtitle overlay 已初始化`，字幕透過 DOM API 正常插入。
* 整體資料流（音訊擷取 → chunk 傳輸 → Whisper 轉錄 → Overlap → Content Script）已順暢完成，P0 阻塞解除。

---

## 下一步待辦（P0 ✅ 後）
P0 的「連續 chunk 可被 Whisper 轉錄並送到 Content Script」已通過實測。以下列為緊接著要處理的優先項目：

1. **字幕 UI/Trusted Types 微調（P1）**  
   - 確認字幕樣式、位置、動態顯示在 YouTube 等頁面都穩定。
   - 測試 play/pause/seek，以確保 `baseVideoTime` 與 `pruneOldSegments` 邏輯在使用者操作下仍正常。

2. **自動化診斷/下載工具（P1）**  
   - 基於 `chunk diagnostics` 的資料，提供一鍵下載 audioBlob 或 Node script，自動驗證 chunk 可播放，方便日後排錯。
   - 規畫簡易 E2E 腳本：啟用字幕→播放→驗證多個 chunk 無 `WHISPER_UNSUPPORTED_FORMAT`。

3. **文件同步與記錄（P2）**  
   - 更新 `CLAUDE.md`、`.serena/memories`，收錄 WebM header 補強與 Trusted Types 解法。
   - 在 `TESTING_PHASE1.md` 或新的測試章節補上 P0 測試結果與診斷方法。

4. **Phase 2 前置**  
   - 設計字幕控制介面（暫停顯示、翻譯切換）。  
   - 評估翻譯 API、成本與快取策略。

---

## 交接清單（給下一位 AI Coding 夥伴）
1. **確認環境**：`npm install` + `npm run build`，確保 `dist/` 與 `src/` 同步。
2. **閱讀檔案**：
   - `src/offscreen/offscreen.js`：`prepareWebMChunk()`、`webmHeaderBuffer` 邏輯。
   - `src/background/service-worker.js`：`createAudioBlob()`、`logChunkDiagnostics()`。
   - `src/content/content-script.js`：`SubtitleOverlay` DOM 操作、`baseVideoTime`。
3. **執行 Phase 1 驗證**（上一節步驟）。
4. **依「下一步待辦」挑選任務**：建議先從 UI/Seek 測試或診斷工具擴充開始。

---

## 關鍵教訓
* **Trusted Types 先天限制**：對第三方網站注入 UI 時，應預設改用 DOM API，避免依賴 `innerHTML`。
* **MediaRecorder timeslice 行為**：只有第一個 chunk 含完整 EBML header，其餘 chunk 必須額外補上才能獨立播放。
* **診斷的重要性**：詳細紀錄 Base64、header bytes、blob size 能快速定位格式問題，減少手動下載檔案的負擔。

---

## 結論
透過「DOM API + WebM header 補強 + chunk 診斷」三項修復，我們已在實際 YouTube 測試中穩定產生連續字幕。P0 Phase 1 的阻塞解除，接下來可專注字幕顯示、互動（Play/Pause/Seek）以及更進一步的翻譯/樣式功能。這也為後續 Phase 2 提供了可重複、可觀測的基礎。 
