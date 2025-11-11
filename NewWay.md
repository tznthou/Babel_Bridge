# NewWay — 音訊擷取與字幕管線改造計畫

## 背景
目前 Offscreen Document 依賴 `AudioContext + ScriptProcessorNode + MP3 Worker` 的舊式管線。Chrome 在 Offscreen Renderer 內執行 `ScriptProcessorNode` 會與 tabCapture/AudioContext 組合產生凍結。Content Script 也累積事件監聽與字幕片段，帶來額外的主執行緒壓力。

## 新策略
1. **MediaRecorder 管線（已完成）**
   - 直接對 `getUserMedia({audio: {chromeMediaSource: 'tab'}})` 的 `MediaStream` 啟動 `MediaRecorder`，以 3 秒 timeslice (`mediaRecorder.start(3000)`) 切片。
   - Offscreen 端目前將每個 chunk 轉為 `ArrayBuffer` → Base64 (`audioBase64`) + metadata（`mimeType`, `chunkIndex`, `duration`, `audioByteLength` 等）後透過 `chrome.runtime.sendMessage` 傳給 Service Worker，避免 `Blob` 在 MV3 context 間失真。
   - Service Worker 於 `SubtitleService.processChunk` 使用 `createAudioBlob()` 來重建真正的 `Blob`（優先用 Base64，其次 ArrayBuffer、最後相容舊版 Blob），再送進 Whisper API。**目前仍有 `WHISPER_UNSUPPORTED_FORMAT` 錯誤，代表 Base64 → Blob 還原流程尚未完全可靠，後續需要再針對 chunk 重建邏輯除錯。**
   - MP3 編碼相關檔案 (`mp3-encoder.js`, `mp3-encoder.worker.js`) 及 `manifest.json`/`vite.config.js` 的 Web Worker 配置已移除。
   - `npm` 依賴 `lamejs` 已 uninstall，build 成品只含 MediaRecorder 管線。

2. **音訊輸出策略**
   - 預設使用 `suppressLocalAudioPlayback: true` 讓 Chrome 靜音原分頁，Offscreen 再用 `Audio` 元件鏡射 MediaStream 播放，確保只有單一音訊路徑、避免回音。
   - 若日後仍有靜音或回音狀況，備案是改回 `false` 並在 content script 內控制原影片音量，或提供使用者切換選項。

3. **Service Worker 錯誤處理**
   - `processChunk` log 會顯示 `mimeType`、`hasBase64` 等資訊，方便診斷。
   - Base64 還原同時支援 `atob`（瀏覽器）與 `Buffer`（Node build/runtime）；失敗會丟出 `BabelBridgeError` 並附帶細節，避免 Whisper 上傳時發生 `FormData` 型別錯誤而不易追查。目前仍在釐清為何 Whisper 只接受部分 chunk、其餘報 `Invalid file format`。

4. **Content Script 穩定性（已完成）**
   - `VideoMonitor` 在建構時就綁定 handler 並儲存引用，detach 時能正確移除 listener。
   - `SubtitleOverlay` 會在時間向前推進時剪掉 30 秒前的 segments，避免資料結構無限制成長並提高 `findSegmentIndex` 效率。

## 實作順序
1. ✅ 重構 `src/offscreen/offscreen.js`（MediaRecorder + Base64 chunk + Playback Mirror）。
2. ✅ 更新 `SubtitleService.processChunk`（重建 Blob → Whisper）。
3. ✅ 優化 Content Script（handler 綁定與字幕剪枝）。
4. ✅ 移除 MP3 編碼檔案與 `lamejs` 依賴，調整 `manifest.json`/`vite.config.js`。
5. 🔜 修復 Base64 → Blob 還原流程，確保 Whisper 端不再出現 `WHISPER_UNSUPPORTED_FORMAT`。
6. 🔜 針對 autopolicy/回音做進一步最佳化（若使用者測試仍有異常，改由 content-script 控制音量或引入可選設定）。

## 預期成果
- 從根本移除 Offscreen Renderer 與 AudioContext 的死鎖來源。
- 降低延遲（無需 MP3 編碼時間）。
- Content Script 長時間運作仍維持穩定記憶體/CPU。
- 架構簡化，後續擴充（翻譯、多語言）更容易。
