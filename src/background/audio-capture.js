/**
 * AudioCapture - 音訊擷取協調器 (Manifest V3)
 *
 * 架構說明：
 * - Service Worker 無法直接使用 AudioContext 和 MediaStream
 * - 需透過 Offscreen Document 處理所有音訊相關操作
 *
 * 流程：
 * 1. Service Worker 調用 getMediaStreamId() 取得 streamId
 * 2. 發送 streamId 給 Offscreen Document
 * 3. Offscreen Document 取得 MediaStream 並處理音訊
 * 4. Offscreen Document 將處理好的音訊塊發回 Service Worker
 */
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';

export class AudioCapture {
  constructor() {
    this.isCapturing = false;
    this.currentTabId = null;
    this.offscreenDocumentPath = 'src/offscreen/offscreen.html';
  }

  /**
   * 開始擷取指定分頁的音訊
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<void>}
   */
  async start(tabId) {
    if (this.isCapturing) {
      throw new BabelBridgeError(
        ErrorCodes.AUDIO_CAPTURE_FAILED,
        'Audio capture already in progress'
      );
    }

    try {
      console.log(`[AudioCapture] 開始擷取 Tab ${tabId} 音訊`);

      // Step 1: 確保 Offscreen Document 存在
      await this.ensureOffscreenDocument();

      // Step 2: 取得 MediaStream ID
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId,
      });

      if (!streamId) {
        throw new BabelBridgeError(
          ErrorCodes.AUDIO_CAPTURE_FAILED,
          'Failed to get MediaStream ID',
          { tabId }
        );
      }

      console.log(`[AudioCapture] 已取得 streamId: ${streamId}`);

      // Step 3: 請求 Offscreen Document 開始音訊擷取
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_START_AUDIO_CAPTURE',
        data: { streamId, tabId },
      });

      if (!response.success) {
        throw new BabelBridgeError(
          ErrorCodes.AUDIO_CAPTURE_FAILED,
          response.error || 'Offscreen Document failed to start audio capture',
          { tabId }
        );
      }

      this.isCapturing = true;
      this.currentTabId = tabId;

      console.log('[AudioCapture] 音訊擷取已啟動');
    } catch (error) {
      this.cleanup();

      if (error instanceof BabelBridgeError) {
        throw error;
      }

      throw new BabelBridgeError(
        ErrorCodes.AUDIO_CAPTURE_FAILED,
        `Failed to capture audio: ${error.message}`,
        { tabId, originalError: error }
      );
    }
  }

  /**
   * 停止音訊擷取
   */
  async stop() {
    if (!this.isCapturing) {
      return;
    }

    try {
      console.log('[AudioCapture] 停止音訊擷取');

      // 請求 Offscreen Document 停止音訊擷取
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_STOP_AUDIO_CAPTURE',
      });

      if (!response.success) {
        console.warn('[AudioCapture] 停止音訊擷取時發生錯誤:', response.error);
      }
    } catch (error) {
      console.error('[AudioCapture] 停止音訊擷取失敗:', error);
    } finally {
      this.cleanup();
    }
  }

  /**
   * 確保 Offscreen Document 存在
   * @private
   */
  async ensureOffscreenDocument() {
    const hasDocument = await chrome.offscreen.hasDocument();

    if (!hasDocument) {
      console.log('[AudioCapture] 創建 Offscreen Document');

      await chrome.offscreen.createDocument({
        url: this.offscreenDocumentPath,
        reasons: ['AUDIO_PLAYBACK', 'WORKERS'], // AUDIO_PLAYBACK 用於 AudioContext
        justification:
          'Audio capture requires AudioContext and Web Workers, which are not available in Service Workers',
      });
    }
  }

  /**
   * 清理資源
   * @private
   */
  cleanup() {
    this.isCapturing = false;
    this.currentTabId = null;
  }

  /**
   * 取得擷取狀態
   */
  get capturing() {
    return this.isCapturing;
  }

  /**
   * 取得當前分頁 ID
   */
  get tabId() {
    return this.currentTabId;
  }
}
