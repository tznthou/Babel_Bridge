/**
 * Content Script - 注入網頁並顯示字幕
 *
 * 職責:
 * 1. 接收來自 Background 的字幕資料
 * 2. 渲染字幕 Overlay
 * 3. 監聽影片事件 (play/pause/seek) 並同步顯示字幕
 */
import { MessageTypes } from '../lib/config.js';

const SEGMENT_RETENTION_SECONDS = 30;

/**
 * Video 元素監聽器
 * 負責偵測並監聽頁面中的 video 元素
 */
class VideoMonitor {
  constructor(onTimeUpdate) {
    this.videoElement = null;
    this.onTimeUpdate = onTimeUpdate;
    this.isMonitoring = false;
    this.boundHandlers = {
      timeupdate: this.handleTimeUpdate.bind(this),
      play: this.handlePlay.bind(this),
      pause: this.handlePause.bind(this),
      seeked: this.handleSeeked.bind(this),
    };
    this.findAndAttach();
  }

  /**
   * 尋找並附加到 video 元素
   */
  findAndAttach() {
    // 嘗試找到 video 元素
    const video = document.querySelector('video');

    if (video) {
      this.attach(video);
    } else {
      // 如果找不到，使用 MutationObserver 監聽 DOM 變化
      const observer = new MutationObserver(() => {
        const video = document.querySelector('video');
        if (video) {
          this.attach(video);
          observer.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      console.log('[VideoMonitor] 等待 video 元素出現...');
    }
  }

  /**
   * 附加到 video 元素
   */
  attach(video) {
    if (this.videoElement === video) {
      return; // 已經附加
    }

    // 移除舊的監聽器
    this.detach();

    this.videoElement = video;

    // 監聽時間更新事件
    video.addEventListener('timeupdate', this.boundHandlers.timeupdate);
    video.addEventListener('play', this.boundHandlers.play);
    video.addEventListener('pause', this.boundHandlers.pause);
    video.addEventListener('seeked', this.boundHandlers.seeked);

    this.isMonitoring = true;

    console.log('[VideoMonitor] 已附加到 video 元素');
  }

  /**
   * 移除監聽器
   */
  detach() {
    if (!this.videoElement) {
      return;
    }

    this.videoElement.removeEventListener('timeupdate', this.boundHandlers.timeupdate);
    this.videoElement.removeEventListener('play', this.boundHandlers.play);
    this.videoElement.removeEventListener('pause', this.boundHandlers.pause);
    this.videoElement.removeEventListener('seeked', this.boundHandlers.seeked);

    this.videoElement = null;
    this.isMonitoring = false;
  }

  /**
   * 取得當前播放時間
   */
  getCurrentTime() {
    return this.videoElement ? this.videoElement.currentTime : 0;
  }

  /**
   * 處理時間更新事件
   */
  handleTimeUpdate() {
    if (this.onTimeUpdate) {
      this.onTimeUpdate(this.getCurrentTime());
    }
  }

  /**
   * 處理播放事件
   */
  handlePlay() {
    console.log('[VideoMonitor] 影片開始播放');
  }

  /**
   * 處理暫停事件
   */
  handlePause() {
    console.log('[VideoMonitor] 影片暫停');
  }

  /**
   * 處理跳轉事件
   */
  handleSeeked() {
    console.log('[VideoMonitor] 影片跳轉到', this.getCurrentTime().toFixed(2));
    if (this.onTimeUpdate) {
      this.onTimeUpdate(this.getCurrentTime());
    }
  }
}

/**
 * 字幕 Overlay 管理器
 */
class SubtitleOverlay {
  constructor() {
    this.container = null;
    this.segments = []; // 儲存所有接收到的 segments
    this.currentSegmentIndex = -1; // 當前顯示的 segment 索引
    this.videoMonitor = null;
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

    // 初始化 Video 監聽器
    this.videoMonitor = new VideoMonitor(this.handleTimeUpdate.bind(this));

    console.log('[ContentScript] Subtitle overlay 已初始化');
  }

  /**
   * 接收新的字幕資料
   */
  addSubtitleData(data) {
    if (!data.segments || data.segments.length === 0) {
      console.log('[ContentScript] 收到空的字幕資料');
      return;
    }

    console.log('[ContentScript] 接收字幕資料:', {
      chunkIndex: data.chunkIndex,
      segments: data.segments.length,
      startTime: data.startTime,
      endTime: data.endTime
    });

    // 將新的 segments 加入儲存
    this.segments.push(...data.segments);

    // 依照時間排序
    this.segments.sort((a, b) => a.start - b.start);

    console.log('[ContentScript] 目前總共有', this.segments.length, '個 segments');

    // 立即更新顯示
    const currentTime = this.videoMonitor.getCurrentTime();
    this.pruneOldSegments(currentTime);
    this.updateDisplay(currentTime);
  }

  /**
   * 處理時間更新
   */
  handleTimeUpdate(currentTime) {
    this.updateDisplay(currentTime);
  }

  /**
   * 根據當前時間更新顯示
   */
  updateDisplay(currentTime) {
    this.pruneOldSegments(currentTime);

    // 找出當前時間應該顯示的 segment
    const segmentIndex = this.findSegmentIndex(currentTime);

    if (segmentIndex === -1) {
      // 沒有符合的 segment，隱藏字幕
      this.hide();
      return;
    }

    // 如果是相同的 segment，不需要重新渲染
    if (segmentIndex === this.currentSegmentIndex) {
      return;
    }

    // 顯示新的 segment
    this.currentSegmentIndex = segmentIndex;
    this.show(this.segments[segmentIndex]);
  }

  /**
   * 找出當前時間對應的 segment 索引
   */
  findSegmentIndex(currentTime) {
    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      if (currentTime >= segment.start && currentTime <= segment.end) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 顯示字幕
   */
  show(segment) {
    // 清空容器
    this.container.innerHTML = '';

    // 建立字幕元素
    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'babel-subtitle';
    subtitleEl.textContent = segment.text;

    this.container.appendChild(subtitleEl);

    // 顯示容器
    this.container.style.display = 'flex';

    console.log('[ContentScript] 顯示字幕:', segment.text, `(${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s)`);
  }

  /**
   * 隱藏字幕
   */
  hide() {
    if (this.container.style.display !== 'none') {
      this.container.style.display = 'none';
      this.currentSegmentIndex = -1;
    }
  }

  /**
   * 清除過舊的字幕片段，避免記憶體無限成長
   */
  pruneOldSegments(currentTime) {
    if (this.segments.length === 0) {
      return;
    }

    const cutoff = Math.max(0, currentTime - SEGMENT_RETENTION_SECONDS);
    let removeCount = 0;

    while (
      removeCount < this.segments.length &&
      this.segments[removeCount].end < cutoff
    ) {
      removeCount++;
    }

    if (removeCount > 0) {
      this.segments.splice(0, removeCount);
      if (this.currentSegmentIndex !== -1) {
        this.currentSegmentIndex -= removeCount;
        if (this.currentSegmentIndex < -1) {
          this.currentSegmentIndex = -1;
        }
      }
    }
  }

  /**
   * 清除所有字幕
   */
  clear() {
    this.container.innerHTML = '';
    this.segments = [];
    this.currentSegmentIndex = -1;
    console.log('[ContentScript] 已清除所有字幕');
  }

  /**
   * 移除 Overlay
   */
  destroy() {
    if (this.videoMonitor) {
      this.videoMonitor.detach();
      this.videoMonitor = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.segments = [];
    this.currentSegmentIndex = -1;
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
      // 新版：使用 addSubtitleData 儲存 segments 並根據時間顯示
      overlay.addSubtitleData(data);
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
