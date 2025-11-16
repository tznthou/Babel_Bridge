/**
 * Deepgram API Key 管理器
 *
 * 獨立於 APIKeyManager，避免破壞現有 OpenAI 邏輯
 * 使用既有的 CryptoUtils 提供加密功能
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-11-16
 */

import { CryptoUtils } from './crypto-utils.js';
import { BabelBridgeError, ErrorCodes } from './errors.js';
import { STORAGE_KEYS, DEEPGRAM_CONFIG } from './config.js';

/**
 * Deepgram API Key 管理器
 */
export class DeepgramKeyManager {
  /**
   * 驗證 API Key 格式
   *
   * Deepgram API Key 無統一前綴（不像 OpenAI 的 sk-）
   * 只做基本格式檢查
   *
   * @param {string} apiKey - API Key
   * @returns {string} 驗證並清理後的 API Key
   * @throws {BabelBridgeError} 格式無效時拋出
   */
  static validateFormat(apiKey) {
    const trimmedKey = apiKey?.trim();

    if (!trimmedKey) {
      throw new BabelBridgeError(
        ErrorCodes.DEEPGRAM_API_KEY_INVALID,
        'Deepgram API Key 不能為空'
      );
    }

    // Deepgram Key 長度通常 >= 32 字元
    if (trimmedKey.length < 32) {
      throw new BabelBridgeError(
        ErrorCodes.DEEPGRAM_API_KEY_INVALID,
        'Deepgram API Key 長度必須 >= 32 字元'
      );
    }

    // 只允許字母、數字、底線、連字號
    const pattern = /^[A-Za-z0-9_-]+$/;
    if (!pattern.test(trimmedKey)) {
      throw new BabelBridgeError(
        ErrorCodes.DEEPGRAM_API_KEY_INVALID,
        'Deepgram API Key 格式無效（只允許字母、數字、-、_）'
      );
    }

    return trimmedKey;
  }

