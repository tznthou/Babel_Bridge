# 開發記錄封存

這裡放的是**當時的**問題排查與架構決策記錄，保留原貌不隨程式碼更新。

用途是回答「為什麼當初這樣選」，不是查詢現行架構 —— 現行架構請看 [README.md](../../README.md) 與 [CLAUDE.md](../../CLAUDE.md)。

| 檔案 | 日期 | 主題 |
|------|------|------|
| [`NewWay.md`](NewWay.md) | 2025-11-09~11 | MediaRecorder 管線遷移計畫。ScriptProcessorNode 在 Offscreen Document 與 tabCapture 組合觸發 Chrome 底層死鎖，導致瀏覽器完全凍結 |
| [`NewWay2.md`](NewWay2.md) | 2025-11-11 | WebM Header 補強。MediaRecorder timeslice 的 chunk1+ 缺 EBML header，Whisper 成功率 4.3% → 100%；同時處理 YouTube Trusted Types 限制 |
| [`NewWay3.md`](NewWay3.md) | 2025-11-16 | Deepgram 串流修復接手指南。Tab 靜音（鏡射播放）與 PCM 診斷的當時狀態 |
| [`ai-coding-realtime-spec-v3.md`](ai-coding-realtime-spec-v3.md) | 2025-11-16 | Streaming STT 改版規格草案。整合 Deepgram Streaming 行為與 MV3 限制的分析 |

`NewWay.md` 的踩坑經驗後來提煉成 CLAUDE.md 的「架構級問題診斷方法論」一章。
