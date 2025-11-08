/**
 * Content Script - 注入網頁並顯示字幕
 *
 * 職責:
 * 1. 接收來自 Background 的字幕資料
 * 2. 渲染字幕 Overlay
 * 3. 監聽影片事件 (play/pause/seek)
 */
import { MessageTypes } from '../lib/config.js';

class SubtitleOverlay {
  constructor() {
    this.container = null;
    this.currentSubtitle = null;
    this.init();
  }

  /**
   * 初始化 Overlay UI
   */
  init() {
    // 建立字幕容器
    this.container = document.createElement('div');
    this.container.id = 'babel-bridge-subtitle-overlay';
    this.container.className = 'babel-subtitle-container';

    // 注入到頁面
    document.body.appendChild(this.container);

    console.log('[ContentScript] Subtitle overlay 已初始化');
  }

  /**
   * 顯示字幕
   */
  show(subtitle) {
    this.currentSubtitle = subtitle;

    // 清空容器
    this.container.innerHTML = '';

    // 建立字幕元素
    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'babel-subtitle';
    subtitleEl.textContent = subtitle.text;

    this.container.appendChild(subtitleEl);

    // 顯示容器
    this.container.style.display = 'flex';

    console.log('[ContentScript] 顯示字幕:', subtitle.text);
  }

  /**
   * 隱藏字幕
   */
  hide() {
    this.container.style.display = 'none';
    this.currentSubtitle = null;
  }

  /**
   * 清除所有字幕
   */
  clear() {
    this.container.innerHTML = '';
    this.currentSubtitle = null;
  }

  /**
   * 移除 Overlay
   */
  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.currentSubtitle = null;
  }
}

// 建立全域 Overlay 實例
const overlay = new SubtitleOverlay();

/**
 * 處理來自 Background 的訊息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  console.log('[ContentScript] 收到訊息:', type);

  switch (type) {
    case MessageTypes.SUBTITLE_UPDATE:
      overlay.show(data);
      sendResponse({ success: true });
      break;

    case MessageTypes.CLEAR_SUBTITLES:
      overlay.clear();
      sendResponse({ success: true });
      break;

    case MessageTypes.STYLE_UPDATE:
      // TODO: 更新字幕樣式
      sendResponse({ success: true });
      break;

    default:
      console.warn('[ContentScript] 未知訊息類型:', type);
      sendResponse({ success: false });
  }
});

console.log('[ContentScript] Content script 已載入');
