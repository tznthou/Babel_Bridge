/**
 * DeepgramStreamClient 單元測試
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-11-16
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeepgramStreamClient } from '../../src/background/deepgram-stream-client.js';
import { BabelBridgeError, ErrorCodes } from '../../src/lib/errors.js';

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sentMessages = [];

    // 模擬非同步連線成功
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen({ type: 'open' });
    }, 10);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close(code, reason) {
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) {
        this.onclose({
          code,
          reason,
          wasClean: code === 1000,
        });
      }
    }, 10);
  }

  // 模擬接收訊息
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  // 模擬錯誤
  simulateError(error) {
    if (this.onerror) {
      this.onerror(error);
    }
  }

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
}

describe('DeepgramStreamClient', () => {
  let client;
  let originalWebSocket;

  beforeEach(() => {
    // Mock WebSocket
    originalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocket;

    // Mock chrome.storage.local
    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            deepgram_api_key_encrypted: 'encrypted_test_key',
          }),
        },
      },
    };

    // Mock CryptoUtils
    vi.mock('../../src/lib/crypto-utils.js', () => ({
      CryptoUtils: {
        decrypt: vi.fn((ciphertext) =>
          Promise.resolve('test_deepgram_key_12345678901234567890')
        ),
      },
    }));

    client = new DeepgramStreamClient();
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    if (client) {
      client.close();
    }
    vi.clearAllTimers();
  });

  describe('建構函數', () => {
    it('應該初始化所有屬性', () => {
      expect(client.websocket).toBeNull();
      expect(client.connectionState).toBe('disconnected');
      expect(client.apiKey).toBeNull();
      expect(client.reconnectAttempts).toBe(0);
      expect(client.stats).toEqual({
        audioBytesSent: 0,
        transcriptsReceived: 0,
        interimResults: 0,
        finalResults: 0,
        errors: 0,
        startTime: null,
        endTime: null,
      });
    });
  });

  describe('init', () => {
    it('應該成功初始化並建立 WebSocket 連線', async () => {
      await client.init();

      expect(client.apiKey).toBe('test_deepgram_key_12345678901234567890');
      expect(client.websocket).toBeInstanceOf(MockWebSocket);
      expect(client.connectionState).toBe('connected');
      expect(client.stats.startTime).toBeTruthy();
    });

    it('應該拋出錯誤當 API Key 未設定', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      await expect(client.init()).rejects.toThrow(BabelBridgeError);
      await expect(client.init()).rejects.toThrow('Deepgram API Key 未設定');
    });
  });

  describe('buildWebSocketUrl', () => {
    it('應該建構正確的 WebSocket URL', async () => {
      await client.init();

      const url = client.buildWebSocketUrl();

      expect(url).toContain('wss://api.deepgram.com/v1/listen');
      expect(url).toContain('model=nova-2');
      expect(url).toContain('language=zh-TW');
      expect(url).toContain('encoding=linear16');
      expect(url).toContain('sample_rate=16000');
      expect(url).toContain('channels=1');
      expect(url).toContain('interim_results=true');
      expect(url).toContain('punctuate=true');
      expect(url).toContain('smart_format=true');
      expect(url).toContain('endpointing=300');
    });
  });

  describe('handleMessage', () => {
    beforeEach(async () => {
      await client.init();
    });

    it('應該處理 Results 訊息', () => {
      const transcriptCallback = vi.fn();
      client.onTranscript = transcriptCallback;

      client.websocket.simulateMessage({
        type: 'Results',
        channel: {
          alternatives: [
            {
              transcript: '測試字幕',
              confidence: 0.95,
              words: [
                { word: '測試', start: 0, end: 0.5 },
                { word: '字幕', start: 0.5, end: 1.0 },
              ],
            },
          ],
        },
        is_final: true,
      });

      expect(transcriptCallback).toHaveBeenCalledWith({
        text: '測試字幕',
        isFinal: true,
        confidence: 0.95,
        words: expect.any(Array),
        timestamp: expect.any(Number),
      });

      expect(client.stats.transcriptsReceived).toBe(1);
      expect(client.stats.finalResults).toBe(1);
    });

    it('應該處理 interim results', () => {
      const transcriptCallback = vi.fn();
      client.onTranscript = transcriptCallback;

      client.websocket.simulateMessage({
        type: 'Results',
        channel: {
          alternatives: [
            {
              transcript: '臨時字幕',
              confidence: 0.85,
            },
          ],
        },
        is_final: false,
      });

      expect(transcriptCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '臨時字幕',
          isFinal: false,
        })
      );

      expect(client.stats.interimResults).toBe(1);
      expect(client.stats.finalResults).toBe(0);
    });

    it('應該忽略空字幕', () => {
      const transcriptCallback = vi.fn();
      client.onTranscript = transcriptCallback;

      client.websocket.simulateMessage({
        type: 'Results',
        channel: {
          alternatives: [{ transcript: '' }],
        },
        is_final: true,
      });

      expect(transcriptCallback).not.toHaveBeenCalled();
    });

    it('應該處理 Error 訊息', () => {
      const errorCallback = vi.fn();
      client.onError = errorCallback;

      client.websocket.simulateMessage({
        type: 'Error',
        message: 'API 錯誤',
      });

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'API 錯誤',
        })
      );

      expect(client.stats.errors).toBe(1);
    });

    it('應該記錄 Metadata 訊息', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      client.websocket.simulateMessage({
        type: 'Metadata',
        transaction_key: 'test-key',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Metadata'),
        expect.any(Object)
      );
    });

    it('應該記錄 UtteranceEnd 訊息', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      client.websocket.simulateMessage({
        type: 'UtteranceEnd',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('句子結束')
      );
    });

    it('應該記錄 SpeechStarted 訊息', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      client.websocket.simulateMessage({
        type: 'SpeechStarted',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('偵測到語音')
      );
    });
  });

  describe('sendAudio', () => {
    beforeEach(async () => {
      await client.init();
    });

    it('應該成功發送音訊資料', () => {
      const audioData = new ArrayBuffer(1024);

      client.sendAudio(audioData);

      expect(client.websocket.sentMessages).toContainEqual(audioData);
      expect(client.stats.audioBytesSent).toBe(1024);
    });

    it('應該忽略空音訊資料', () => {
      const emptyData = new ArrayBuffer(0);
      const consoleSpy = vi.spyOn(console, 'warn');

      client.sendAudio(emptyData);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('音訊資料為空')
      );
      expect(client.websocket.sentMessages.length).toBe(1); // 只有認證訊息
    });

    it('應該累積發送的音訊位元組數', () => {
      client.sendAudio(new ArrayBuffer(512));
      client.sendAudio(new ArrayBuffer(768));
      client.sendAudio(new ArrayBuffer(256));

      expect(client.stats.audioBytesSent).toBe(1536);
    });
  });

  describe('KeepAlive 機制', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await client.init();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('應該定期發送 KeepAlive 訊息', async () => {
      // 初始狀態：只有認證訊息
      expect(client.websocket.sentMessages.length).toBe(1);

      // 前進 5 秒
      await vi.advanceTimersByTimeAsync(5000);

      // 應該發送了 KeepAlive
      expect(client.websocket.sentMessages.length).toBe(2);
      expect(
        JSON.parse(client.websocket.sentMessages[1])
      ).toEqual({ type: 'KeepAlive' });

      // 再前進 5 秒
      await vi.advanceTimersByTimeAsync(5000);

      // 應該再發送一次
      expect(client.websocket.sentMessages.length).toBe(3);
    });

    it('應該在關閉時停止 KeepAlive', async () => {
      await vi.advanceTimersByTimeAsync(5000);
      expect(client.websocket.sentMessages.length).toBe(2);

      await client.close();
      await vi.advanceTimersByTimeAsync(100);

      // 關閉後不應再發送
      await vi.advanceTimersByTimeAsync(10000);
      expect(client.websocket.sentMessages.length).toBe(2);
    });
  });

  describe('狀態變更', () => {
    it('應該觸發 onStateChange 回調', async () => {
      const stateCallback = vi.fn();
      client.onStateChange = stateCallback;

      await client.init();

      expect(stateCallback).toHaveBeenCalledWith('connecting', 'disconnected');
      expect(stateCallback).toHaveBeenCalledWith('connected', 'connecting');
    });
  });

  describe('關閉連線', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await client.init();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('應該正確關閉連線並清理資源', async () => {
      await client.close();
      await vi.advanceTimersByTimeAsync(100);

      expect(client.connectionState).toBe('disconnected');
      expect(client.stats.endTime).toBeTruthy();
      expect(client.keepAliveTimer).toBeNull();
    });

    it('應該輸出統計資訊', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      // 模擬一些活動
      client.sendAudio(new ArrayBuffer(1024));
      client.websocket.simulateMessage({
        type: 'Results',
        channel: {
          alternatives: [{ transcript: '測試', confidence: 0.9 }],
        },
        is_final: true,
      });

      await client.close();
      await vi.advanceTimersByTimeAsync(100);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('統計資訊'),
        expect.objectContaining({
          audioBytesSent: expect.stringContaining('KB'),
          transcriptsReceived: 1,
          finalResults: 1,
        })
      );
    });
  });

  describe('重連機制', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('應該在非正常關閉時嘗試重連', async () => {
      await client.init();

      // 模擬非正常關閉
      client.websocket.close(1006, 'Abnormal closure');
      await vi.advanceTimersByTimeAsync(100);

      expect(client.reconnectAttempts).toBe(1);
    }, 10000);

    it('應該在正常關閉時不重連', async () => {
      await client.init();

      // 正常關閉
      client.websocket.close(1000, 'Normal closure');
      await vi.advanceTimersByTimeAsync(100);

      expect(client.reconnectAttempts).toBe(0);
    }, 10000);

    it('應該在超過最大重連次數後停止', async () => {
      await client.init();

      // 強制設定重連次數
      client.reconnectAttempts = 5;

      // 模擬非正常關閉
      client.websocket.close(1006, 'Abnormal closure');
      await vi.advanceTimersByTimeAsync(100);

      // 不應再嘗試重連
      expect(client.reconnectAttempts).toBe(5);
    }, 10000);
  });

  describe('getStats', () => {
    it('應該回傳統計資訊副本', () => {
      const stats = client.getStats();

      expect(stats).toEqual(client.stats);
      expect(stats).not.toBe(client.stats); // 不是同一個物件
    });
  });

  describe('getState', () => {
    it('應該回傳當前連線狀態', async () => {
      expect(client.getState()).toBe('disconnected');

      await client.init();
      expect(client.getState()).toBe('connected');

      await client.close();
      expect(client.getState()).toBe('disconnected');
    });
  });
});
