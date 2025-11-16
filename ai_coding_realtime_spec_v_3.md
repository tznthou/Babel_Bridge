# ai-coding-realtime-direction-spec（v3）

> **本版本（v3）已整合所有新發現的技術現實、Deepgram Streaming 行為、Chrome Extension MV3 限制**。
>
> 並且依你的補充：**你的框架在靜音模式仍可讀取原始音訊**，因此第十點「音量 normalization / volume-based capture 問題」已完全排除。
>
> 這是目前最完整、最符合你專案實況的 Streaming STT 改版規格文件。

---

# 0. 文件目的

本文件提供 AI Coding 與未來的你，用來將現有 Whisper batch 模式完全升級為：

**Deepgram Streaming API + AudioWorklet 低延遲音訊流水線 + 精準影片時間對齊模型**

本規格包含實作必備要素、Dev 會踩到的坑、MV3 限制、所有時間軸／穩定性要求。

---

# 1. 舊架構問題（保留，但簡述）

1. Whisper HTTP → 天生 3–7 秒延遲
2. 回傳時間不穩定 → 字幕時間軸抖動
3. seek / pause 雖可補強，但本質仍依賴 batch timing

結論：**不是邏輯錯，而是技術選擇錯。**

---

# 2. 新架構總目標

1. 0.3–1 秒級的真正即時字幕
2. 使用 WebSocket（非 SDK）串接 Deepgram Streaming
3. 以 AudioWorklet 產生 16kHz mono Int16 PCM frame（20–50ms）
4. 音訊 timeline + 影片 timeline 精準對齊

對齊公式：

```
videoStartTime = video.currentTime（開始 streaming 時）
segment.videoStart = videoStartTime + segment.audioStart
segment.videoEnd   = videoStartTime + segment.audioEnd
```

5. 不再依賴 chunk offset
6. 不再依賴錄音 3 秒 MediaRecorder
7. 不需後端伺服器（前端直接連 Deepgram WebSocket）

---

# 3. 專案新版檔案架構

```
src/background/
  ├── stt-streaming-client.js   # 手寫 WebSocket + Deepgram protocol
  ├── audio-capture.js          # AudioWorklet / TrackProcessor → PCM frame
  ├── service-worker.js         # Session manager
src/content/
  ├── content-script.js         # 字幕渲染（相容模式）
```

---

# 4. 模組職責（精修版）

## 4.1 stt-streaming-client.js（手寫 WebSocket）

Deepgram JS SDK **不能用在瀏覽器／MV3** → 必須手寫。

### 功能：
- 生成 WebSocket：

```
wss://api.deepgram.com/v1/listen?model=general&encoding=linear16&sample_rate=16000
```

- 傳送 binary PCM（Int16）frame
- 處理 server push：interim / final
- Auto-reconnect（連線中斷）
- 心跳（KeepAlive）

### 新增（v3）必備：KeepAlive
- 若音訊暫停、無音訊 → Deepgram 會關閉連線
- 必須每 5 秒送一次：

```
{"type":"KeepAlive"}
```

否則 WebSocket 中途會死掉。

---

## 4.2 audio-capture.js（AudioWorklet）

### 職責：
- 從 streaming pipeline 抓「原始音訊來源」而非 user speaker output
- 產生 20–50ms PCM frame（推薦 20ms）
- 降採樣：48kHz → 16kHz
- stereo → mono downmix
- Float32 → Int16

### v3 移除項目：音量 normalization
你已確認：

> **你的架構能在影片靜音（volume=0）時仍讀取原始音訊**

因此以下問題已排除：
- 使用者喇叭音量不影響字幕
- 不需 normalization
- 不需 gain node
- 不需 avoid clipping

保留唯一需求：**確保輸入格式正確（16kHz mono Int16）**。

---

## 4.3 service-worker.js（Session Manager）

### 新行為（v3）：

#### 1. Streaming 啟動
- 計算 `videoStartTime`
- 啟動 audio-capture
- 啟動 stt-streaming-client

#### 2. Seek Handling（你之前 spec 未寫完整 → v3 補上）

影片快轉 → timeline 要對齊。

有兩種做法：

### A. 最安全（推薦）
**seek 後強制結束 streaming → 重啟 streaming session**

流程：
- detect seeking
- stop audio-capture
- close WebSocket
- wait 200ms
- restart with new `videoStartTime`

### B. 較快但有 Interim 閃爍問題
只調整 `videoStartTime`，不重啟 streaming。

> v3 建議：實作 A，避免字幕重疊、錯位或 interim 推送不一致。

#### 3. 分頁切換（visibilitychange）

MV3 下，分頁切走 → AudioWorklet 可能降速／停工。

必須支持：
- 若 audio-capture 進入 idle → 暫停 streaming
- 分頁切回 → 自動 resume

#### 4. WebSocket 自動重連
- 若 error 或 close → 1 秒後重新連
- 若連續 5 次失敗 → 回報 error 給 content-script

---

## 4.4 content-script.js

### 處理：
- interim（暫時字幕）
- final（結束字幕）

### v3 新增：subtitle rendering throttle
否則：
- interim update 頻率會高達 20–40ms
- DOM 會閃爍、FPS 掉、用戶以為燈在閃

### throttle 建議：
- interim：每 **100–120ms** 更新一次
- final：立即更新

---

# 5. 新增：Deepgram Error Handling（v3）

你之前 spec 未包含錯誤代碼處理。

必須處理：
- 採樣率錯誤
- audio encoding 不正確
- token 失效
- model 錯誤
- request rate 過高

錯誤格式類似：
```
{"error": "sample_rate_invalid"}
```

service-worker 必須：
1. 通知使用者（content-script toast）
2. 停止 streaming
3. 建議重試

---

# 6. 測試清單 v3

### 1. 延遲
- 目標 0.3–1.0 秒
- 測試不同影片（YouTube / Netflix / Facebook）

### 2. 同步性
- seek → 是否重新對齊
- pause → resume 是否邏輯正確

### 3. 分頁切換
- 切走後音訊是否停
- 切回後自動 resume

### 4. WebSocket resiliency
- 模擬斷線（Wi-Fi 開/關）
- 是否能自動重連

### 5. 錯誤彈出
- token 錯
- model 錯
- 16kHz → 若給 48kHz（應失敗）

---

# 7. 未來擴充（v3）

### A. 雙語字幕（未來翻譯 pipeline）
- final transcript 後再觸發翻譯 API
- 保留 timeline 對齊

### B. 多 STT Provider
- 抽象化 stt-streaming-client

### C. 字幕樣式客製

---

# 8. v3 Summary

**v3 做的主要更新：**

- 加入 WebSocket KeepAlive（必要）
- 加入 seek 事件完整流程
- 加入 MV3 分頁切換／Worklet idle 問題
- 加入 service worker 中斷與生命週期管理
- 加入 Deepgram Error Handling
- 加入字幕 throttle 機制
- 加入更詳細的 audio pipeline 規格（降採樣/mono/int16）
- 移除「喇叭音量」問題（基於你的原始音訊架構）

這版規格已足夠驅動完整的開發迭代。

> 如果你需要，我可以直接幫你產生：
> - stt-streaming-client.js 骨架
> - audio-worklet-processor.js 範本
> - service-worker streaming session 範本

隨時跟我說你要哪一項。

