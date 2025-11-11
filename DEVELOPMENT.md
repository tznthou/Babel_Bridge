# 開發指南

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 開發模式

```bash
npm run dev
```

這會啟動 Vite 的 watch 模式，自動監聽文件變更並重新打包。

### 3. 載入 Extension 到 Chrome

1. 打開 Chrome 瀏覽器
2. 前往 `chrome://extensions/`
3. 開啟右上角的「開發人員模式」
4. 點擊「載入未封裝項目」
5. 選擇專案的 `dist/` 資料夾

### 4. 設定 API Key

1. 點擊 Chrome 右上角的 Extension 圖標
2. 輸入你的 OpenAI API Key (格式: `sk-...`)
3. 點擊「驗證並儲存」

## 目前狀態 (Phase 1)

✅ **已完成**:
- 音訊擷取 (`AudioCapture`)
- Rolling Window 切塊 (`AudioChunker`)
- MP3 編碼 (`MP3Encoder` + Web Worker)
- Whisper API 整合 (`WhisperClient`)
- API Key 管理與成本追蹤 (`APIKeyManager`)
- Service Worker 核心控制器
- Popup UI
- Content Script 字幕顯示

🚧 **未完成** (後續 Phase):
- OverlapProcessor (重疊區優化)
- GPT 翻譯功能
- 雙層字幕顯示
- 影片事件同步 (play/pause/seek)
- 字幕樣式自訂

## 專案結構

```
src/
├── background/          # Service Worker 與音訊處理
│   ├── service-worker.js       # 核心控制器
│   ├── audio-capture.js        # 音訊擷取
│   ├── audio-chunker.js        # Rolling Window 切塊（舊版備援）
│   └── whisper-client.js       # Whisper API 整合
├── content/             # Content Script (注入網頁)
│   ├── content-script.js       # 字幕渲染邏輯
│   └── subtitle-overlay.css    # 字幕樣式
├── popup/               # Extension Popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── lib/                 # 共用函式庫
│   ├── errors.js               # 錯誤類別定義
│   ├── error-handler.js        # 錯誤處理器
│   ├── config.js               # 全域配置
│   └── api-key-manager.js      # API Key 管理
└── workers/             # Web Workers（保留未來需求）
```

## 常見開發任務

### 測試

```bash
# 執行所有測試
npm run test

# 只執行單元測試
npm run test:unit

# 生成覆蓋率報告
npm run test:coverage
```

### Linting

```bash
# 檢查程式碼風格
npm run lint

# 自動格式化
npm run format
```

### 打包發布

```bash
# 打包生產版本
npm run build

# 生成 .zip 檔 (用於 Chrome Web Store)
npm run package
```

## 除錯技巧

### 1. Service Worker 除錯

1. 前往 `chrome://extensions/`
2. 找到 Babel Bridge
3. 點擊「Service Worker」連結開啟 DevTools
4. 查看 Console 日誌

### 2. Content Script 除錯

1. 開啟任意網頁
2. 按 F12 打開 DevTools
3. 查看 Console，Content Script 的 log 會顯示在這裡

### 3. Popup UI 除錯

1. 右鍵點擊 Extension 圖標
2. 選擇「檢查彈出式視窗」
3. 在 DevTools 中檢視

### 4. 音訊處理除錯

在 Service Worker Console 中，你會看到：
```
[AudioCapture] 開始擷取 Tab 123 音訊
[AudioChunker] Chunk 0 準備完成 { startTime: 0.00, endTime: 3.00 }
[MP3Encoder] 編碼完成 { size: 48000 }
[WhisperClient] Whisper 辨識完成 { text: "Hello world" }
```

## 常見問題

### Q: Extension 無法載入?

**A:** 檢查：
1. `dist/` 目錄是否存在（先執行 `npm run build`）
2. Chrome 是否開啟「開發人員模式」
3. Console 是否有錯誤訊息

### Q: 音訊擷取失敗?

**A:** 可能原因：
1. 沒有授予 `tabCapture` 權限
2. 目標網站沒有音訊播放
3. Chrome 的音訊隱私設定限制

### Q: Whisper API 呼叫失敗?

**A:** 檢查：
1. API Key 是否有效
2. OpenAI 帳戶是否有額度
3. 網路連線是否正常
4. 查看 Network tab 的 API 請求細節

### Q: 字幕沒有顯示?

**A:** 檢查：
1. Content Script 是否成功注入（F12 Console 查看）
2. CSS 是否正確載入
3. 是否有 z-index 被其他元素覆蓋

## 技術筆記

### Rolling Window 策略

每個 3 秒的音訊 chunk 包含：
- 前 1 秒：與上一個 chunk 重疊
- 中間 2 秒：主體部分
- 後 1 秒：與下一個 chunk 重疊

這樣設計是為了後續的 OverlapProcessor 能夠優化斷句。

### MP3 編碼性能

使用 Web Worker 避免阻塞主執行緒。典型編碼時間：
- 3 秒音訊 @ 16kHz: ~200-500ms

### Whisper API 響應時間

- 通常 2-3 秒
- 加上編碼時間，總延遲約 3-5 秒
- 如果啟用翻譯，額外增加 2-3 秒

## 貢獻指南

### Commit 規範

遵循 Conventional Commits：

```
feat: add new feature
fix: resolve bug
docs: update documentation
test: add tests
refactor: code refactoring
style: formatting changes
perf: performance improvement
```

### Pull Request 流程

1. Fork 專案
2. 建立 feature branch: `git checkout -b feature/amazing-feature`
3. Commit 變更: `git commit -m 'feat: add amazing feature'`
4. Push 到 branch: `git push origin feature/amazing-feature`
5. 開啟 Pull Request

## License

MIT License - 詳見 LICENSE 檔案
