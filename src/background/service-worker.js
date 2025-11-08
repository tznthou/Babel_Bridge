/**
 * Background Service Worker - Babel Bridge 核心控制器
 *
 * 職責:
 * 1. 編排音訊處理流程 (Capture → Chunk → Encode → Whisper)
 * 2. 管理 API 呼叫
 * 3. 處理來自 Popup 和 Content Script 的訊息
 */
import { AudioCapture } from './audio-capture.js';
import { AudioChunker } from './audio-chunker.js';
import { MP3Encoder } from './mp3-encoder.js';
import { WhisperClient } from './whisper-client.js';
import { APIKeyManager } from '../lib/api-key-manager.js';
import { ErrorHandler } from '../lib/error-handler.js';
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';
import { MessageTypes } from '../lib/config.js';

/**
 * 全域狀態管理
 */
class SubtitleService {
  constructor() {
    this.audioCapture = null;
    this.audioChunker = null;
    this.mp3Encoder = null;
    this.whisperClient = null;

    this.isActive = false;
    this.currentTabId = null;

    console.log('[SubtitleService] Service Worker 已啟動');
  }

  /**
   * 初始化服務
   */
  async init() {
    // 初始化 MP3 編碼器
    this.mp3Encoder = new MP3Encoder();
    await this.mp3Encoder.init();

    // 初始化 Whisper Client
    this.whisperClient = new WhisperClient();
    await this.whisperClient.init();

    console.log('[SubtitleService] 服務初始化完成');
  }

  /**
   * 啟用字幕功能
   */
  async enable(tabId) {
    if (this.isActive) {
      console.warn('[SubtitleService] 服務已啟用');
      return;
    }

    try {
      // 確保初始化
      if (!this.mp3Encoder || !this.whisperClient) {
        await this.init();
      }

      this.currentTabId = tabId;

      // 1. 啟動音訊擷取
      this.audioCapture = new AudioCapture();
      await this.audioCapture.start(tabId);

      // 2. 建立音訊處理器
      const audioContext = this.audioCapture.getAudioContext();
      this.audioChunker = new AudioChunker(audioContext);

      // 3. 開始處理音訊 (當 chunk 準備好時觸發處理)
      const sourceNode = this.audioCapture.getSourceNode();
      this.audioChunker.start(sourceNode, (chunk) => {
        this.processChunk(chunk);
      });

      this.isActive = true;

      console.log(`[SubtitleService] 已啟用 (Tab ${tabId})`);
      return { success: true };
    } catch (error) {
      await ErrorHandler.handle(error, { operation: 'enable_service', tabId });
      this.cleanup();
      throw error;
    }
  }

  /**
   * 停用字幕功能
   */
  async disable() {
    if (!this.isActive) {
      return;
    }

    this.cleanup();
    this.isActive = false;

    console.log('[SubtitleService] 已停用');
    return { success: true };
  }

  /**
   * 處理音訊 chunk
   * @private
   */
  async processChunk(chunk) {
    try {
      console.log(`[SubtitleService] 處理 Chunk ${chunk.index}`, {
        startTime: chunk.startTime.toFixed(2),
        endTime: chunk.endTime.toFixed(2),
      });

      // 1. 編碼為 MP3
      const mp3Blob = await this.mp3Encoder.encode(chunk.samples);

      console.log(`[SubtitleService] MP3 編碼完成`, {
        size: mp3Blob.size,
      });

      // 2. 送至 Whisper 辨識
      const transcription = await this.whisperClient.transcribe(mp3Blob);

      console.log(`[SubtitleService] Whisper 辨識完成`, {
        text: transcription.text,
        segments: transcription.segments.length,
      });

      // 3. 記錄成本
      await APIKeyManager.trackWhisperUsage(chunk.endTime - chunk.startTime);

      // 4. 發送字幕到 Content Script
      await this.sendSubtitleToContent({
        chunkIndex: chunk.index,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        text: transcription.text,
        segments: transcription.segments,
        language: transcription.language,
      });
    } catch (error) {
      await ErrorHandler.handle(error, {
        operation: 'process_chunk',
        chunkIndex: chunk.index,
      });
    }
  }

  /**
   * 發送字幕到 Content Script
   * @private
   */
  async sendSubtitleToContent(subtitle) {
    if (!this.currentTabId) {
      return;
    }

    try {
      await chrome.tabs.sendMessage(this.currentTabId, {
        type: MessageTypes.SUBTITLE_UPDATE,
        data: subtitle,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[SubtitleService] 發送字幕失敗:', error);
    }
  }

  /**
   * 清理資源
   * @private
   */
  cleanup() {
    if (this.audioChunker) {
      this.audioChunker.stop();
      this.audioChunker = null;
    }

    if (this.audioCapture) {
      this.audioCapture.stop();
      this.audioCapture = null;
    }

    this.currentTabId = null;
  }

  /**
   * 取得服務狀態
   */
  getStatus() {
    return {
      active: this.isActive,
      tabId: this.currentTabId,
      stats: this.audioChunker ? this.audioChunker.getStats() : null,
    };
  }
}

// 建立全域服務實例
const service = new SubtitleService();

/**
 * 處理來自 Popup 和 Content Script 的訊息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  console.log('[Service Worker] 收到訊息:', type, data);

  // 使用 async handler
  (async () => {
    try {
      switch (type) {
        case MessageTypes.ENABLE_SUBTITLES: {
          const result = await service.enable(sender.tab?.id || data.tabId);
          sendResponse(result);
          break;
        }

        case MessageTypes.DISABLE_SUBTITLES: {
          const result = await service.disable();
          sendResponse(result);
          break;
        }

        case MessageTypes.VERIFY_API_KEY: {
          await APIKeyManager.verifyAndSave(data.apiKey);
          sendResponse({ success: true });
          break;
        }

        case MessageTypes.GET_COST_STATS: {
          const stats = await APIKeyManager.getCurrentMonthStats();
          sendResponse({ success: true, data: stats });
          break;
        }

        default:
          console.warn('[Service Worker] 未知訊息類型:', type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[Service Worker] 處理訊息錯誤:', error);
      sendResponse({
        success: false,
        error: error instanceof BabelBridgeError ? error.toJSON() : error.message,
      });
    }
  })();

  // 保持訊息通道開啟 (async handler 需要)
  return true;
});

/**
 * Extension 安裝/更新事件
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Service Worker] Extension 已安裝/更新:', details.reason);

  if (details.reason === 'install') {
    // 首次安裝 - 開啟設定頁面
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/popup/popup.html'),
    });
  }
});

/**
 * Tab 關閉事件 - 清理資源
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (service.currentTabId === tabId) {
    console.log('[Service Worker] 目標 Tab 已關閉,停用服務');
    service.disable();
  }
});

console.log('[Service Worker] 已載入並就緒');
