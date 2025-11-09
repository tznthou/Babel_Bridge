/**
 * Crypto Utils - Web Crypto API 加密工具
 *
 * 功能:
 * 1. AES-GCM 加密/解密
 * 2. 基於瀏覽器指紋生成加密金鑰
 * 3. 安全的金鑰衍生 (PBKDF2)
 */

import { BabelBridgeError, ErrorCodes } from './errors.js';

export class CryptoUtils {
  /**
   * 加密演算法配置
   */
  static ALGORITHM = 'AES-GCM';
  static KEY_LENGTH = 256;
  static IV_LENGTH = 12; // GCM 模式建議使用 12 bytes
  static SALT_LENGTH = 16;
  static PBKDF2_ITERATIONS = 100000; // OWASP 建議值

  /**
   * 生成瀏覽器指紋（用於金鑰衍生）
   * @returns {Promise<string>} 瀏覽器指紋字串
   * @private
   */
  static async generateBrowserFingerprint() {
    // 為了確保 Popup 和 Service Worker 環境的指紋一致，
    // 統一使用固定值取代 screen 屬性
    // TODO: 未來可以考慮使用 chrome.storage.local 儲存裝置 ID

    // 偵測當前環境（用於 debug）
    const isServiceWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
    const context = isServiceWorker ? 'ServiceWorker' :
                    (typeof window !== 'undefined' ? 'Window' : 'Unknown');

    // 收集瀏覽器特徵（跨環境一致）
    const features = [
      navigator.userAgent,
      navigator.language,
      // 使用固定值確保跨環境一致性
      'stable-env', // 取代 screen.width
      'stable-env', // 取代 screen.height
      'stable-env', // 取代 screen.colorDepth
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform,
    ];

    // 轉換為字串
    const fingerprintString = features.join('|');

    // 🔍 DEBUG: 記錄完整指紋資訊
    console.log(`[CryptoUtils][${context}] 瀏覽器指紋診斷:`);
    console.log(`  環境: ${context}`);
    console.log(`  userAgent: ${navigator.userAgent}`);
    console.log(`  language: ${navigator.language}`);
    console.log(`  timezoneOffset: ${new Date().getTimezoneOffset()}`);
    console.log(`  hardwareConcurrency: ${navigator.hardwareConcurrency || 'unknown'}`);
    console.log(`  platform: ${navigator.platform}`);
    console.log(`  完整指紋字串: ${fingerprintString}`);

    // 使用 SHA-256 產生 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(fingerprintString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // 轉換為 hex 字串
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    console.log(`  SHA-256 Hash: ${hash}`);

    return hash;
  }

  /**
   * 衍生加密金鑰
   * @param {string} [password] - 可選的額外密碼（使用者自訂）
   * @param {Uint8Array} [salt] - 可選的 salt（解密時使用已存的 salt）
   * @returns {Promise<{key: CryptoKey, salt: Uint8Array}>}
   * @private
   */
  static async deriveKey(password = '', salt = null) {
    try {
      // 1. 生成瀏覽器指紋
      const fingerprint = await this.generateBrowserFingerprint();

      // 2. 組合密碼材料（指紋 + 可選密碼）
      const keyMaterial = fingerprint + password;

      // 3. 生成或使用現有 salt
      const keySalt = salt || crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));

