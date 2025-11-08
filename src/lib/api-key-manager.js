/**
 * APIKeyManager - API Key 管理與成本追蹤
 *
 * 功能:
 * 1. API Key 格式驗證與測試
 * 2. 成本追蹤 (Whisper + GPT)
 * 3. 預算警告
 * 4. 加密儲存 (AES-GCM)
 */
import { BabelBridgeError, ErrorCodes } from './errors.js';
import { STORAGE_KEYS, COST_CONFIG } from './config.js';
import { CryptoUtils } from './crypto-utils.js';

export class APIKeyManager {
  /**
   * API Key 格式正則
   *
   * 支援的 OpenAI API Key 格式:
   * - Standard: sk-[字串] (舊格式，48 字元)
   * - Project: sk-proj-[字串] (新格式，專案密鑰)
   * - Admin: sk-admin-[字串] (管理員密鑰)
   * - Organization: sk-org-[字串] (組織密鑰)
   *
   * 格式要求:
   * - 必須以 'sk-' 開頭
   * - 可選前綴: proj-, admin-, org- 等
   * - 後續字元支援: 字母、數字、底線、連字號
   * - 最小長度: 20 字元（不含 sk- 前綴）
   */
  static API_KEY_PATTERN = /^sk-(?:proj-|admin-|org-)?[A-Za-z0-9_-]{20,}$/;

  /**
   * 驗證 API Key 格式
   * @param {string} apiKey - 要驗證的 API Key
   * @returns {string} 驗證通過的 API Key (已 trim)
   * @throws {BabelBridgeError} 格式不正確時拋出錯誤
   */
  static validateFormat(apiKey) {
    // 檢查是否為空值
    if (!apiKey || typeof apiKey !== 'string') {
      throw new BabelBridgeError(
        ErrorCodes.API_KEY_INVALID,
        'API Key 不能為空，請輸入有效的 OpenAI API Key'
      );
    }

    const trimmedKey = apiKey.trim();

    // 檢查是否以 sk- 開頭
    if (!trimmedKey.startsWith('sk-')) {
      throw new BabelBridgeError(
        ErrorCodes.API_KEY_INVALID,
        'API Key 格式錯誤：必須以 "sk-" 開頭'
      );
    }

    // 檢查長度
    if (trimmedKey.length < 30) {
      throw new BabelBridgeError(
        ErrorCodes.API_KEY_INVALID,
        `API Key 格式錯誤：長度過短（當前 ${trimmedKey.length} 字元，至少需要 30 字元）`
      );
    }

    // 完整格式驗證
    if (!this.API_KEY_PATTERN.test(trimmedKey)) {
      throw new BabelBridgeError(
        ErrorCodes.API_KEY_INVALID,
        'API Key 格式錯誤：包含不允許的字元或格式不正確'
      );
    }

    return trimmedKey;
  }

