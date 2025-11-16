/**
 * DeepgramKeyManager 單元測試
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-11-16
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeepgramKeyManager } from '../../src/lib/deepgram-key-manager.js';
import { BabelBridgeError, ErrorCodes } from '../../src/lib/errors.js';

describe('DeepgramKeyManager', () => {
  beforeEach(() => {
    // Mock chrome.storage.local
    global.chrome = {
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn(),
        },
      },
    };

    // Mock CryptoUtils
    vi.mock('../../src/lib/crypto-utils.js', () => ({
      CryptoUtils: {
        encrypt: vi.fn((plaintext) => Promise.resolve(`encrypted_${plaintext}`)),
        decrypt: vi.fn((ciphertext) =>
          Promise.resolve(ciphertext.replace('encrypted_', ''))
        ),
      },
    }));

    // Reset fetch mock
    vi.restoreAllMocks();
  });

  describe('validateFormat', () => {
    it('應該接受有效的 Deepgram API Key', () => {
      const validKey = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
      expect(() => DeepgramKeyManager.validateFormat(validKey)).not.toThrow();
    });

    it('應該拒絕過短的 Key', () => {
      const shortKey = 'abc123';
      expect(() => DeepgramKeyManager.validateFormat(shortKey)).toThrow(
        BabelBridgeError
      );
      expect(() => DeepgramKeyManager.validateFormat(shortKey)).toThrow(
        /長度必須/
      );
    });

    it('應該拒絕包含非法字元的 Key', () => {
      const invalidKey = 'a1b2c3d4e5f6g7h8i9j0!@#$%^&*()';
      expect(() => DeepgramKeyManager.validateFormat(invalidKey)).toThrow(
        BabelBridgeError
      );
      expect(() => DeepgramKeyManager.validateFormat(invalidKey)).toThrow(
        /格式無效/
      );
    });

    it('應該拒絕空字串', () => {
      expect(() => DeepgramKeyManager.validateFormat('')).toThrow(
        BabelBridgeError
      );
      expect(() => DeepgramKeyManager.validateFormat('')).toThrow(/不能為空/);
    });

    it('應該拒絕 null 或 undefined', () => {
      expect(() => DeepgramKeyManager.validateFormat(null)).toThrow();
      expect(() => DeepgramKeyManager.validateFormat(undefined)).toThrow();
    });

    it('應該去除前後空白', () => {
      const keyWithSpaces = '  a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6  ';
      const result = DeepgramKeyManager.validateFormat(keyWithSpaces);
      expect(result).toBe('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6');
    });

    it('應該接受包含底線和連字號的 Key', () => {
      const validKey = 'a1b2-c3d4_e5f6-g7h8_i9j0k1l2m3n4o5p6';
      expect(() => DeepgramKeyManager.validateFormat(validKey)).not.toThrow();
    });
  });

  describe('verifyKey', () => {
    it('應該成功驗證有效的 API Key', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          token: 'test_key',
          project_uuid: 'test-uuid-1234',
          scopes: ['usage:read', 'member'],
          created: '2025-01-01T00:00:00Z',
          expires: '2026-01-01T00:00:00Z',
        }),
      });

      const result = await DeepgramKeyManager.verifyKey(
        'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
      );

      expect(result.valid).toBe(true);
      expect(result.projectUuid).toBe('test-uuid-1234');
      expect(result.scopes).toEqual(['usage:read', 'member']);
    });

    it('應該拋出錯誤當 API Key 無效（401）', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'invalid credentials' }),
      });

      await expect(
        DeepgramKeyManager.verifyKey('invalid_key_abcdefghijklmnopqrstuvwxyz')
      ).rejects.toThrow(BabelBridgeError);

      await expect(
        DeepgramKeyManager.verifyKey('invalid_key_abcdefghijklmnopqrstuvwxyz')
      ).rejects.toThrow(/無效或已過期/);
    });

    it('應該拋出錯誤當權限不足（403）', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'permission denied' }),
      });

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_but_no_permission_12345678')
      ).rejects.toThrow(BabelBridgeError);

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_but_no_permission_12345678')
      ).rejects.toThrow(/權限不足/);
    });

    it('應該拋出錯誤當達到 Rate Limit（429）', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ message: 'rate limit exceeded' }),
      });

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_rate_limited_12345678901')
      ).rejects.toThrow(BabelBridgeError);

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_rate_limited_12345678901')
      ).rejects.toThrow(/請求過於頻繁/);
    });

    it('應該拋出錯誤當服務不可用（500）', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'internal server error' }),
      });

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_server_error_12345678901')
      ).rejects.toThrow(BabelBridgeError);

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_server_error_12345678901')
      ).rejects.toThrow(/服務暫時無法使用/);
    });

    it('應該拋出錯誤當網路連線失敗', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_network_error_12345678901')
      ).rejects.toThrow(BabelBridgeError);

      await expect(
        DeepgramKeyManager.verifyKey('valid_key_network_error_12345678901')
      ).rejects.toThrow(/網路錯誤/);
    });
  });

  describe('hasKey', () => {
    it('應該回傳 true 當 Key 已設定', async () => {
      chrome.storage.local.get.mockResolvedValue({
        deepgram_api_key_encrypted: 'encrypted_key',
      });

      const hasKey = await DeepgramKeyManager.hasKey();
      expect(hasKey).toBe(true);
    });

    it('應該回傳 false 當 Key 未設定', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const hasKey = await DeepgramKeyManager.hasKey();
      expect(hasKey).toBe(false);
    });
  });

  describe('maskKey', () => {
    it('應該遮罩中間部分', () => {
      const key = 'abcdefgh1234567890xyz1';
      const masked = DeepgramKeyManager.maskKey(key);

      expect(masked).toBe('abcdefgh**********xyz1');
      expect(masked.length).toBe(key.length);
    });

    it('應該處理短 Key', () => {
      const shortKey = 'abcd';
      const masked = DeepgramKeyManager.maskKey(shortKey);

      expect(masked).toBe('***');
    });

    it('應該處理空 Key', () => {
      const masked = DeepgramKeyManager.maskKey('');
      expect(masked).toBe('***');
    });

    it('應該處理 null', () => {
      const masked = DeepgramKeyManager.maskKey(null);
      expect(masked).toBe('***');
    });
  });

  describe('getKeyInfo', () => {
    it('應該回傳完整的 Key 資訊', async () => {
      chrome.storage.local.get.mockResolvedValue({
        deepgram_api_key_encrypted: 'encrypted_key',
        deepgram_api_key_verified_at: 1700000000000,
        deepgram_api_key_scopes: ['usage:read', 'member'],
        deepgram_project_uuid: 'test-uuid-1234',
      });

      const info = await DeepgramKeyManager.getKeyInfo();

      expect(info.hasKey).toBe(true);
      expect(info.verifiedAt).toBe(1700000000000);
      expect(info.scopes).toEqual(['usage:read', 'member']);
      expect(info.projectUuid).toBe('test-uuid-1234');
    });

    it('應該處理未設定的情況', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const info = await DeepgramKeyManager.getKeyInfo();

      expect(info.hasKey).toBe(false);
      expect(info.verifiedAt).toBeUndefined();
      expect(info.scopes).toEqual([]);
      expect(info.projectUuid).toBeUndefined();
    });
  });

  describe('removeKey', () => {
    it('應該移除所有 Deepgram 相關資料', async () => {
      await DeepgramKeyManager.removeKey();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith([
        'deepgram_api_key_encrypted',
        'deepgram_api_key_verified_at',
        'deepgram_api_key_scopes',
        'deepgram_project_uuid',
      ]);
    });
  });
});
