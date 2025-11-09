# Phase 1 快速測試指南

## 🎯 兩階段測試策略

### **階段 1: Demo 頁面測試** (5 分鐘) ✅ 自動化
驗證所有核心演算法邏輯

### **階段 2: Extension 實測** (10 分鐘) ⚠️ 需人工操作
驗證完整音訊處理管線 + Chrome API 整合

---

## 📋 階段 1: Demo 頁面測試

### 1. 開啟 Demo 頁面
```bash
# 使用瀏覽器開啟
open demo/overlap-processor-demo.html
# 或直接在 VS Code 中右鍵 → Open with Live Server
```

### 2. 一鍵執行完整測試
1. 向下滾動到「🚀 Phase 1 完整測試套件」區塊
2. 點擊「🎯 一鍵執行完整測試」按鈕
3. 等待約 1 秒，所有測試會自動執行

### 3. 查看測試結果
**預期結果**:
```
✅ 通過: 4/4
❌ 失敗: 0
📊 總計: 4
🎯 通過率: 100%
```

**測試項目**:
- ✅ 測試 1: OverlapProcessor 基礎功能
- ✅ 測試 2: 重疊區去重 (Rolling Window)
- ✅ 測試 3: 多語言斷句與合併
- ✅ 測試 4: 文字相似度計算

### 4. (可選) 測試字幕時間同步
1. 向上滾動到「⏱️ 測試 5: 字幕時間同步」
2. 點擊「初始化測試」→「載入測試字幕」
3. 播放影片，觀察字幕是否與影片時間同步

**驗證點**:
- ✅ 字幕隨影片時間變化
- ✅ 暫停時字幕停留
- ✅ 跳轉時字幕立即更新

---

## 🔧 階段 2: Extension 實測

### 前置準備
1. **確認建置完成**
   ```bash
   npm run build
   ls dist/  # 確認 dist/ 資料夾存在
   ```

2. **載入 Extension**
   - 開啟 Chrome: `chrome://extensions/`
   - 開啟「開發人員模式」
   - 點擊「重新載入」(如已載入) 或「載入未封裝項目」→ 選擇 `dist/`

3. **設定 API Key**
   - 點擊工具列的 Babel Bridge 圖示
   - 輸入你的 OpenAI API Key (`sk-proj-...`)
   - 點擊「驗證」，等待成功訊息

---

### 核心測試流程 (10 分鐘)

#### 🎬 步驟 1: 準備測試影片 (1 分鐘)
開啟一個包含**清晰語音**的短片 (2-3 分鐘):
- **推薦**: YouTube 搜尋 "TED Talk 2 minutes"
- **避免**: 背景音樂過大、多人同時說話的影片

#### 🎤 步驟 2: 開啟 Console 監控 (1 分鐘)
**你需要開啟兩個 Console**:

1. **Service Worker Console** (音訊處理管線日誌):
   - 前往 `chrome://extensions/`
   - 找到 Babel Bridge
   - 點擊「Service Worker」連結

2. **Content Script Console** (字幕顯示日誌):
   - 在影片頁面按 `F12`
   - 切換到 Console tab

#### 🚀 步驟 3: 啟用字幕 (1 分鐘)
1. 在影片頁面點擊 Extension 圖示
2. 點擊「啟用字幕」
3. 允許「擷取音訊」權限
4. 播放影片

#### 👀 步驟 4: 觀察處理流程 (5 分鐘)

**Service Worker Console 預期日誌**:
```
[SubtitleService] Service Worker 已啟動
[MP3Encoder] Worker 已就緒
[WhisperClient] Whisper Client 已初始化

// 每 2 秒一個 chunk
[SubtitleService] 處理 Chunk 0 { startTime: 0.00, endTime: 3.00 }
[SubtitleService] MP3 編碼完成 { size: XXXXX }
[SubtitleService] Whisper 辨識完成 { text: "...", segments: X }
[SubtitleService] OverlapProcessor 處理完成 { originalSegments: X, processedSegments: Y, filtered: Z }

[SubtitleService] 處理 Chunk 1 { startTime: 2.00, endTime: 5.00 }
...
```