  /**
   * 驗證 API Key 有效性 (呼叫 OpenAI API 測試)
   * @param {string} apiKey - 要驗證的 API Key
   * @returns {Promise<{valid: boolean, keyType: string}>} 驗證結果與密鑰類型
   * @throws {BabelBridgeError} 驗證失敗時拋出錯誤
   */
  static async verifyKey(apiKey) {
    const validatedKey = this.validateFormat(apiKey);

    // 檢測 API Key 類型
    const keyType = this.detectKeyType(validatedKey);

    try {
      console.log(`[APIKeyManager] 開始驗證 ${keyType} API Key...`);

      // 呼叫 OpenAI API 測試端點
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validatedKey}`,
          'Content-Type': 'application/json',
        },
      });

      // 處理各種錯誤情況
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        switch (response.status) {
          case 401:
            throw new BabelBridgeError(
              ErrorCodes.API_KEY_INVALID,
              'API Key 無效：OpenAI 認證失敗，請檢查密鑰是否正確',
              { status: 401, error: errorData }
            );

          case 403:
            throw new BabelBridgeError(
              ErrorCodes.API_KEY_INVALID,
              'API Key 權限不足：此密鑰無法訪問所需的 API',
              { status: 403, error: errorData }
            );

          case 429:
            throw new BabelBridgeError(
              ErrorCodes.API_RESPONSE_ERROR,
              'API 請求頻率超限，請稍後再試',
              { status: 429, error: errorData }
            );

          case 500:
          case 502:
          case 503:
            throw new BabelBridgeError(
              ErrorCodes.API_RESPONSE_ERROR,
              'OpenAI 服務暫時不可用，請稍後再試',
              { status: response.status, error: errorData }
            );

          default:
            throw new BabelBridgeError(
              ErrorCodes.API_RESPONSE_ERROR,
              `API 驗證失敗 (${response.status}): ${response.statusText}`,
              { status: response.status, error: errorData }
            );
        }
      }

      // 驗證成功
      const data = await response.json();
      console.log(
        `[APIKeyManager] ✓ ${keyType} API Key 驗證成功 (可用模型數: ${data.data?.length || 0})`
      );

      return {
        valid: true,
        keyType,
        modelsCount: data.data?.length || 0,
      };
    } catch (error) {
      // 已經是 BabelBridgeError 則直接拋出
      if (error instanceof BabelBridgeError) {
        throw error;
      }

      // 網路錯誤
      throw new BabelBridgeError(
        ErrorCodes.API_NETWORK_ERROR,
        `網路錯誤：無法連接到 OpenAI API (${error.message})`,
        { originalError: error.message }
      );
    }
  }

  /**
   * 檢測 API Key 類型
   * @param {string} apiKey - API Key
   * @returns {string} 密鑰類型
   * @private
   */
  static detectKeyType(apiKey) {
    if (apiKey.startsWith('sk-proj-')) return 'Project Key';
    if (apiKey.startsWith('sk-admin-')) return 'Admin Key';
    if (apiKey.startsWith('sk-org-')) return 'Organization Key';
    return 'Standard Key';
  }

  /**
   * 驗證並儲存 API Key（加密儲存）
   * @param {string} apiKey - 要驗證並儲存的 API Key
   * @returns {Promise<{success: boolean, keyType: string, modelsCount: number}>}
   * @throws {BabelBridgeError} 驗證失敗時拋出錯誤
   */
  static async verifyAndSave(apiKey) {
    const validatedKey = this.validateFormat(apiKey);
    const verifyResult = await this.verifyKey(validatedKey);

    try {
      // 使用 AES-GCM 加密 API Key
      const encryptedKey = await CryptoUtils.encrypt(validatedKey);

      // 儲存加密後的資料到 chrome.storage
      await chrome.storage.local.set({
        [STORAGE_KEYS.API_KEY_ENCRYPTED]: encryptedKey,
        [STORAGE_KEYS.API_KEY_TYPE]: verifyResult.keyType,
        [STORAGE_KEYS.API_KEY_VERIFIED_AT]: Date.now(),
      });

      console.log(`[APIKeyManager] ${verifyResult.keyType} 已加密並儲存`);

      return {
        success: true,
        keyType: verifyResult.keyType,
        modelsCount: verifyResult.modelsCount,
      };
    } catch (error) {
      throw new BabelBridgeError(
        ErrorCodes.CRYPTO_ERROR,
        `API Key 加密儲存失敗: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 取得已儲存的 API Key（自動解密）
   * @returns {Promise<string|null>} 解密後的 API Key，若無則返回 null
   */
  static async getKey() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.API_KEY_ENCRYPTED);
      const encryptedKey = result[STORAGE_KEYS.API_KEY_ENCRYPTED];

      if (!encryptedKey) {
        console.log('[APIKeyManager] 未找到已儲存的 API Key');
        return null;
      }

      // 解密 API Key
      const decryptedKey = await CryptoUtils.decrypt(encryptedKey);
      console.log('[APIKeyManager] API Key 解密成功');

