/**
 * MP3Encoder - Web Worker 包裝器
 *
 * 提供簡潔的 API 來使用 MP3 編碼 Worker
 */
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';

export class MP3Encoder {
  constructor() {
    this.worker = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.isReady = false;
  }

  /**
   * 初始化 Worker
   */
  async init() {
    if (this.worker) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // 載入 Worker
        this.worker = new Worker(
          chrome.runtime.getURL('src/workers/mp3-encoder.worker.js')
        );

        // 監聽訊息
        this.worker.addEventListener('message', (event) => {
          this.handleMessage(event.data);
        });

        // 監聽錯誤
        this.worker.addEventListener('error', (error) => {
          console.error('[MP3Encoder] Worker error:', error);
          reject(
            new BabelBridgeError(
              ErrorCodes.AUDIO_ENCODING_FAILED,
              `Worker error: ${error.message}`
            )
          );
        });

        // 等待 Worker 就緒
        const readyHandler = (event) => {
          if (event.data.type === 'ready') {
            this.isReady = true;
            console.log('[MP3Encoder] Worker 已就緒');
            resolve();
          }
        };

        this.worker.addEventListener('message', readyHandler, { once: true });

        // 超時處理
        setTimeout(() => {
          if (!this.isReady) {
            reject(
              new BabelBridgeError(
                ErrorCodes.AUDIO_ENCODING_FAILED,
                'Worker initialization timeout'
              )
            );
          }
        }, 5000);
      } catch (error) {
        reject(
          new BabelBridgeError(
            ErrorCodes.AUDIO_ENCODING_FAILED,
            `Failed to initialize worker: ${error.message}`
          )
        );
      }
    });
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

    return new Promise((resolve, reject) => {
      const id = this.requestId++;

      // 儲存請求
      this.pendingRequests.set(id, { resolve, reject });

      // 發送編碼請求
      this.worker.postMessage({
        id,
        type: 'encode',
        data: { samples },
      });

      // 超時處理
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new BabelBridgeError(
              ErrorCodes.AUDIO_ENCODING_FAILED,
              'Encoding timeout (30s)'
            )
          );
        }
      }, 30000);
    });
  }

  /**
   * 處理 Worker 訊息
   * @private
   */
  handleMessage(message) {
    const { id, type, data, error } = message;

    // 處理 ready 訊息
    if (type === 'ready') {
      return;
    }

    // 取得對應的請求
    const request = this.pendingRequests.get(id);
    if (!request) {
      console.warn('[MP3Encoder] 收到未知請求的回應:', id);
      return;
    }

    this.pendingRequests.delete(id);

    // 處理結果
    if (type === 'success') {
      console.log(`[MP3Encoder] 編碼成功 (Request ${id})`, {
        size: data.size,
        duration: data.duration,
      });
      request.resolve(data.blob);
    } else if (type === 'error') {
      console.error(`[MP3Encoder] 編碼失敗 (Request ${id})`, error);
      request.reject(
        new BabelBridgeError(
          ErrorCodes.AUDIO_ENCODING_FAILED,
          error.message,
          { originalError: error }
        )
      );
    }
  }

  /**
   * 終止 Worker
   */
  terminate() {
    if (this.worker) {
      // 拒絕所有待處理的請求
      for (const [id, request] of this.pendingRequests) {
        request.reject(
          new BabelBridgeError(
            ErrorCodes.AUDIO_ENCODING_FAILED,
            'Worker terminated'
          )
        );
      }
      this.pendingRequests.clear();

      this.worker.terminate();
      this.worker = null;
      this.isReady = false;

      console.log('[MP3Encoder] Worker 已終止');
    }
  }

  /**
   * 取得待處理請求數量
   */
  get pendingCount() {
    return this.pendingRequests.size;
  }
}
