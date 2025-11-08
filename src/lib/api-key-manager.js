/**
 * APIKeyManager - API Key 管理與成本追蹤
 *
 * 功能:
 * 1. API Key 格式驗證與測試
 * 2. 成本追蹤 (Whisper + GPT)
 * 3. 預算警告
 */
import { BabelBridgeError, ErrorCodes } from './errors.js';
import { STORAGE_KEYS, COST_CONFIG } from './config.js';

export class APIKeyManager {
  /**
   * API Key 格式正則 (sk- 開頭，48 字元隨機字串)
   */
  static API_KEY_PATTERN = /^sk-[A-Za-z0-9]{48}$/;

  /**
   * 驗證 API Key 格式
   */
  static validateFormat(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new BabelBridgeError(ErrorCodes.API_KEY_INVALID, 'API Key must be a string');
    }

    const trimmedKey = apiKey.trim();

    if (!this.API_KEY_PATTERN.test(trimmedKey)) {
      throw new BabelBridgeError(
        ErrorCodes.API_KEY_INVALID,
        'Invalid API Key format. Expected: sk-[48 characters]'
      );
    }

    return trimmedKey;
  }

  /**
   * 驗證 API Key 有效性 (呼叫 OpenAI API 測試)
   */
  static async verifyKey(apiKey) {
    const validatedKey = this.validateFormat(apiKey);

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validatedKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new BabelBridgeError(
            ErrorCodes.API_KEY_INVALID,
            'API Key authentication failed'
          );
        }

        throw new BabelBridgeError(
          ErrorCodes.API_RESPONSE_ERROR,
          `API verification failed: ${response.status} ${response.statusText}`
        );
      }

      console.log('[APIKeyManager] API Key 驗證成功');
      return true;
    } catch (error) {
      if (error instanceof BabelBridgeError) {
        throw error;
      }

      throw new BabelBridgeError(
        ErrorCodes.API_NETWORK_ERROR,
        `Network error during verification: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * 驗證並儲存 API Key
   */
  static async verifyAndSave(apiKey) {
    const validatedKey = this.validateFormat(apiKey);
    await this.verifyKey(validatedKey);

    // 儲存到 chrome.storage
    await chrome.storage.local.set({
      [STORAGE_KEYS.API_KEY]: validatedKey,
    });

    console.log('[APIKeyManager] API Key 已儲存');
    return true;
  }

  /**
   * 取得已儲存的 API Key
   */
  static async getKey() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.API_KEY);
    return result[STORAGE_KEYS.API_KEY] || null;
  }

  /**
   * 刪除 API Key
   */
  static async removeKey() {
    await chrome.storage.local.remove(STORAGE_KEYS.API_KEY);
    console.log('[APIKeyManager] API Key 已移除');
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
