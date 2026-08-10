# 除錯腳本

在瀏覽器 DevTools Console 手動貼上執行的診斷工具，不參與建置流程。

| 腳本 | 用途 | 執行位置 |
|------|------|----------|
| `diagnostic-script.js` | 字幕顯示管線診斷：檢查 Content Script 是否注入、字幕容器是否存在、video 元素狀態與當前時間 | 目標影片頁面（如 YouTube）的 Console |
| `test-message.js` | 驗證 Service Worker → Content Script 的訊息傳遞是否暢通 | 目標影片頁面的 Console |

## 使用方式

1. 在目標影片頁面按 F12 開啟 DevTools
2. 複製整個腳本檔案內容
3. 貼進 Console 按 Enter
4. 依輸出的檢查項目逐條比對

搭配 [CLAUDE.md](../../CLAUDE.md) §「常見問題除錯」的檢查點使用。
