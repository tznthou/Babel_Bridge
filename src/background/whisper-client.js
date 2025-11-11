/**
 * WhisperClient - OpenAI Whisper API 整合
 *
 * 負責將 MP3 音訊送至 Whisper API 進行語音辨識
 * 回傳包含時間戳的逐字稿
 */
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';
import { WHISPER_CONFIG } from '../lib/config.js';
import { ErrorHandler } from '../lib/error-handler.js';
import { APIKeyManager } from '../lib/api-key-manager.js';

export class WhisperClient {
  constructor() {
    this.apiKey = null;
  }

  /**
   * 初始化 (載入 API Key)
   */
  async init() {
    try {
      // 使用 APIKeyManager 取得解密後的 API Key
      this.apiKey = await APIKeyManager.getKey();
    } catch (error) {
      // 處理解密失敗的情況
      if (error.code === ErrorCodes.CRYPTO_DECRYPTION_FAILED) {
        throw new BabelBridgeError(
          ErrorCodes.API_KEY_INVALID,
          'API Key 解密失敗，請重新輸入 API Key（可能是更換了瀏覽器或電腦）',
          { originalError: error }
        );
      }
      throw error;
    }

    if (!this.apiKey) {
      throw new BabelBridgeError(
        ErrorCodes.API_KEY_MISSING,
        'OpenAI API Key not configured. Please set it in the extension popup.'
      );
    }

    console.log('[WhisperClient] 已初始化');
  }

  /**
   * 轉錄音訊
   * @param {Blob} audioBlob - MP3 音訊 Blob
   * @param {Object} options - 選項
   * @returns {Promise<Object>} Whisper 辨識結果
   */
  async transcribe(audioBlob, options = {}) {
    if (!this.apiKey) {
      await this.init();
    }

    // 準備 FormData
    const formData = new FormData();
    formData.append('file', audioBlob, this.getFileNameFromOptions(audioBlob, options));
    formData.append('model', WHISPER_CONFIG.MODEL);
    formData.append('response_format', WHISPER_CONFIG.RESPONSE_FORMAT);
    formData.append('temperature', options.temperature || WHISPER_CONFIG.TEMPERATURE);

    if (options.language || WHISPER_CONFIG.LANGUAGE) {
      formData.append('language', options.language || WHISPER_CONFIG.LANGUAGE);
    }

    // 發送請求 (含重試邏輯)
    let lastError;
    for (let attempt = 0; attempt <= WHISPER_CONFIG.MAX_RETRIES; attempt++) {
      try {
        const result = await this.makeRequest(formData);
        ErrorHandler.clearRetryState('whisper_transcribe');
        return this.parseResponse(result);
      } catch (error) {
        lastError = error;

        // 判斷是否需要重試
        if (attempt < WHISPER_CONFIG.MAX_RETRIES) {
          const shouldRetry = await ErrorHandler.handle(error, {
            operation: 'whisper_transcribe',
            maxRetries: WHISPER_CONFIG.MAX_RETRIES,
            retryDelay: WHISPER_CONFIG.RETRY_DELAY,
          });

          if (shouldRetry.retry) {
            console.log(`[WhisperClient] 重試 (${attempt + 1}/${WHISPER_CONFIG.MAX_RETRIES})`);
            continue;
          }
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * 發送 HTTP 請求
   * @private
   */
  async makeRequest(formData) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WHISPER_CONFIG.TIMEOUT);

    try {
      const response = await fetch(WHISPER_CONFIG.API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 檢查 HTTP 狀態碼
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new BabelBridgeError(
          ErrorCodes.WHISPER_TRANSCRIPTION_FAILED,
          `Request timeout (${WHISPER_CONFIG.TIMEOUT}ms)`
        );
      }

      if (error instanceof BabelBridgeError) {
        throw error;
      }

      throw new BabelBridgeError(
        ErrorCodes.API_NETWORK_ERROR,
        `Network error: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 處理 API 錯誤回應
   * @private
   */
  async handleErrorResponse(response) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }

    const errorMessage = errorData.error?.message || errorData.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new BabelBridgeError(
          ErrorCodes.API_KEY_INVALID,
          'Invalid API Key',
          { responseData: errorData }
        );

      case 429:
        throw new BabelBridgeError(
          ErrorCodes.API_RATE_LIMIT,
          'Rate limit exceeded',
          { responseData: errorData }
        );

      case 400:
        throw new BabelBridgeError(
          ErrorCodes.WHISPER_UNSUPPORTED_FORMAT,
          errorMessage,
          { responseData: errorData }
        );

      default:
        throw new BabelBridgeError(
          ErrorCodes.WHISPER_TRANSCRIPTION_FAILED,
          `API error (${response.status}): ${errorMessage}`,
          { status: response.status, responseData: errorData }
        );
    }
  }

  /**
   * 解析 Whisper 回應
   * @private
   */
  parseResponse(response) {
    /**
     * verbose_json 格式範例:
     * {
     *   "task": "transcribe",
     *   "language": "en",
     *   "duration": 3.0,
     *   "text": "Hello world",
     *   "segments": [
     *     {
     *       "id": 0,
     *       "seek": 0,
     *       "start": 0.0,
     *       "end": 1.5,
     *       "text": "Hello",
     *       "tokens": [50364, 2425, ...],
     *       "temperature": 0.0,
     *       "avg_logprob": -0.3,
     *       "compression_ratio": 1.2,
     *       "no_speech_prob": 0.01
     *     },
     *     ...
     *   ]
     * }
     */

    if (!response.segments || !Array.isArray(response.segments)) {
      throw new BabelBridgeError(
        ErrorCodes.WHISPER_TRANSCRIPTION_FAILED,
        'Invalid response format: missing segments',
        { response }
      );
    }

    return {
      text: response.text || '',
      language: response.language,
      duration: response.duration,
      segments: response.segments.map((seg) => ({
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
        confidence: this.calculateConfidence(seg),
      })),
    };
  }

  /**
   * 計算置信度分數 (基於 Whisper 的 logprob 和 no_speech_prob)
   * @private
   */
  calculateConfidence(segment) {
    // avg_logprob 範圍約 -1.0 ~ 0.0 (越接近 0 越好)
    // no_speech_prob 範圍 0.0 ~ 1.0 (越接近 0 越好)

    const logprobScore = Math.max(0, 1 + (segment.avg_logprob || -1));
    const speechScore = 1 - (segment.no_speech_prob || 0);

    return (logprobScore * 0.7 + speechScore * 0.3).toFixed(3);
  }

  /**
   * 依據 MIME 類型或選項推斷檔名
   * @private
   */
  getFileNameFromOptions(audioBlob, options = {}) {
    if (options.fileName) {
      return options.fileName;
    }

    const mimeType = (options.mimeType || audioBlob.type || '').toLowerCase();

    if (mimeType.includes('webm')) {
      return 'audio.webm';
    }
    if (mimeType.includes('ogg')) {
      return 'audio.ogg';
    }
    if (mimeType.includes('wav')) {
      return 'audio.wav';
    }
    if (mimeType.includes('m4a')) {
      return 'audio.m4a';
    }

    return 'audio.mp3';
  }

  /**
   * 更新 API Key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }
}
