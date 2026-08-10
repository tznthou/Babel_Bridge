# NewWay3：Deepgram 串流修復接手指南（2025-11-16）

> 本文件給下一位 AI/Coding 助手，總結目前針對 Deepgram 串流字幕的修復狀態、已完成的工作、仍卡住的問題與建議的後續步驟。閱讀後即可直接接手。

---

## 1. 目前進度快照

| 項目 | 狀態 | 說明 |
|------|------|------|
| Tab 靜音問題 | ✅ 修復 | 在 Offscreen Document 建立隱藏 `<audio>` 鏡射播放，影片音訊已可正常輸出，也可錄到非 0 PCM。 |
| PCM 診斷/監控 | ✅ 完成 | Background Service Worker 每個 frame 輸出振幅統計，能確認送入 Deepgram 的音訊是否為靜音。 |
| Deepgram 字幕 | ❌ 未出現 | 雖收到 `Results`、但 `transcript` 仍為空，或目前連線階段就被 400 擋下。 |
| 語言設定 | 🔄 調整中 | 原本硬指定 `zh-TW`，後來改成 auto detect；但 auto detect 造成 400，需重新評估。 |
| 文件/說明 | ✅ 更新 | CLAUDE.md 已加入 Deepgram Phase 2、鏡射播放、語言偵測與 config 設定流程。 |

---

## 2. 已完成的修復與實作細節

### 2.1 Offscreen 鏡射播放（解決 Chrome tab 靜音）
- 檔案：`src/offscreen/offscreen.js`
- 新增 `mirrorAudioElement`、`startMirrorAudioPlayback(stream)`、`stopMirrorAudioPlayback()`。
- 流程：取得 tab `MediaStream` 後即指派給隱藏 `<audio>` 並 `play()`，停止擷取時關閉並釋放。
- 結果：PCM 診斷顯示 min/max/avgAbs 皆非 0，證實 Deepgram 端確實接收到了聲音內容。

### 2.2 Deepgram 結果與 PCM 診斷 log
- `src/background/deepgram-stream-client.js`
  - `handleMessage` 將 `Results` payload 全數 `JSON.stringify` 在 console 顯示。
  - `handleTranscriptResult` 在每個 early-return (缺 channel/alternatives、transcript 空) 印出警示。
- `src/background/service-worker.js`
  - `handlePCMFrame` 前幾個 frame + 每 200 frame 印出 `min/max/avgAbs` 與前 16 個 sample。
  - 方便判斷是否仍為靜音或 amplitude 偏低。

### 2.3 Deepgram 設定訊息
- WebSocket 建立時會 `this.websocket.binaryType = 'arraybuffer'`。
- `handleOpen` 之後立即呼叫 `sendConfigurationMessage()` 傳送：
  ```jsonc
  {
    "type": "configure",
    "encoding": "linear16",
    "sample_rate": 16000,
    "channels": 1,
    "multichannel": false,
    "interim_results": true,
    "detect_language": true, // 若啟用
    "languages": ["en","en-US","zh","zh-TW","zh-CN"] // hints
  }
  ```
- 目的：必要設定皆在 WebSocket 層再宣告一次，避免 Deepgram 忽略 URL 參數。

### 2.4 文檔更新
- `CLAUDE.md` 增補 Deepgram Phase 2 流程、靜音修復、語言自動偵測及 configure 流程，接手者可先閱讀該節。

---

## 3. 當前卡住的問題

### 3.1 Deepgram WebSocket 400（最新阻塞）
- Console 顯示 `WebSocket connection ... Unexpected response code: 400`。
- 觀察：我們同時在 query string 加上 `detect_language=true&languages=...&multichannel=false`，並在 configure message 也送一份。
- 推測：Deepgram 可能在瀏覽器端 subprotocol 連線不接受 `detect_language` 參數，或需要額外授權，導致握手直接被拒。
- 後果：WebSocket 無法建立 ⇒ 無字幕。

### 3.2 早期（握手成功時）仍出現空 transcript
- 在自動偵測改動前，連線可建立，但 `transcript` 永遠為空字串。
- 當時已有非零音訊 ⇒ 問題不在音訊而在 Deepgram 解析。
- 可能原因：
  1. 語言設定錯誤（英語影片卻指定 `zh-TW`）。
  2. Deepgram 將串流視為多聲道（`channel_index: [0,1]`），而我們只送單聲道，導致結果出錯。
  3. 需要在 configure message 指定 `channels=1` 並禁用 multichannel。

---

## 4. 建議後續行動

### 4.1 優先解除 400 錯誤
1. 修改 `DEEPGRAM_CONFIG`：
   - `LANGUAGE: 'en-US'`（依測試影片語言調整）
   - `DETECT_LANGUAGE: false`
   - 移除/忽略 `LANGUAGE_HINTS`
