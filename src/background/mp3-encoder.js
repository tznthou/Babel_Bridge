/**
 * MP3Encoder - Web Worker 包裝器
 *
 * 提供簡潔的 API 來使用 MP3 編碼 Worker
 */
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';

export class MP3Encoder {
  constructor() {
    this.isReady = false;
    this.offscreenDocumentPath = 'src/offscreen/offscreen.html';
  }

  /**
   * 初始化 Offscreen Document
   */
  async init() {
    if (this.isReady) {
      return;
    }

    try {
      // 檢查 Offscreen Document 是否已存在
      const hasDocument = await chrome.offscreen.hasDocument();

      if (!hasDocument) {
        // 創建 Offscreen Document
        await chrome.offscreen.createDocument({
          url: this.offscreenDocumentPath,
          reasons: ['WORKERS'],
          justification: 'MP3 encoding requires Web Worker, which is not available in Service Worker context',
        });

        console.log('[MP3Encoder] Offscreen Document 已創建');
      }

      // 初始化 Worker（通過 Offscreen Document）
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_INIT_WORKER',
      });

      if (!response.success) {
        throw new BabelBridgeError(
          ErrorCodes.AUDIO_ENCODING_FAILED,
          `Failed to initialize worker: ${response.error}`
        );
      }

      this.isReady = true;
      console.log('[MP3Encoder] MP3 Encoder 已初始化');
    } catch (error) {
      throw new BabelBridgeError(
        ErrorCodes.AUDIO_ENCODING_FAILED,
        `Failed to initialize worker: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 編碼音訊為 MP3
   * @param {Float32Array} samples - 音訊樣本
   * @returns {Promise<Blob>} MP3 Blob
   */
  async encode(samples) {
    if (!this.isReady) {
      throw new BabelBridgeError(
        ErrorCodes.AUDIO_ENCODING_FAILED,
        'Worker not initialized. Call init() first.'
      );
    }

    try {
      const startTime = performance.now();

      // 發送編碼請求到 Offscreen Document
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_ENCODE_MP3',
        data: { samples },
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      const duration = performance.now() - startTime;

      console.log(`[MP3Encoder] 編碼成功`, {
        size: response.data.size,
        duration: duration.toFixed(2) + 'ms',
      });

      return response.data.blob;
    } catch (error) {
      throw new BabelBridgeError(
        ErrorCodes.AUDIO_ENCODING_FAILED,
        `Encoding failed: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 終止 Worker 並關閉 Offscreen Document
   */
  async terminate() {
    if (!this.isReady) {
      return;
    }

    try {
      // 終止 Worker
      await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_TERMINATE_WORKER',
      });

      // 關閉 Offscreen Document
      const hasDocument = await chrome.offscreen.hasDocument();
      if (hasDocument) {
        await chrome.offscreen.closeDocument();
        console.log('[MP3Encoder] Offscreen Document 已關閉');
      }

      this.isReady = false;
    } catch (error) {
      console.error('[MP3Encoder] 終止失敗:', error);
    }
  }
}
