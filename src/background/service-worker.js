/**
 * Background Service Worker - Babel Bridge 核心控制器 (Manifest V3)
 *
 * 新架構（2025-11-09）：
 * - 音訊擷取和編碼已移至 Offscreen Document
 * - Service Worker 僅負責：協調流程、Whisper API 呼叫、字幕處理
 *
 * 流程：
 * 1. Service Worker → AudioCapture → Offscreen Document
 * 2. Offscreen Document → 音訊處理 → MP3 編碼 → AUDIO_CHUNK_READY 訊息
 * 3. Service Worker → Whisper API → OverlapProcessor → Content Script
 */
import { AudioCapture } from './audio-capture.js';
import { WhisperClient } from './whisper-client.js';
import { OverlapProcessor } from './subtitle-processor.js';
import { APIKeyManager } from '../lib/api-key-manager.js';
import { ErrorHandler } from '../lib/error-handler.js';
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';
import { MessageTypes, OVERLAP_CONFIG } from '../lib/config.js';

/**
 * 全域狀態管理
 */
class SubtitleService {
  constructor() {
    this.audioCapture = null;
    this.whisperClient = null;
    this.overlapProcessor = null;

    this.isActive = false;
    this.currentTabId = null;

    console.log('[SubtitleService] Service Worker 已啟動');
  }