      return decryptedKey;
    } catch (error) {
      console.error('[APIKeyManager] API Key 解密失敗:', error);

      throw new BabelBridgeError(
        ErrorCodes.CRYPTO_DECRYPTION_FAILED,
        `API Key 解密失敗: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 刪除 API Key（包含加密資料和相關metadata）
   */
  static async removeKey() {
    await chrome.storage.local.remove([
      STORAGE_KEYS.API_KEY_ENCRYPTED,
      STORAGE_KEYS.API_KEY_TYPE,
      STORAGE_KEYS.API_KEY_VERIFIED_AT,
    ]);
    console.log('[APIKeyManager] API Key 及相關資料已移除');
  }

  /**
   * 記錄 Whisper 使用量
   * @param {number} durationSeconds - 音訊長度 (秒)
   */
  static async trackWhisperUsage(durationSeconds) {
    const minutes = durationSeconds / 60;
    const cost = minutes * COST_CONFIG.WHISPER_PER_MINUTE;

    await this.addCost('whisper', {
      duration: durationSeconds,
      cost,
    });

    console.log(`[APIKeyManager] Whisper 使用: ${minutes.toFixed(2)} min, $${cost.toFixed(4)}`);
  }

  /**
   * 記錄 GPT 使用量
   * @param {number} inputTokens - 輸入 tokens
   * @param {number} outputTokens - 輸出 tokens
   */
  static async trackGPTUsage(inputTokens, outputTokens) {
    const inputCost = (inputTokens / 1_000_000) * COST_CONFIG.GPT_INPUT_PER_1M_TOKENS;
    const outputCost = (outputTokens / 1_000_000) * COST_CONFIG.GPT_OUTPUT_PER_1M_TOKENS;
    const totalCost = inputCost + outputCost;

    await this.addCost('gpt', {
      inputTokens,
      outputTokens,
      cost: totalCost,
    });

    console.log(
      `[APIKeyManager] GPT 使用: ${inputTokens} in + ${outputTokens} out, $${totalCost.toFixed(4)}`
    );
  }

  /**
   * 新增成本記錄
   * @private
   */
  static async addCost(type, data) {
    const tracking = await this.getCostTracking();
    const currentMonth = this.getCurrentMonth();

    if (!tracking[currentMonth]) {
      tracking[currentMonth] = {
        whisper: { duration: 0, cost: 0, calls: 0 },
        gpt: { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 },
        total: 0,
      };
    }

    const monthData = tracking[currentMonth];

    if (type === 'whisper') {
      monthData.whisper.duration += data.duration;
      monthData.whisper.cost += data.cost;
      monthData.whisper.calls++;
    } else if (type === 'gpt') {
      monthData.gpt.inputTokens += data.inputTokens;
      monthData.gpt.outputTokens += data.outputTokens;
      monthData.gpt.cost += data.cost;
      monthData.gpt.calls++;
    }

    monthData.total = monthData.whisper.cost + monthData.gpt.cost;

    await chrome.storage.local.set({
      [STORAGE_KEYS.COST_TRACKING]: tracking,
    });

    // 檢查預算警告
    await this.checkBudgetWarning(monthData.total);
  }

  /**
   * 取得成本追蹤資料
   */
  static async getCostTracking() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.COST_TRACKING);
    return result[STORAGE_KEYS.COST_TRACKING] || {};
  }

  /**
   * 取得當月成本統計
   */
  static async getCurrentMonthStats() {
    const tracking = await this.getCostTracking();
    const currentMonth = this.getCurrentMonth();

    return (
      tracking[currentMonth] || {
        whisper: { duration: 0, cost: 0, calls: 0 },
        gpt: { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 },
        total: 0,
      }
    );
  }

  /**
   * 重設當月統計
   */
  static async resetCurrentMonth() {
    const tracking = await this.getCostTracking();
    const currentMonth = this.getCurrentMonth();
    delete tracking[currentMonth];

    await chrome.storage.local.set({
      [STORAGE_KEYS.COST_TRACKING]: tracking,
    });

    console.log('[APIKeyManager] 當月統計已重設');
  }

  /**
   * 檢查預算警告
   * @private
   */
  static async checkBudgetWarning(currentCost) {
    const settings = await this.getUserSettings();
    const budget = settings.monthlyBudget || 10; // 預設 $10 USD

    const percentage = (currentCost / budget) * 100;

    if (percentage >= 100) {
      console.warn('[APIKeyManager] ⚠️ 已超過月度預算!', {
        current: currentCost.toFixed(2),
        budget,
      });
      // TODO: 發送通知給使用者
    } else if (percentage >= 80) {
      console.warn('[APIKeyManager] ⚠️ 已達月度預算 80%', {
        current: currentCost.toFixed(2),
        budget,
        percentage: percentage.toFixed(1),
      });
      // TODO: 發送通知給使用者
    }
  }

  /**
   * 取得使用者設定
   * @private
   */
  static async getUserSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.USER_SETTINGS);
    return (
      result[STORAGE_KEYS.USER_SETTINGS] || {
        monthlyBudget: 10,
        enableBudgetWarning: true,
      }
    );
  }

  /**
   * 取得當前月份字串 (YYYY-MM 格式)
   * @private
   */
  static getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * 估算影片成本 (供前端顯示)
   * @param {number} durationMinutes - 影片長度 (分鐘)
   * @param {boolean} withTranslation - 是否包含翻譯
   */
  static estimateCost(durationMinutes, withTranslation = false) {
    // Whisper 成本
    const whisperCost = durationMinutes * COST_CONFIG.WHISPER_PER_MINUTE;

    // GPT 翻譯成本 (估算)
    let gptCost = 0;
    if (withTranslation) {
      const estimatedTokens = durationMinutes * COST_CONFIG.ESTIMATED_TOKENS_PER_MINUTE;
      gptCost =
        (estimatedTokens / 1_000_000) *
        (COST_CONFIG.GPT_INPUT_PER_1M_TOKENS + COST_CONFIG.GPT_OUTPUT_PER_1M_TOKENS);
    }

    return {
      whisper: whisperCost,
      gpt: gptCost,
      total: whisperCost + gptCost,
    };
  }
}
