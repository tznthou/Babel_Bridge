/**
 * Background Service Worker - Babel Bridge 核心控制器 (Manifest V3)
 *
 * Deepgram Streaming 架構（2025-11-16）：
 * - 音訊擷取和 PCM 轉換已移至 Offscreen Document (AudioWorklet)
 * - Service Worker 負責：協調流程、Deepgram WebSocket、即時字幕處理
 *
 * 流程：
 * 1. Service Worker → AudioCapture → Offscreen Document
 * 2. Offscreen Document → AudioWorklet (PCM processor) → PCM frames (20ms)
 * 3. Service Worker → DeepgramStreamClient → WebSocket → 即時字幕
 * 4. Service Worker → Content Script (即時顯示)
 */
import { AudioCapture } from './audio-capture.js';
import { DeepgramStreamClient } from './deepgram-stream-client.js';
import { APIKeyManager } from '../lib/api-key-manager.js';
import { ErrorHandler } from '../lib/error-handler.js';
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';
import { MessageTypes } from '../lib/config.js';

/**
 * 全域狀態管理（Deepgram Streaming）
 */
class SubtitleService {
  constructor() {
    this.audioCapture = null;
    this.deepgramClient = null;

    this.isActive = false;
    this.currentTabId = null;

    console.log('[SubtitleService] Service Worker 已啟動（Deepgram Streaming）');
  }

  /**
   * 初始化服務
   */
  async init() {
    // 初始化 Deepgram Stream Client
    this.deepgramClient = new DeepgramStreamClient();
    await this.deepgramClient.init();

    // 設定即時字幕回調
    this.deepgramClient.onTranscript = (transcript) => {
      this.handleTranscript(transcript);
    };

    // 設定錯誤回調
    this.deepgramClient.onError = (error) => {
      console.error('[SubtitleService] Deepgram 錯誤:', error);
      ErrorHandler.handle(error, { operation: 'deepgram_streaming' });
    };

    // 設定狀態變更回調
    this.deepgramClient.onStateChange = (newState, oldState) => {
      console.log(`[SubtitleService] Deepgram 狀態: ${oldState} → ${newState}`);
    };

    console.log('[SubtitleService] 服務初始化完成');
  }

  /**
   * 啟用字幕功能（Deepgram Streaming）
   */
  async enable(tabId) {
    if (this.isActive) {
      console.warn('[SubtitleService] 服務已啟用');
      return { success: true };
    }

    try {
      // 確保初始化
      if (!this.deepgramClient) {
        await this.init();
      }

      this.currentTabId = tabId;

      // 通知 Content Script 啟用字幕（檢查頁面是否有 video）
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'ENABLE_SUBTITLES'
      });

      // 如果 Content Script 回報沒有 video，立即回傳錯誤
      if (!response.success) {
        console.warn('[SubtitleService] Content Script 回報:', response.error);
        return {
          success: false,
          error: response.error || '無法啟用字幕'
        };
      }

      // 啟動音訊擷取 (Offscreen Document 會自動處理 PCM 轉換)
      this.audioCapture = new AudioCapture();
      await this.audioCapture.start(tabId);

      this.isActive = true;

      console.log(`[SubtitleService] 已啟用 Deepgram Streaming (Tab ${tabId})`);
      return { success: true };
    } catch (error) {
      await ErrorHandler.handle(error, { operation: 'enable_service', tabId });
      this.cleanup();

      // 將錯誤訊息傳遞回 Popup
      return {
        success: false,
        error: error.message || '啟用字幕失敗'
      };
    }
  }

  /**
   * 停用字幕功能（Deepgram Streaming）
   */
  async disable() {
    if (!this.isActive) {
      return;
    }

    const tabId = this.currentTabId;

    // 通知 Content Script 停用字幕
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'DISABLE_SUBTITLES'
        });
      } catch (error) {
        // Content Script 可能已卸載，忽略錯誤
        console.warn('[SubtitleService] 無法通知 Content Script 停用:', error.message);
      }
    }

    this.cleanup();
    this.isActive = false;

    console.log('[SubtitleService] 已停用 Deepgram Streaming');
    return { success: true };
  }

  /**
   * 處理 PCM frame（來自 Offscreen Document）並發送到 Deepgram
   * @private
   */
  handlePCMFrame(frameData) {
    if (!this.deepgramClient) {
      console.warn('[SubtitleService] Deepgram client 未初始化');
      return;
    }

    const { pcmData, frameIndex, sampleRate } = frameData;

    // 直接發送到 Deepgram（即時串流）
    this.deepgramClient.sendAudio(pcmData);
  }

  /**
   * 處理 Deepgram 即時字幕回調
   * @private
   */
  handleTranscript(transcript) {
    const { text, isFinal, confidence, words, timestamp } = transcript;

    console.log(`[SubtitleService] ${isFinal ? '✅ Final' : '⏳ Interim'} 字幕:`, text);

    // 發送到 Content Script
    this.sendSubtitleToContent({
      text,
      isFinal,
      confidence,
      words,
      timestamp,
    });
  }

  /**
   * 發送字幕到 Content Script
   * @private
   */
  async sendSubtitleToContent(subtitle) {
    if (!this.currentTabId) {
      console.warn('[SubtitleService] 無法發送字幕: currentTabId 為空');
      return;
    }

    try {
      await chrome.tabs.sendMessage(this.currentTabId, {
        type: MessageTypes.SUBTITLE_UPDATE,
        data: subtitle,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[SubtitleService] ❌ 發送字幕失敗:', error);
    }
  }

  /**
   * 清理資源
   * @private
   */
  cleanup() {
    // 停止音訊擷取
    if (this.audioCapture) {
      this.audioCapture.stop().catch((error) => {
        console.error('[SubtitleService] 停止音訊擷取時發生錯誤:', error);
      });
      this.audioCapture = null;
    }

    // 關閉 Deepgram 連線
    if (this.deepgramClient) {
      this.deepgramClient.close().catch((error) => {
        console.error('[SubtitleService] 關閉 Deepgram 連線時發生錯誤:', error);
      });
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

        case 'DEEPGRAM_PCM_FRAME': {
          // 來自 Offscreen Document 的 PCM frame
          service.handlePCMFrame(data);
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
