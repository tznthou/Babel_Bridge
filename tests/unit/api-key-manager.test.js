/**
 * APIKeyManager 單元測試
 */
import { describe, it, expect } from 'vitest';
import { APIKeyManager } from '../../src/lib/api-key-manager.js';
import { BabelBridgeError, ErrorCodes } from '../../src/lib/errors.js';

describe('APIKeyManager', () => {
  describe('validateFormat', () => {
    it('應該接受有效的 API Key', () => {
      const validKey = 'sk-' + 'a'.repeat(48);
      const result = APIKeyManager.validateFormat(validKey);
      expect(result).toBe(validKey);
    });

    it('應該拒絕無效格式', () => {
      const invalidKeys = [
        'invalid-key',
        'sk-tooshort',
        'sk-' + 'a'.repeat(47), // 太短
        'sk-' + 'a'.repeat(49), // 太長
        'pk-' + 'a'.repeat(48), // 錯誤前綴
        '',
        null,
        undefined,
      ];

      invalidKeys.forEach((key) => {
        expect(() => APIKeyManager.validateFormat(key)).toThrow(BabelBridgeError);
      });
    });

    it('應該去除前後空白', () => {
      const keyWithSpaces = '  sk-' + 'a'.repeat(48) + '  ';
      const result = APIKeyManager.validateFormat(keyWithSpaces);
      expect(result).toBe('sk-' + 'a'.repeat(48));
    });
  });

  describe('estimateCost', () => {
    it('應該正確估算 Whisper 成本', () => {
      const cost = APIKeyManager.estimateCost(10, false);

      // 10 分鐘 * $0.006/分鐘 = $0.06
      expect(cost.whisper).toBeCloseTo(0.06, 3);
      expect(cost.gpt).toBe(0);
      expect(cost.total).toBeCloseTo(0.06, 3);
    });

    it('應該正確估算 Whisper + GPT 成本', () => {
      const cost = APIKeyManager.estimateCost(10, true);

      expect(cost.whisper).toBeCloseTo(0.06, 3);
      expect(cost.gpt).toBeGreaterThan(0);
      expect(cost.total).toBe(cost.whisper + cost.gpt);
    });
  });

  describe('getCurrentMonth', () => {
    it('應該回傳 YYYY-MM 格式', () => {
      const month = APIKeyManager.getCurrentMonth();
      expect(month).toMatch(/^\d{4}-\d{2}$/);
    });
  });
});
