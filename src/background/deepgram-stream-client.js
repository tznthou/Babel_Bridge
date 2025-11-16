/**
 * Deepgram Streaming Client - 即時語音辨識
 *
 * 使用 WebSocket 連線到 Deepgram API 進行即時語音辨識
 * 延遲目標：2-3 秒（vs OpenAI Whisper 5-7 秒）
 *
 * 流程：
 * 1. 建立 WebSocket 連線（附帶 API Key 和參數）
 * 2. 接收 PCM 音訊串流（16kHz, Mono, linear16）
 * 3. 即時傳送到 Deepgram
 * 4. 接收即時辨識結果（interim + final）
 * 5. 回傳字幕給 SubtitleService
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-11-16
 */

import { DeepgramKeyManager } from '../lib/deepgram-key-manager.js';
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';
import { DEEPGRAM_CONFIG } from '../lib/config.js';

/**
 * WebSocket 連線狀態
 */
const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSING: 'closing',
  ERROR: 'error',
};

/**
 * Deepgram Streaming Client
 */
export class DeepgramStreamClient {
  constructor() {
    this.websocket = null;
    this.connectionState = ConnectionState.DISCONNECTED;
    this.apiKey = null;

    // 重連機制
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;

    // KeepAlive 機制（每 5 秒發送，避免 WebSocket 超時）
    this.keepAliveTimer = null;

    // 統計資訊
    this.stats = {
      audioBytesSent: 0,
      transcriptsReceived: 0,
      interimResults: 0,
      finalResults: 0,
      errors: 0,
      startTime: null,
      endTime: null,
    };

    // 回調函數
    this.onTranscript = null; // (transcript, isFinal) => void
    this.onError = null; // (error) => void
    this.onStateChange = null; // (state) => void

    console.log('[DeepgramStreamClient] 實例已建立');
  }

  /**
   * 初始化並建立 WebSocket 連線
   * @returns {Promise<void>}
   */
  async init() {
    console.log('[DeepgramStreamClient] 🔄 初始化中...');

    try {
      // 取得 API Key
      this.apiKey = await DeepgramKeyManager.getKey();

      if (!this.apiKey) {
        throw new BabelBridgeError(
          ErrorCodes.DEEPGRAM_API_KEY_NOT_FOUND,
          'Deepgram API Key 未設定'
        );
      }

      // 建立 WebSocket 連線
      await this.connect();

      console.log('[DeepgramStreamClient] ✅ 初始化完成');
    } catch (error) {
      console.error('[DeepgramStreamClient] ❌ 初始化失敗:', error);
      this.updateState(ConnectionState.ERROR);
      throw error;
    }
  }