      // 4. 導入金鑰材料
      const encoder = new TextEncoder();
      const importedKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(keyMaterial),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );

      // 5. 使用 PBKDF2 衍生金鑰
      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: keySalt,
          iterations: this.PBKDF2_ITERATIONS,
          hash: 'SHA-256',
        },
        importedKey,
        {
          name: this.ALGORITHM,
          length: this.KEY_LENGTH,
        },
        false, // 不可匯出（安全性考量）
        ['encrypt', 'decrypt']
      );

      return {
        key: derivedKey,
        salt: keySalt,
      };
    } catch (error) {
      throw new BabelBridgeError(
        ErrorCodes.CRYPTO_ERROR,
        `金鑰衍生失敗: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 加密資料
   * @param {string} plaintext - 明文資料
   * @param {string} [password] - 可選的額外密碼
   * @returns {Promise<string>} Base64 編碼的加密資料（包含 IV 和 salt）
   */
  static async encrypt(plaintext, password = '') {
    try {
      console.log('[CryptoUtils] 🔐 開始加密流程');

      // 1. 衍生加密金鑰
      const { key, salt } = await this.deriveKey(password);

      // 🔍 DEBUG: 記錄 salt
      const saltHex = Array.from(salt.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      console.log(`  生成的 salt (前8 bytes): ${saltHex}...`);

      // 2. 生成隨機 IV (Initialization Vector)
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));

      // 3. 加密資料
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(plaintext);

      const encryptedData = await crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv: iv,
        },
        key,
        encodedData
      );

      // 4. 組合 salt + IV + 加密資料
      const encryptedArray = new Uint8Array(encryptedData);
      const combined = new Uint8Array(salt.length + iv.length + encryptedArray.length);

      combined.set(salt, 0);
      combined.set(iv, salt.length);
      combined.set(encryptedArray, salt.length + iv.length);

      // 5. 轉換為 Base64
      const result = this.arrayBufferToBase64(combined);

      console.log(`  加密完成，總長度: ${result.length} chars`);

      return result;
    } catch (error) {
      console.error('[CryptoUtils] 加密失敗:', error);
      throw new BabelBridgeError(
        ErrorCodes.CRYPTO_ERROR,
        `資料加密失敗: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 解密資料
   * @param {string} encryptedBase64 - Base64 編碼的加密資料
   * @param {string} [password] - 可選的額外密碼（必須與加密時相同）
   * @returns {Promise<string>} 解密後的明文
   */
  static async decrypt(encryptedBase64, password = '') {
    try {
      console.log('[CryptoUtils] 🔓 開始解密流程');

      // 1. Base64 解碼
      const combined = this.base64ToArrayBuffer(encryptedBase64);

      // 2. 分離 salt、IV 和加密資料
      const salt = combined.slice(0, this.SALT_LENGTH);
      const iv = combined.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
      const encryptedData = combined.slice(this.SALT_LENGTH + this.IV_LENGTH);

      // 🔍 DEBUG: 記錄讀取到的 salt
      const saltHex = Array.from(salt.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      console.log(`  讀取到的 salt (前8 bytes): ${saltHex}...`);
      console.log(`  加密資料長度: ${encryptedBase64.length} chars`);

      // 3. 使用相同的 salt 衍生金鑰
      const { key } = await this.deriveKey(password, salt);

      // 4. 解密資料
      const decryptedData = await crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: iv,
        },
        key,
        encryptedData
      );

      // 5. 轉換為字串
      const decoder = new TextDecoder();
      const result = decoder.decode(decryptedData);

      console.log('  ✅ 解密成功');

      return result;
    } catch (error) {
      console.error('[CryptoUtils] ❌ 解密失敗:', error);

      // 解密失敗通常是因為金鑰不正確
      if (error.name === 'OperationError') {
        throw new BabelBridgeError(
          ErrorCodes.CRYPTO_ERROR,
          '解密失敗：金鑰不正確或資料已損壞',
          { originalError: error }
        );
      }

      throw new BabelBridgeError(
        ErrorCodes.CRYPTO_ERROR,
        `資料解密失敗: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * ArrayBuffer 轉 Base64
   * @param {Uint8Array} buffer
   * @returns {string}
   * @private
   */
  static arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;

    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  }

  /**
   * Base64 轉 Uint8Array
   * @param {string} base64
   * @returns {Uint8Array}
   * @private
   */
  static base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  /**
   * 驗證加密/解密功能是否正常
   * @returns {Promise<boolean>}
   */
  static async testEncryption() {
    try {
      const testData = 'test-data-' + Date.now();
      const encrypted = await this.encrypt(testData);
      const decrypted = await this.decrypt(encrypted);

      return decrypted === testData;
    } catch (error) {
      console.error('[CryptoUtils] 加密測試失敗:', error);
      return false;
    }
  }
}