**Content Script Console 預期日誌**:
```
[ContentScript] Content script 已載入
[VideoMonitor] 已附加到 video 元素
[ContentScript] 接收字幕資料: { chunkIndex: 0, segments: X }
[ContentScript] 顯示字幕: "Hello world" (0.50s - 2.30s)
[ContentScript] 顯示字幕: "This is a test" (2.30s - 4.10s)
```

**視覺驗證**:
- ✅ 字幕出現在影片下方 (黑底白字)
- ✅ 字幕文字正確
- ✅ 字幕與影片同步 (延遲約 5-7 秒)

#### 📊 步驟 5: 驗證關鍵指標 (2 分鐘)

**檢查點 1: 處理時間**
在 Service Worker Console 觀察：
- ✅ Chunk 間隔約 **2 秒** (3秒音訊 - 1秒重疊)
- ✅ MP3 編碼 **< 500ms**
- ✅ Whisper API 響應 **2-3 秒**

**檢查點 2: OverlapProcessor 效能**
- ✅ 過濾率 **15-25%** (filtered / originalSegments)
- ✅ 無重複字幕出現

**檢查點 3: 字幕時間同步**
- ✅ 播放/暫停 → 字幕正確響應
- ✅ 跳轉進度條 → 字幕立即更新

---

## ✅ 測試檢查清單

### Demo 頁面測試
- [ ] 測試 1-4 全部通過 (100%)
- [ ] 測試 5 字幕時間同步正常

### Extension 實測
- [ ] Extension 成功載入
- [ ] API Key 驗證成功
- [ ] 音訊擷取權限允許
- [ ] Service Worker Console 顯示處理流程
- [ ] Content Script Console 顯示字幕日誌
- [ ] 字幕顯示在影片下方
- [ ] 字幕與影片同步 (延遲 < 7 秒)
- [ ] 播放/暫停/跳轉正常響應
- [ ] 過濾率 15-25%
- [ ] 無重複字幕

---

## 🐛 快速除錯

### 問題 1: Demo 測試失敗
**解決**: 檢查瀏覽器 Console 是否有模組載入錯誤

### 問題 2: Extension 載入失敗
**解決**:
1. 確認 `npm run build` 執行成功
2. 檢查 `dist/manifest.json` 是否存在

### 問題 3: API Key 驗證失敗
**解決**:
1. 確認 API Key 格式正確 (`sk-proj-...`)
2. 確認 OpenAI 帳戶有額度
3. 檢查網路連線

### 問題 4: 字幕未顯示
**解決**:
1. 檢查 Content Script Console 是否有 `[VideoMonitor] 已附加到 video 元素`
2. 檢查頁面是否有 `<video>` 標籤
3. 按 F12 → Elements tab → 搜尋 `babel-bridge-subtitle-overlay`

### 問題 5: 延遲過高 (> 8 秒)
**解決**:
1. 檢查 Whisper API 響應時間 (應 2-3 秒)
2. 檢查網路連線速度
3. 嘗試更換測試影片 (可能音訊品質問題)

---

## 📝 測試完成標準

**視為通過的條件**:
1. ✅ Demo 測試 4/4 通過
2. ✅ Extension 成功載入並啟用
3. ✅ 字幕正確顯示且與影片同步
4. ✅ 總延遲 < 7 秒
5. ✅ 無嚴重錯誤或崩潰

**如果通過** → 🎉 Phase 1 完成，進入 Phase 2 (UI 優化)
**如果未通過** → 📝 記錄問題，回到開發階段修復

---

## 🚀 下一步

Phase 1 測試通過後，進入 **Phase 2: 使用者介面優化**
- Popup UI 完善
- 字幕樣式自訂
- 成本統計圖表

詳見 `README.md` § Phase 2