2. `buildWebSocketUrl()` 暫時只保留以下查詢參數：`model`, `encoding`, `sample_rate`, `channels`, `interim_results`, `punctuate`, `smart_format`, `endpointing`.
   - 不要在 URL 帶 `detect_language`/`languages`/`multichannel`。
3. `sendConfigurationMessage()` 也僅送固定語言與 `multichannel: false`。
4. `npm run build` → Chrome 擴充重新載入 → 再測 `https://www.youtube.com/watch?v=r7dWsJ-mEyI`。
5. 紀錄 console：
   - `[DeepgramStreamClient] 🔗 WebSocket URL`
   - `[DeepgramStreamClient] ⚙️ 已傳送設定訊息`
   - 若仍 400，貼出 `request_id` 或 Deepgram 錯誤 JSON 方便與 Deepgram 支援核對。

### 4.2 若連線成功但 transcript 仍空
1. 檢查 `Results.channel_index` 是否仍 `[0,1]`，若是：
   - 再確認 configure message 送出的 `channels: 1, multichannel: false` 是否成功。
   - 可試著在 URL 參數加 `diarize=false` 或 `channel_diaries=false`（Deepgram 偶爾用 diarization 會拆多聲道）。
2. 於 Service Worker console 確認 PCM 振幅至少 > 1000（已由診斷 log 提供）。
3. 若 `transcript` 還是空，將一個 PCM buffer 另存為 WAV（可在 Service Worker 抓 frameIndex=1 的 array）送到 Deepgram REST API 測試，排除音訊本身是否 Deepgram 無法辨識。

### 4.3 重新導入自動語言偵測（待 WebSocket 穩定後）
1. 若確定 400 來自 `detect_language`，考慮改為 **client 端語言設定**：
   - Popup/Options UI 新增「影片語言」選項（預設 auto），只在 auto 模式下呼叫 Deepgram 的 detect language API（需確認是否允許 browser 直接呼叫）。
2. 或與 Deepgram support 確認：瀏覽器 WebSocket 是否不支援 `detect_language`，是否需要 JWT token 或 server proxy。若是，則 fallback 到手動選語言。

### 4.4 測試 & 驗證
1. 成功連線並看到 `⏳ Interim` / `✅ Final` log 後，確認 Content Script console 出現 `[SubtitleService] ...`。
2. 測不同語言影片（英/中）確保 UI/設定流程可快速切換。
3. 更新文檔（CLAUDE.md & NewWay3）記錄最終決策與限制。

---

## 5. 重要檔案索引

| 路徑 | 功能 |
|------|------|
| `src/background/deepgram-stream-client.js` | Deepgram WebSocket 客戶端與 log |
| `src/background/service-worker.js` | SubtitleService, PCM frame 訊息轉送, 診斷 log |
| `src/background/audio-capture.js` | Service Worker 與 Offscreen 間的音訊協調 |
| `src/offscreen/offscreen.js` | AudioWorklet + 鏡射播放 |
| `src/offscreen/pcm-processor.js` | 48kHz → 16kHz 轉換 |
| `src/lib/config.js` | `DEEPGRAM_CONFIG`、其他全域設定 |
| `CLAUDE.md` § Deepgram Streaming | 歷史決策、修復紀錄 |

---

## 6. 參考 Console 範例

```text
[DeepgramStreamClient] 🔗 連線到 Deepgram... { model: 'nova-2', language: 'auto (en, zh, ...)' }
[DeepgramStreamClient] ⚙️ 已傳送設定訊息 { sample_rate: 16000, channels: 1, ... }
[SubtitleService] 🎚️ PCM 振幅診斷 { frameIndex: 4, min: -2251, max: 3208, avgAbs: 561.27 }
[DeepgramStreamClient] 📨 收到訊息: Results
[DeepgramStreamClient] 🔍 完整 Results: { "channel_index": [0,1], "channel": { "alternatives":[{"transcript":""}] } }
[DeepgramStreamClient] ⚠️ 空字幕 transcript，跳過此結果
```

---

## 7. 接手提示

1. **問題核心已縮小**：音訊 pipeline OK，Deepgram handshake / transcript 仍有問題。先解決 400，再解決空 transcript。
2. **請鎖定 Service Worker console**（`chrome://extensions` → Babel Bridge → Service Worker Inspect）。所有關鍵 log 都在這裡。
3. **測試流程**：`npm run build` → Chrome 重新載入 → 開啟目標影片（例：`https://www.youtube.com/watch?v=r7dWsJ-mEyI`）→ 點擊啟用字幕 → 觀察 log。
4. **若需回溯**：`.serena/memories/deepgram-streaming-debugging-2025-11-16.md` 有更完整的診斷歷程，可提供過去測試細節。

祝接手順利！若完成修復，請記得回寫 CLAUDE.md／NewWay3 更新結論。
