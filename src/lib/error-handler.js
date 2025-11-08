/**
 * 錯誤處理器 - 統一處理所有錯誤,包含重試邏輯與使用者通知
 */
import { BabelBridgeError, ErrorCodes } from './errors.js';

export class ErrorHandler {
  static retryState = new Map();

  /**
   * 處理錯誤的主要入口
   * @param {Error|BabelBridgeError} error
   * @param {Object} context - 錯誤發生的上下文
   */
  static async handle(error, context = {}) {
    // 轉換為 BabelBridgeError
    const babelError = this.normalizError(error);

    // 記錄錯誤
    this.logError(babelError, context);

    // 判斷是否可重試
    if (this.isRetryable(babelError)) {
      const shouldRetry = await this.handleRetry(babelError, context);
      if (shouldRetry) {
        return { retry: true };
      }
    }

    // 通知使用者
    await this.notifyUser(babelError, context);

    return { retry: false, error: babelError };
  }

  /**
   * 將一般 Error 轉換為 BabelBridgeError
   */
  static normalizeError(error) {
    if (error instanceof BabelBridgeError) {
      return error;
    }

    // 根據錯誤訊息推斷錯誤碼
    let code = ErrorCodes.UNKNOWN_ERROR;
    if (error.message?.includes('API key')) {
      code = ErrorCodes.API_KEY_INVALID;
    } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
      code = ErrorCodes.API_NETWORK_ERROR;
    } else if (error.message?.includes('permission')) {
      code = ErrorCodes.AUDIO_PERMISSION_DENIED;
    }

    return new BabelBridgeError(code, error.message, { originalError: error.stack });
  }

  /**
   * 記錄錯誤 (開發模式會輸出到 console)
   */
  static logError(error, context) {
    const logData = {
      code: error.code,
      message: error.message,
      timestamp: new Date(error.timestamp).toISOString(),
      context,
      details: error.details,
    };

    console.error('[BabelBridge Error]', logData);

    // TODO: 生產環境可串接錯誤追蹤服務 (如 Sentry)
  }

  /**
   * 判斷錯誤是否可重試
   */
  static isRetryable(error) {
    const retryableCodes = [
      ErrorCodes.API_NETWORK_ERROR,
      ErrorCodes.API_RATE_LIMIT,
      ErrorCodes.AUDIO_ENCODING_FAILED,
      ErrorCodes.WHISPER_TRANSCRIPTION_FAILED,
    ];

    return retryableCodes.includes(error.code);
  }

  /**
   * 處理重試邏輯
   */
  static async handleRetry(error, context) {
    const key = `${error.code}_${context.operation || 'unknown'}`;
    const state = this.retryState.get(key) || { count: 0, lastRetry: 0 };

    const maxRetries = context.maxRetries || 3;
    const retryDelay = context.retryDelay || 1000;

    if (state.count >= maxRetries) {
      console.warn(`[Retry] 已達最大重試次數 (${maxRetries})`, error.code);
      this.retryState.delete(key);
      return false;
    }

    // 指數退避
    const delay = retryDelay * Math.pow(2, state.count);
    state.count++;
    state.lastRetry = Date.now();
    this.retryState.set(key, state);

    console.warn(`[Retry] 將在 ${delay}ms 後重試 (${state.count}/${maxRetries})`, error.code);
    await new Promise((resolve) => setTimeout(resolve, delay));

    return true;
  }

  /**
   * 清除重試狀態 (成功後調用)
   */
  static clearRetryState(operation) {
    for (const [key] of this.retryState) {
      if (key.includes(operation)) {
        this.retryState.delete(key);
      }
    }
  }

  /**
   * 通知使用者錯誤
   */
  static async notifyUser(error, context) {
    const userMessage = this.getUserMessage(error);

    // 透過 chrome.notifications 顯示通知 (需在 manifest 加入 notifications 權限)
    // 目前先用 console 代替
    console.error('[User Notice]', userMessage);

    // TODO: 實作 notification UI
    // chrome.notifications.create({
    //   type: 'basic',
    //   iconUrl: 'icons/icon48.png',
    //   title: 'Babel Bridge Error',
    //   message: userMessage,
    // });
  }

  /**
   * 取得使用者友善的錯誤訊息
   */
  static getUserMessage(error) {
    const messages = {
      [ErrorCodes.API_KEY_INVALID]: '無效的 OpenAI API Key,請檢查設定',
      [ErrorCodes.API_KEY_MISSING]: '尚未設定 OpenAI API Key',
      [ErrorCodes.API_RATE_LIMIT]: 'API 請求頻率過高,請稍後再試',
      [ErrorCodes.API_NETWORK_ERROR]: '網路連線錯誤,請檢查網路狀態',
      [ErrorCodes.AUDIO_CAPTURE_FAILED]: '音訊擷取失敗',
      [ErrorCodes.AUDIO_PERMISSION_DENIED]: '需要音訊權限才能使用',
      [ErrorCodes.WHISPER_TRANSCRIPTION_FAILED]: '語音辨識失敗',
      [ErrorCodes.TRANSLATION_FAILED]: '翻譯失敗',
      [ErrorCodes.STORAGE_READ_ERROR]: '讀取設定失敗',
      [ErrorCodes.STORAGE_WRITE_ERROR]: '儲存設定失敗',
    };

    return messages[error.code] || `發生錯誤: ${error.message}`;
  }
}
