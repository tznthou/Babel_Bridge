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
        subtree: true,
      });

      console.log('[VideoMonitor] 等待 video 元素出現...');

      // 10 秒後停止監聽（避免在無 video 頁面上持續監聽）
      setTimeout(() => {
        observer.disconnect();
        console.log('[VideoMonitor] 未偵測到 video 元素，停止監聽');
      }, 10000);
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
   * 取得 video 元素（getter）
   */
  get video() {
    return this.videoElement;
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
    this.segments = []; // 儲存所有接收到的 segments（已是影片絕對時間）
    this.currentSegmentIndex = -1; // 當前顯示的 segment 索引
    this.videoMonitor = null;
    this.resizeObserver = null;
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

    // 設定動態定位
    this.setupPositioning();
  }

  /**
   * 接收新的字幕資料（支援 Deepgram 即時字幕和 Whisper segments）
   */
  addSubtitleData(data) {
    // Deepgram 即時字幕格式
    if (data.text !== undefined) {
      this.addDeepgramTranscript(data);
      return;
    }

    // Whisper segments 格式
    if (!data.segments || data.segments.length === 0) {
      console.log('[ContentScript] 收到空的字幕資料');
      return;
    }

    const currentVideoTime = this.videoMonitor.getCurrentTime();

    console.log('[ContentScript] 📺 接收字幕資料:', {
      chunkIndex: data.chunkIndex,
      segments: data.segments.length,
      videoStartTime: data.videoStartTime?.toFixed(2),
      audioTime: data.audioStartTime
        ? `${data.audioStartTime.toFixed(2)}s - ${data.audioEndTime.toFixed(2)}s`
        : 'N/A',
      currentVideoTime: currentVideoTime.toFixed(2),
    });

    // Service Worker 已提供正確的絕對時間，只需處理延遲到達的情況
    const segments = data.segments.map((seg) => {
      // 延遲到達補償：如果 segment 已經過去，延長顯示時間
      const delaySeconds = Math.max(0, currentVideoTime - seg.end);
      const adjustedEnd = delaySeconds > 0 ? currentVideoTime + 3 : seg.end;

      return {
        ...seg,
        end: adjustedEnd,
        _delayedArrival: delaySeconds > 0,
        _originalEnd: seg.end,
      };
    });

    console.log('[ContentScript] 📊 Segments 時間範圍:', {
      first: segments[0]
        ? `${segments[0].start.toFixed(2)}s - ${segments[0].end.toFixed(2)}s`
        : 'N/A',
      last: segments[segments.length - 1]
        ? `${segments[segments.length - 1].start.toFixed(2)}s - ${segments[segments.length - 1].end.toFixed(2)}s`
        : 'N/A',
      text: segments[0]?.text || 'N/A',
      delayedArrival: segments[0]?._delayedArrival || false,
    });

    // 將 segments 加入儲存
    this.segments.push(...segments);

    // 依照時間排序
    this.segments.sort((a, b) => a.start - b.start);

    console.log('[ContentScript] ✅ 目前總共有', this.segments.length, '個 segments');

    // 立即更新顯示
    this.pruneOldSegments(currentVideoTime);
    this.updateDisplay(currentVideoTime);
  }

  /**
   * 處理 Deepgram 即時字幕（直接顯示，不依賴時間戳）
   */
  addDeepgramTranscript(data) {
    const { text, isFinal, confidence } = data;

    console.log('[ContentScript] 🎤 Deepgram 即時字幕:', {
      text,
      isFinal,
      confidence,
    });

    if (!text || text.trim() === '') {
      console.log('[ContentScript] 空白字幕，跳過');
      return;
    }

    // 即時字幕：直接顯示，不需要時間同步
    // Final 字幕顯示 3 秒，Interim 字幕持續更新
    const currentTime = this.videoMonitor.getCurrentTime();
    const segment = {
      text: text.trim(),
      start: currentTime,
      end: currentTime + (isFinal ? 3 : 999999), // Interim 字幕一直顯示直到被 Final 替換
      confidence,
      isFinal,
      _deepgram: true,
    };

    if (isFinal) {
      // Final 字幕：加入 segments 列表
      this.segments.push(segment);
      this.segments.sort((a, b) => a.start - b.start);
      console.log('[ContentScript] ✅ Final 字幕已加入，總共', this.segments.length, '個');
    }

    // 立即顯示（Final 和 Interim 都顯示）
    this.showDirect(segment);
  }

  /**
   * 直接顯示字幕（不經過時間查找）
   */
  showDirect(segment) {
    // 清空容器
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    // 建立字幕元素
    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'babel-subtitle';
    subtitleEl.textContent = segment.text;

    // Interim 字幕半透明
    if (!segment.isFinal) {
      subtitleEl.style.opacity = '0.7';
    }

    this.container.appendChild(subtitleEl);
    this.container.style.display = 'flex';

    console.log(
      '[ContentScript] 📺 顯示字幕:',
      segment.text,
      `[${segment.isFinal ? 'Final' : 'Interim'}]`
    );
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

    // 診斷: 顯示搜尋結果
    if (this.segments.length > 0) {
      console.log('[ContentScript] 🔍 updateDisplay:', {
        currentTime: currentTime.toFixed(2),
        totalSegments: this.segments.length,
        segmentIndex,
        firstSegment: `${this.segments[0].start.toFixed(2)}s - ${this.segments[0].end.toFixed(2)}s`,
        lastSegment: `${this.segments[this.segments.length - 1].start.toFixed(2)}s - ${this.segments[this.segments.length - 1].end.toFixed(2)}s`,
      });
    }

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
    // 清空容器 (使用 DOM API，避免 Trusted Types 錯誤)
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    // 建立字幕元素
    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'babel-subtitle';
    subtitleEl.textContent = segment.text;

    this.container.appendChild(subtitleEl);

    // 顯示容器
    this.container.style.display = 'flex';

    console.log(
      '[ContentScript] 顯示字幕:',
      segment.text,
      `(${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s)`
    );
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

    while (removeCount < this.segments.length && this.segments[removeCount].end < cutoff) {
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
    // 清空容器 (使用 DOM API，避免 Trusted Types 錯誤)
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.segments = [];
    this.currentSegmentIndex = -1;
    console.log('[ContentScript] 已清除所有字幕');
  }

  /**
   * 移除 Overlay
   */
  destroy() {
    console.log('[ContentScript] 🗑️  銷毀 SubtitleOverlay');

    // 清理 VideoMonitor
    if (this.videoMonitor) {
      this.videoMonitor.detach();
      this.videoMonitor = null;
    }

    // 清理 ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // 移除 DOM 元素
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.segments = [];
    this.currentSegmentIndex = -1;
  }

  /**
   * 設定動態定位 - 監聽影片尺寸與全螢幕變化
   *
   * ⚠️ 前提：enableSubtitles() 已確保頁面有 video 元素
   */
  setupPositioning() {
    const video = this.videoMonitor.video;

    // 防禦性檢查（理論上不應該發生，因為 enableSubtitles 已檢查過）
    if (!video) {
      console.error('[ContentScript] ❌ setupPositioning: 無 video 元素（不應該發生！）');
      return;
    }

    console.log('[ContentScript] 找到 video 元素，readyState:', video.readyState);

    // 等待 video metadata 載入完成
    if (video.readyState < 2) {
      console.log('[ContentScript] 等待 video loadedmetadata 事件...');
      video.addEventListener(
        'loadedmetadata',
        () => {
          console.log('[ContentScript] loadedmetadata 觸發，開始定位');
          this.initPositioning(video);
        },
        { once: true }
      );

      // 備用：5 秒超時後強制執行
      setTimeout(() => {
        if (!this.resizeObserver) {
          console.warn('[ContentScript] loadedmetadata 超時，強制開始定位');
          this.initPositioning(video);
        }
      }, 5000);
    } else {
      this.initPositioning(video);
    }
  }

  /**
   * 初始化定位監聽器
   */
  initPositioning(video) {
    // ResizeObserver 監聽影片尺寸變化
    this.resizeObserver = new ResizeObserver(() => {
      this.updatePosition();
    });
    this.resizeObserver.observe(video);

    // Fullscreen 監聽（支援不同瀏覽器前綴）
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'].forEach((event) => {
      document.addEventListener(event, () => this.handleFullscreen());
    });

    // 初始定位
    this.updatePosition();

    console.log('[ContentScript] ✅ 動態定位已設定');
  }

  /**
   * 更新 Overlay 位置 - 精確對齊影片播放器
   */
  updatePosition() {
    const video = this.videoMonitor.video;
    if (!video) {
      console.warn('[ContentScript] updatePosition: 無 video 元素');
      return;
    }

    const rect = video.getBoundingClientRect();

    // 🔍 診斷資訊
    console.log('[ContentScript] 🎯 影片位置診斷', {
      video標籤: video.tagName,
      video類別: video.className,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      視窗寬度: window.innerWidth,
      視窗高度: window.innerHeight,
      videoReadyState: video.readyState,
    });

    // 動態計算 overlay 位置（精確對齊影片）
    this.container.style.left = `${rect.left}px`;
    this.container.style.top = `${rect.top}px`;
    this.container.style.width = `${rect.width}px`;
    this.container.style.height = `${rect.height}px`;

    console.log('[ContentScript] ✅ Overlay 位置已更新');
  }

  /**
   * 處理全螢幕模式切換
   */
  handleFullscreen() {
    const isFullscreen = !!document.fullscreenElement;
    this.container.classList.toggle('fullscreen', isFullscreen);
    this.updatePosition();

    console.log('[ContentScript] 全螢幕模式:', isFullscreen);
  }
}

