# Icons 說明

這個目錄需要放置 Chrome Extension 的圖標。

## 需要的圖標尺寸

根據 `manifest.json` 的設定，需要以下三個尺寸：

- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels
- `icon128.png` - 128x128 pixels

## 快速生成佔位圖標

在開發階段，你可以用任何圖片工具建立簡單的佔位圖標。建議：

1. **線上工具**: 使用 https://favicon.io 或類似服務
2. **設計軟體**: Figma、Sketch、Photoshop
3. **程式生成**: 使用 Canvas API 或 ImageMagick

## 設計建議

- 主色調：藍色 (#4a90e2) 代表科技與溝通
- 圖案：橋樑圖示 🌉 或語言符號
- 風格：簡潔現代，在小尺寸下清晰可辨

## 臨時替代方案

如果暫時沒有圖標，可以註解掉 `manifest.json` 中的 icons 欄位，Chrome 會使用預設圖標。