  /**
   * 初始化服務
   */
  async init() {
    // 初始化 Whisper Client
    this.whisperClient = new WhisperClient();
    await this.whisperClient.init();

    // 初始化 OverlapProcessor (去重與斷句優化)
    this.overlapProcessor = new OverlapProcessor(OVERLAP_CONFIG);

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
      if (!this.whisperClient) {
        await this.init();
      }

      this.currentTabId = tabId;

      // 啟動音訊擷取 (Offscreen Document 會自動處理切塊和編碼)
      this.audioCapture = new AudioCapture();
      await this.audioCapture.start(tabId);

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
   * 處理音訊 chunk (來自 Offscreen Document 的 audio/webm)
   * @private
   */
  async processChunk(chunkData) {
    try {
      const {
        chunkIndex,
        startTime,
        endTime,
        audioBuffer,
        audioBase64,
        blob,
        size,
        mimeType,
        duration,
      } = chunkData;

      console.log(`[SubtitleService] 處理 Chunk ${chunkIndex}`, {
        startTime: startTime.toFixed(2),
        endTime: endTime.toFixed(2),
        size: `${(size / 1024).toFixed(2)} KB`,
        mimeType: mimeType || 'unknown',
        hasBase64: Boolean(audioBase64),
      });

      const audioBlob = await this.createAudioBlob({
        audioBuffer,
        audioBase64,
        blob,
        mimeType,
      });

      // 1. 送至 Whisper 辨識 (支援音訊格式由 mimeType 決定)
      const transcription = await this.whisperClient.transcribe(audioBlob, {
        mimeType,
        chunkIndex,
      });

      console.log(`[SubtitleService] Whisper 辨識完成`, {
        text: transcription.text,
        segments: transcription.segments.length,
      });

      // 2. OverlapProcessor 處理 (去重與斷句優化)
      const processedSegments = this.overlapProcessor.process(
        transcription,
        startTime
      );

      console.log(`[SubtitleService] OverlapProcessor 處理完成`, {
        originalSegments: transcription.segments.length,
        processedSegments: processedSegments.length,
        filtered: transcription.segments.length - processedSegments.length,
      });

      // 3. 記錄成本
      const durationSeconds = typeof duration === 'number'
        ? duration
        : endTime - startTime;
      await APIKeyManager.trackWhisperUsage(durationSeconds);

      // 4. 發送字幕到 Content Script (只發送新的 segments)
      if (processedSegments.length > 0) {
        await this.sendSubtitleToContent({
          chunkIndex,
          startTime,
          endTime,
          text: transcription.text,
          segments: processedSegments,
          language: transcription.language,
        });
      } else {
        console.log('[SubtitleService] 無新字幕 (重複區已過濾)');
      }
    } catch (error) {
      await ErrorHandler.handle(error, {
        operation: 'process_chunk',
        chunkIndex: chunkData.chunkIndex,
      });
    }
  }

  /**
   * 從 chunkData 重建可用的 Blob
   */
  async createAudioBlob({ audioBuffer, audioBase64, blob, mimeType }) {
    const type = mimeType || blob?.type || 'audio/webm';

    if (audioBase64) {
      return this.blobFromBase64(audioBase64, type);
    }

    if (audioBuffer instanceof ArrayBuffer) {
      return new Blob([audioBuffer], { type });
    }

    if (audioBuffer && audioBuffer.buffer instanceof ArrayBuffer) {
      return new Blob([audioBuffer.buffer], { type });
    }

    if (blob instanceof Blob) {
      return blob;
    }

    if (blob && typeof blob === 'object') {
      if (typeof blob.arrayBuffer === 'function') {
        const buffer = await blob.arrayBuffer();
        return new Blob([buffer], { type });
      }

      const reconstructed = this.extractArrayBuffer(blob);
      if (reconstructed) {
        return new Blob([reconstructed], { type });
      }
    }

    throw new BabelBridgeError(
      ErrorCodes.UNKNOWN_ERROR,
      'Invalid audio data received from Offscreen Document',
      {
        hasAudioBuffer: Boolean(audioBuffer),
        blobKeys: blob ? Object.keys(blob) : [],
      }
    );
  }

  extractArrayBuffer(blobLike) {
    if (blobLike.data instanceof ArrayBuffer) {
      return blobLike.data;
    }

    if (
      blobLike.data &&
      typeof blobLike.data === 'object' &&
      blobLike.data.type === 'Buffer' &&
      Array.isArray(blobLike.data.data)
    ) {
      return Uint8Array.from(blobLike.data.data).buffer;
    }

    if (Array.isArray(blobLike.data)) {
      const buffers = blobLike.data
        .map((part) => {
          if (part instanceof ArrayBuffer) {
            return part;
          }
          if (
            part &&
            typeof part === 'object' &&
            part.type === 'Buffer' &&
            Array.isArray(part.data)
          ) {
            return Uint8Array.from(part.data).buffer;
          }
          if (part && part.buffer instanceof ArrayBuffer) {
            return part.buffer;
          }
          return null;
        })
        .filter(Boolean);

      if (buffers.length === 0) {
        return null;
      }

      const totalLength = buffers.reduce(
        (sum, buffer) => sum + buffer.byteLength,
        0
      );
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const buffer of buffers) {
        merged.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      }

      return merged.buffer;
    }

    return null;
  }

  blobFromBase64(base64, type) {
    try {
      let binary;
      if (typeof atob === 'function') {
        binary = atob(base64);
      } else if (typeof Buffer !== 'undefined') {
        binary = Buffer.from(base64, 'base64').toString('binary');
      } else {
        throw new Error('Base64 decoder not available');
      }

      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes.buffer], { type });
    } catch (error) {
      throw new BabelBridgeError(
        ErrorCodes.UNKNOWN_ERROR,
        'Failed to decode audio chunk (base64)',
        { error: error.message }
      );
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
    if (this.audioCapture) {
      this.audioCapture.stop().catch((error) => {
        console.error('[SubtitleService] 停止音訊擷取時發生錯誤:', error);
      });
      this.audioCapture = null;
    }

    if (this.overlapProcessor) {
      this.overlapProcessor.reset();
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
    };
  }
}

// 建立全域服務實例
const service = new SubtitleService();

/**
 * 處理來自 Popup、Content Script 和 Offscreen Document 的訊息
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

        case 'AUDIO_CHUNK_READY': {
          // 來自 Offscreen Document 的音訊 chunk (已編碼為 MP3)
          await service.processChunk(data);
          // 不需要 sendResponse (Offscreen 不等待回應)
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