// 全域 Overlay 實例（延遲初始化）
let overlay = null;

/**
 * 初始化字幕 Overlay（僅在啟用時執行）
 */
function enableSubtitles() {
  if (overlay) {
    console.log('[ContentScript] 字幕已啟用，跳過重複初始化');
    return { success: true };
  }

  // ✅ 啟用前先檢查頁面是否有 video 元素
  const video = document.querySelector('video');
  if (!video) {
    console.warn('[ContentScript] ⚠️ 此頁面沒有影片元素，無法啟用字幕');
    return {
      success: false,
      error: '此頁面沒有影片，請在 YouTube、Netflix 等影片網站使用',
    };
  }

  console.log('[ContentScript] 🟢 啟用字幕功能');
  overlay = new SubtitleOverlay();
  return { success: true };
}

/**
 * 停用並清理字幕 Overlay
 */
function disableSubtitles() {
  if (!overlay) {
    console.log('[ContentScript] 字幕未啟用，無需停用');
    return { success: true };
  }

  console.log('[ContentScript] 🔴 停用字幕功能');
  overlay.destroy();
  overlay = null;
  return { success: true };
}

/**
 * 處理來自 Background 的訊息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  console.log('[ContentScript] 收到訊息:', type);

  switch (type) {
    case 'ENABLE_SUBTITLES':
      // 啟用字幕功能
      sendResponse(enableSubtitles());
      break;

    case 'DISABLE_SUBTITLES':
      // 停用字幕功能
      sendResponse(disableSubtitles());
      break;

    case MessageTypes.SUBTITLE_UPDATE:
      // 新版：使用 addSubtitleData 儲存 segments 並根據時間顯示
      if (!overlay) {
        console.warn('[ContentScript] 字幕未啟用，忽略 SUBTITLE_UPDATE');
        sendResponse({ success: false, error: '字幕未啟用' });
        break;
      }
      overlay.addSubtitleData(data);
      sendResponse({ success: true });
      break;

    case MessageTypes.CLEAR_SUBTITLES:
      if (!overlay) {
        console.warn('[ContentScript] 字幕未啟用，忽略 CLEAR_SUBTITLES');
        sendResponse({ success: false, error: '字幕未啟用' });
        break;
      }
      overlay.clear();
      sendResponse({ success: true });
      break;

    case MessageTypes.STYLE_UPDATE:
      if (!overlay) {
        console.warn('[ContentScript] 字幕未啟用，忽略 STYLE_UPDATE');
        sendResponse({ success: false, error: '字幕未啟用' });
        break;
      }
      // TODO: 更新字幕樣式
      sendResponse({ success: true });
      break;

    case 'GET_VIDEO_CURRENT_TIME': {
      // 回傳影片當前時間給 Background Service Worker
      if (!overlay) {
        console.warn('[ContentScript] 字幕未啟用，無法取得影片時間');
        sendResponse({ success: false, currentTime: 0 });
        break;
      }
      const currentTime = overlay.videoMonitor.getCurrentTime();
      console.log('[ContentScript] 回報影片時間:', currentTime.toFixed(2), 's');
      sendResponse({ success: true, currentTime });
      break;
    }

    default:
      console.warn('[ContentScript] 未知訊息類型:', type);
      sendResponse({ success: false });
  }
});

console.log('[ContentScript] Content script 已載入');
