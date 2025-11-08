/**
 * AudioCapture - 負責透過 chrome.tabCapture 擷取分頁音訊
 *
 * 核心功能:
 * 1. 使用 chrome.tabCapture.capture() 取得 MediaStream
 * 2. 透過 Web Audio API 處理音訊串流
 * 3. 輸出 AudioBuffer 供後續處理
 */
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';
import { AUDIO_CONFIG } from '../lib/config.js';

export class AudioCapture {
  constructor() {
    this.mediaStream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.isCapturing = false;
  }

  /**
   * 開始擷取指定分頁的音訊
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<MediaStream>}
   */
  async start(tabId) {
    if (this.isCapturing) {
      throw new BabelBridgeError(
        ErrorCodes.AUDIO_CAPTURE_FAILED,
        'Audio capture already in progress'
      );
    }

    try {
      // 1. 請求 tab 音訊權限
      this.mediaStream = await this.captureTabAudio(tabId);

      // 2. 建立 AudioContext
      this.audioContext = new AudioContext({
        sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
      });

      // 3. 建立音訊處理節點
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      this.isCapturing = true;
      console.log(`[AudioCapture] 開始擷取 Tab ${tabId} 音訊`);

      return this.mediaStream;
    } catch (error) {
      this.cleanup();
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
  stop() {
    if (!this.isCapturing) {
      return;
    }

    this.cleanup();
    this.isCapturing = false;
    console.log('[AudioCapture] 已停止音訊擷取');
  }

  /**
   * 取得當前的 AudioContext
   */
  getAudioContext() {
    if (!this.audioContext) {
      throw new BabelBridgeError(
        ErrorCodes.AUDIO_CAPTURE_FAILED,
        'AudioContext not initialized. Call start() first.'
      );
    }
    return this.audioContext;
  }

  /**
   * 取得 source node (用於連接其他音訊處理節點)
   */
  getSourceNode() {
    if (!this.sourceNode) {
      throw new BabelBridgeError(
        ErrorCodes.AUDIO_CAPTURE_FAILED,
        'Source node not available. Call start() first.'
      );
    }
    return this.sourceNode;
  }

  /**
   * 使用 chrome.tabCapture API 擷取分頁音訊
   * @private
   */
  async captureTabAudio(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.capture(
        {
          audio: true,
          video: false,
        },
        (stream) => {
          if (chrome.runtime.lastError) {
            reject(
              new BabelBridgeError(
                ErrorCodes.AUDIO_PERMISSION_DENIED,
                chrome.runtime.lastError.message,
                { tabId }
              )
            );
            return;
          }

          if (!stream) {
            reject(
              new BabelBridgeError(
                ErrorCodes.AUDIO_CAPTURE_FAILED,
                'Failed to get MediaStream',
                { tabId }
              )
            );
            return;
          }

          // 檢查 stream 是否有音軌
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length === 0) {
            reject(
              new BabelBridgeError(
                ErrorCodes.AUDIO_CAPTURE_FAILED,
                'No audio tracks in MediaStream',
                { tabId }
              )
            );
            return;
          }

          resolve(stream);
        }
      );
    });
  }

  /**
   * 清理資源
   * @private
   */
  cleanup() {
    // 停止所有音軌
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // 斷開音訊節點
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // 關閉 AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * 取得擷取狀態
   */
  get capturing() {
    return this.isCapturing;
  }
}