  /**
   * 驗證 API Key 有效性
   *
   * 呼叫 Deepgram /v1/auth/token 端點測試 Key
   *
   * @param {string} apiKey - API Key
   * @returns {Promise<Object>} 驗證結果
   * @throws {BabelBridgeError} 驗證失敗時拋出
   */
  static async verifyKey(apiKey) {
    const validatedKey = this.validateFormat(apiKey);

    try {
      const response = await fetch(DEEPGRAM_CONFIG.AUTH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Token ${validatedKey}`,
          'Content-Type': 'application/json',
        },
      });

      // 401: Invalid credentials
      if (response.status === 401) {
        throw new BabelBridgeError(
          ErrorCodes.DEEPGRAM_API_KEY_INVALID,
          'Deepgram API Key 無效或已過期'
        );
      }

      // 403: 權限不足
      if (response.status === 403) {
        throw new BabelBridgeError(
          ErrorCodes.DEEPGRAM_API_KEY_PERMISSION_DENIED,
          'API Key 權限不足，請檢查 scopes 設定'
        );
      }

      // 429: Rate limit
      if (response.status === 429) {
        throw new BabelBridgeError(
          ErrorCodes.DEEPGRAM_RATE_LIMIT_EXCEEDED,
          'Deepgram API 請求過於頻繁，請稍後再試'
        );
      }

      // 500+: Server error
      if (response.status >= 500) {
        throw new BabelBridgeError(
          ErrorCodes.DEEPGRAM_SERVICE_UNAVAILABLE,
          'Deepgram 服務暫時無法使用，請稍後再試'
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new BabelBridgeError(
          ErrorCodes.UNKNOWN_ERROR,
          `Deepgram API 驗證失敗: ${errorData.message || response.statusText}`
        );
      }

      const data = await response.json();

      console.log('[DeepgramKeyManager] ✓ API Key 驗證成功', {
        projectUuid: data.project_uuid,
        scopes: data.scopes,
        expires: data.expires,
      });

      return {
        valid: true,
        token: data.token,
        projectUuid: data.project_uuid,
        scopes: data.scopes || [],
        created: data.created,
        expires: data.expires,
      };
    } catch (error) {
      if (error instanceof BabelBridgeError) {
        throw error;
      }

      console.error('[DeepgramKeyManager] ✗ 驗證錯誤', error);

      throw new BabelBridgeError(
        ErrorCodes.DEEPGRAM_NETWORK_ERROR,
        `網路錯誤: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 驗證並儲存 API Key
   *
   * 流程：
   * 1. 驗證有效性（呼叫 Deepgram API）
   * 2. 加密 API Key（使用 CryptoUtils）
   * 3. 儲存到 Chrome Storage
   *
   * @param {string} apiKey - API Key
   * @returns {Promise<Object>} 儲存結果
   * @throws {BabelBridgeError} 驗證或儲存失敗時拋出
   */
  static async verifyAndSave(apiKey) {
    // 1. 驗證有效性
    const verificationResult = await this.verifyKey(apiKey);

    // 2. 加密 API Key
    const encryptedKey = await CryptoUtils.encrypt(apiKey);

    // 3. 儲存到 Chrome Storage
    await chrome.storage.local.set({
      [STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED]: encryptedKey,
      [STORAGE_KEYS.DEEPGRAM_API_KEY_VERIFIED_AT]: Date.now(),
      [STORAGE_KEYS.DEEPGRAM_API_KEY_SCOPES]: verificationResult.scopes,
      [STORAGE_KEYS.DEEPGRAM_PROJECT_UUID]: verificationResult.projectUuid,
    });

    console.log('[DeepgramKeyManager] ✓ API Key 已加密儲存', {
      projectUuid: verificationResult.projectUuid,
      scopes: verificationResult.scopes,
    });

    return {
      success: true,
      scopes: verificationResult.scopes,
      projectUuid: verificationResult.projectUuid,
    };
  }

  /**
   * 取得解密後的 API Key
   *
   * @returns {Promise<string>} API Key
   * @throws {BabelBridgeError} 未設定或解密失敗時拋出
   */
  static async getKey() {
    const result = await chrome.storage.local.get(
      STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED
    );

    const encryptedKey = result[STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED];

    if (!encryptedKey) {
      throw new BabelBridgeError(
        ErrorCodes.DEEPGRAM_API_KEY_NOT_FOUND,
        'Deepgram API Key 未設定，請先在設定頁面輸入'
      );
    }

    try {
      return await CryptoUtils.decrypt(encryptedKey);
    } catch (error) {
      console.error('[DeepgramKeyManager] ✗ 解密失敗', error);

      throw new BabelBridgeError(
        ErrorCodes.DEEPGRAM_API_KEY_DECRYPT_FAILED,
        'Deepgram API Key 解密失敗（可能瀏覽器指紋已變更），請重新設定',
        { originalError: error }
      );
    }
  }

  /**
   * 檢查 API Key 是否已設定
   *
   * @returns {Promise<boolean>} 是否已設定
   */
  static async hasKey() {
    const result = await chrome.storage.local.get(
      STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED
    );
    return !!result[STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED];
  }

  /**
   * 刪除 API Key
   *
   * 移除所有 Deepgram 相關儲存資料
   *
   * @returns {Promise<void>}
   */
  static async removeKey() {
    await chrome.storage.local.remove([
      STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED,
      STORAGE_KEYS.DEEPGRAM_API_KEY_VERIFIED_AT,
      STORAGE_KEYS.DEEPGRAM_API_KEY_SCOPES,
      STORAGE_KEYS.DEEPGRAM_PROJECT_UUID,
    ]);

    console.log('[DeepgramKeyManager] ✓ API Key 已移除');
  }

  /**
   * 取得 API Key 資訊（不包含實際 Key）
   *
   * @returns {Promise<Object>} Key 資訊
   */
  static async getKeyInfo() {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED,
      STORAGE_KEYS.DEEPGRAM_API_KEY_VERIFIED_AT,
      STORAGE_KEYS.DEEPGRAM_API_KEY_SCOPES,
      STORAGE_KEYS.DEEPGRAM_PROJECT_UUID,
    ]);

    return {
      hasKey: !!result[STORAGE_KEYS.DEEPGRAM_API_KEY_ENCRYPTED],
      verifiedAt: result[STORAGE_KEYS.DEEPGRAM_API_KEY_VERIFIED_AT],
      scopes: result[STORAGE_KEYS.DEEPGRAM_API_KEY_SCOPES] || [],
      projectUuid: result[STORAGE_KEYS.DEEPGRAM_PROJECT_UUID],
    };
  }

  /**
   * 格式化 API Key 顯示（遮罩處理）
   *
   * 顯示前 8 字元和後 4 字元，中間用 * 遮罩
   * 例如：abcdefgh************xyz1
   *
   * @param {string} apiKey - API Key
   * @returns {string} 遮罩後的 Key
   */
  static maskKey(apiKey) {
    if (!apiKey || apiKey.length < 12) {
      return '***';
    }

    const start = apiKey.substring(0, 8);
    const end = apiKey.substring(apiKey.length - 4);
    const middle = '*'.repeat(Math.max(apiKey.length - 12, 0));

    return `${start}${middle}${end}`;
  }
}
