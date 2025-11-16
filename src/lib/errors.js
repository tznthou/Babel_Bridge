/**
 * Babel Bridge 統一錯誤類別
 *
 * 所有模組拋出的錯誤都應使用此類別,並透過 ErrorHandler 統一處理
 */
export class BabelBridgeError extends Error {
  /**
   * @param {string} code - 錯誤碼 (如 'API_KEY_INVALID', 'AUDIO_CAPTURE_FAILED')
   * @param {string} message - 人類可讀的錯誤訊息
   * @param {Object} details - 額外的錯誤細節 (可選)
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BabelBridgeError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();

    // 保留正確的 stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BabelBridgeError);
    }
  }

  /**
   * 轉換為可序列化的物件 (用於 chrome.runtime.sendMessage)
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /**
   * 從 JSON 物件重建錯誤實例
   */
  static fromJSON(json) {
    const error = new BabelBridgeError(json.code, json.message, json.details);
    error.timestamp = json.timestamp;
    error.stack = json.stack;
    return error;
  }
}

/**
 * 錯誤碼定義
 */
export const ErrorCodes = {
  // API 相關
  API_KEY_INVALID: 'API_KEY_INVALID',
  API_KEY_MISSING: 'API_KEY_MISSING',
  API_RATE_LIMIT: 'API_RATE_LIMIT',
  API_NETWORK_ERROR: 'API_NETWORK_ERROR',
  API_RESPONSE_ERROR: 'API_RESPONSE_ERROR',

  // 音訊相關
  AUDIO_CAPTURE_FAILED: 'AUDIO_CAPTURE_FAILED',
  AUDIO_PERMISSION_DENIED: 'AUDIO_PERMISSION_DENIED',
  AUDIO_ENCODING_FAILED: 'AUDIO_ENCODING_FAILED',

  // Whisper 相關
  WHISPER_TRANSCRIPTION_FAILED: 'WHISPER_TRANSCRIPTION_FAILED',
  WHISPER_UNSUPPORTED_FORMAT: 'WHISPER_UNSUPPORTED_FORMAT',

  // 翻譯相關
  TRANSLATION_FAILED: 'TRANSLATION_FAILED',

  // 儲存相關
  STORAGE_READ_ERROR: 'STORAGE_READ_ERROR',
  STORAGE_WRITE_ERROR: 'STORAGE_WRITE_ERROR',

  // 加密相關
  CRYPTO_ERROR: 'CRYPTO_ERROR',
  CRYPTO_KEY_DERIVATION_FAILED: 'CRYPTO_KEY_DERIVATION_FAILED',
  CRYPTO_DECRYPTION_FAILED: 'CRYPTO_DECRYPTION_FAILED',

  // Deepgram 相關
  DEEPGRAM_API_KEY_INVALID: 'DEEPGRAM_API_KEY_INVALID',
  DEEPGRAM_API_KEY_NOT_FOUND: 'DEEPGRAM_API_KEY_NOT_FOUND',
  DEEPGRAM_API_KEY_DECRYPT_FAILED: 'DEEPGRAM_API_KEY_DECRYPT_FAILED',
  DEEPGRAM_API_KEY_PERMISSION_DENIED: 'DEEPGRAM_API_KEY_PERMISSION_DENIED',
  DEEPGRAM_RATE_LIMIT_EXCEEDED: 'DEEPGRAM_RATE_LIMIT_EXCEEDED',
  DEEPGRAM_WEBSOCKET_ERROR: 'DEEPGRAM_WEBSOCKET_ERROR',
  DEEPGRAM_SERVICE_UNAVAILABLE: 'DEEPGRAM_SERVICE_UNAVAILABLE',
  DEEPGRAM_NETWORK_ERROR: 'DEEPGRAM_NETWORK_ERROR',

  // 系統相關
  INIT_FAILED: 'INIT_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};