  /**
   * 建立 WebSocket 連線
   * @private
   */
  async connect() {
    if (this.connectionState === ConnectionState.CONNECTED) {
      console.warn('[DeepgramStreamClient] 已連線，跳過重複連線');
      return;
    }

    this.updateState(ConnectionState.CONNECTING);

    try {
      // 建構 WebSocket URL（附帶參數）
      const wsUrl = this.buildWebSocketUrl();

      console.log('[DeepgramStreamClient] 🔗 連線到 Deepgram...', {
        url: DEEPGRAM_CONFIG.WEBSOCKET_URL,
        model: DEEPGRAM_CONFIG.MODEL,
        language: DEEPGRAM_CONFIG.LANGUAGE,
      });

      // 建立 WebSocket
      this.websocket = new WebSocket(wsUrl);

      // 設定事件監聽器
      this.setupWebSocketHandlers();

      // 等待連線成功
      await this.waitForConnection();

      // 啟動 KeepAlive
      this.startKeepAlive();

      // 重置重連計數
      this.reconnectAttempts = 0;

      // 記錄開始時間
      this.stats.startTime = Date.now();

      console.log('[DeepgramStreamClient] ✅ WebSocket 連線成功');
    } catch (error) {
      console.error('[DeepgramStreamClient] ❌ 連線失敗:', error);
      this.updateState(ConnectionState.ERROR);
      throw new BabelBridgeError(
        ErrorCodes.DEEPGRAM_WEBSOCKET_ERROR,
        `WebSocket 連線失敗: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 建構 WebSocket URL（附帶查詢參數）
   * @private
   */
  buildWebSocketUrl() {
    const params = new URLSearchParams({
      model: DEEPGRAM_CONFIG.MODEL,
      language: DEEPGRAM_CONFIG.LANGUAGE,
      encoding: DEEPGRAM_CONFIG.ENCODING,
      sample_rate: DEEPGRAM_CONFIG.SAMPLE_RATE.toString(),
      channels: DEEPGRAM_CONFIG.CHANNELS.toString(),
      interim_results: DEEPGRAM_CONFIG.INTERIM_RESULTS.toString(),
      punctuate: DEEPGRAM_CONFIG.PUNCTUATE.toString(),
      smart_format: DEEPGRAM_CONFIG.SMART_FORMAT.toString(),
      endpointing: DEEPGRAM_CONFIG.ENDPOINTING.toString(),
    });

    return `${DEEPGRAM_CONFIG.WEBSOCKET_URL}?${params.toString()}`;
  }

  /**
   * 設定 WebSocket 事件處理器
   * @private
   */
  setupWebSocketHandlers() {
    this.websocket.onopen = this.handleOpen.bind(this);
    this.websocket.onmessage = this.handleMessage.bind(this);
    this.websocket.onerror = this.handleError.bind(this);
    this.websocket.onclose = this.handleClose.bind(this);
  }

  /**
   * 等待連線成功
   * @private
   */
  waitForConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket 連線超時（10 秒）'));
      }, 10000);

      const checkState = () => {
        if (this.connectionState === ConnectionState.CONNECTED) {
          clearTimeout(timeout);
          resolve();
        } else if (this.connectionState === ConnectionState.ERROR) {
          clearTimeout(timeout);
          reject(new Error('WebSocket 連線失敗'));
        } else {
          setTimeout(checkState, 100);
        }
      };

      checkState();
    });
  }

  /**
   * 處理 WebSocket 開啟事件
   * @private
   */
  handleOpen(event) {
    console.log('[DeepgramStreamClient] 📡 WebSocket 已開啟');
    this.updateState(ConnectionState.CONNECTED);

    // 發送 API Key（Deepgram 要求在連線後發送）
    this.websocket.send(
      JSON.stringify({
        type: 'Authenticate',
        token: this.apiKey,
      })
    );
  }

  /**
   * 處理接收到的訊息（辨識結果）
   * @private
   */
  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);

      console.log('[DeepgramStreamClient] 📨 收到訊息:', data.type);

      switch (data.type) {
        case 'Results':
          this.handleTranscriptResult(data);
          break;

        case 'Metadata':
          console.log('[DeepgramStreamClient] 📊 Metadata:', data);
          break;

        case 'UtteranceEnd':
          console.log('[DeepgramStreamClient] 🔚 句子結束');
          break;

        case 'SpeechStarted':
          console.log('[DeepgramStreamClient] 🎤 偵測到語音');
          break;

        case 'Error':
          console.error('[DeepgramStreamClient] ❌ API 錯誤:', data);
          this.stats.errors++;
          if (this.onError) {
            this.onError(new Error(data.message || 'Deepgram API 錯誤'));
          }
          break;

        default:
          console.log('[DeepgramStreamClient] ❓ 未知訊息類型:', data.type);
      }
    } catch (error) {
      console.error('[DeepgramStreamClient] ❌ 解析訊息失敗:', error);
      this.stats.errors++;
    }
  }

  /**
   * 處理辨識結果
   * @private
   */
  handleTranscriptResult(data) {
    if (!data.channel || !data.channel.alternatives || data.channel.alternatives.length === 0) {
      return;
    }

    const alternative = data.channel.alternatives[0];
    const transcript = alternative.transcript;
    const isFinal = data.is_final;

    if (!transcript) {
      return; // 空字幕，忽略
    }

    // 更新統計
    this.stats.transcriptsReceived++;
    if (isFinal) {
      this.stats.finalResults++;
    } else {
      this.stats.interimResults++;
    }

    console.log(`[DeepgramStreamClient] ${isFinal ? '✅ Final' : '⏳ Interim'}:`, transcript);

    // 回調
    if (this.onTranscript) {
      this.onTranscript({
        text: transcript,
        isFinal,
        confidence: alternative.confidence,
        words: alternative.words || [],
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 處理 WebSocket 錯誤
   * @private
   */
  handleError(event) {
    console.error('[DeepgramStreamClient] ❌ WebSocket 錯誤:', event);
    this.stats.errors++;
    this.updateState(ConnectionState.ERROR);

    if (this.onError) {
      this.onError(new Error('WebSocket 連線錯誤'));
    }
  }

  /**
   * 處理 WebSocket 關閉
   * @private
   */
  handleClose(event) {
    console.log('[DeepgramStreamClient] 🔌 WebSocket 已關閉', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });

    this.updateState(ConnectionState.DISCONNECTED);
    this.stopKeepAlive();

    // 記錄結束時間
    this.stats.endTime = Date.now();

    // 如果不是正常關閉且未超過重連次數，嘗試重連
    if (!event.wasClean && this.reconnectAttempts < DEEPGRAM_CONFIG.RECONNECT_MAX_RETRIES) {
      this.scheduleReconnect();
    }
  }

  /**
   * 發送音訊資料（PCM 格式）
   * @param {ArrayBuffer} audioData - PCM 音訊資料（16kHz, Mono, linear16）
   */
  sendAudio(audioData) {
    if (this.connectionState !== ConnectionState.CONNECTED) {
      console.warn('[DeepgramStreamClient] ⚠️ WebSocket 未連線，無法發送音訊');
      return;
    }

    if (!audioData || audioData.byteLength === 0) {
      console.warn('[DeepgramStreamClient] ⚠️ 音訊資料為空');
      return;
    }

    try {
      this.websocket.send(audioData);
      this.stats.audioBytesSent += audioData.byteLength;

      // 只在首次發送時記錄，避免 Console 污染
      if (this.stats.audioBytesSent === audioData.byteLength) {
        console.log('[DeepgramStreamClient] 🎵 開始發送音訊串流');
      }
    } catch (error) {
      console.error('[DeepgramStreamClient] ❌ 發送音訊失敗:', error);
      this.stats.errors++;
    }
  }

  /**
   * 啟動 KeepAlive 機制
   * @private
   */
  startKeepAlive() {
    this.stopKeepAlive(); // 先清除舊的

    this.keepAliveTimer = setInterval(() => {
      if (this.connectionState === ConnectionState.CONNECTED) {
        try {
          this.websocket.send(JSON.stringify({ type: 'KeepAlive' }));
          console.log('[DeepgramStreamClient] 💓 KeepAlive');
        } catch (error) {
          console.error('[DeepgramStreamClient] ❌ KeepAlive 失敗:', error);
        }
      }
    }, DEEPGRAM_CONFIG.KEEPALIVE_INTERVAL);
  }

  /**
   * 停止 KeepAlive 機制
   * @private
   */
  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * 排程重連
   * @private
   */
  scheduleReconnect() {
    this.reconnectAttempts++;

    const delay = DEEPGRAM_CONFIG.RECONNECT_DELAY * this.reconnectAttempts;

    console.log(
      `[DeepgramStreamClient] 🔄 ${delay}ms 後重連 (${this.reconnectAttempts}/${DEEPGRAM_CONFIG.RECONNECT_MAX_RETRIES})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[DeepgramStreamClient] ❌ 重連失敗:', error);
      });
    }, delay);
  }

  /**
   * 取消重連
   * @private
   */
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 更新連線狀態
   * @private
   */
  updateState(newState) {
    const oldState = this.connectionState;
    this.connectionState = newState;

    console.log(`[DeepgramStreamClient] 狀態變更: ${oldState} → ${newState}`);

    if (this.onStateChange) {
      this.onStateChange(newState, oldState);
    }
  }

  /**
   * 關閉連線並清理資源
   */
  async close() {
    console.log('[DeepgramStreamClient] 🔴 關閉連線...');

    this.updateState(ConnectionState.CLOSING);

    // 取消重連
    this.cancelReconnect();

    // 停止 KeepAlive
    this.stopKeepAlive();

    // 關閉 WebSocket
    if (this.websocket) {
      try {
        this.websocket.close(1000, 'Client closed connection');
        this.websocket = null;
      } catch (error) {
        console.error('[DeepgramStreamClient] ❌ 關閉 WebSocket 失敗:', error);
      }
    }

    this.updateState(ConnectionState.DISCONNECTED);

    // 輸出統計資訊
    this.printStats();

    console.log('[DeepgramStreamClient] ✅ 已關閉');
  }

  /**
   * 輸出統計資訊
   * @private
   */
  printStats() {
    const duration = this.stats.endTime
      ? (this.stats.endTime - this.stats.startTime) / 1000
      : 0;

    console.log('[DeepgramStreamClient] 📊 統計資訊:', {
      duration: `${duration.toFixed(2)}s`,
      audioBytesSent: `${(this.stats.audioBytesSent / 1024).toFixed(2)} KB`,
      transcriptsReceived: this.stats.transcriptsReceived,
      interimResults: this.stats.interimResults,
      finalResults: this.stats.finalResults,
      errors: this.stats.errors,
    });
  }

  /**
   * 取得當前連線狀態
   */
  getState() {
    return this.connectionState;
  }

  /**
   * 取得統計資訊
   */
  getStats() {
    return { ...this.stats };
  }
}
