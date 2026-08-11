/**
 * DeepgramStreamClient 單元測試
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-11-16
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeepgramStreamClient } from '../../src/background/deepgram-stream-client.js';
import { BabelBridgeError } from '../../src/lib/errors.js';

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
        decrypt: vi.fn(() =>
          Promise.resolve('test_deepgram_key_12345678901234567890')
        ),
      },
    }));

    client = new DeepgramStreamClient();
  });

  afterEach(async () => {
    // 先還原真實 timer。close() 本身是同步的、不會卡；真正的風險是某個 it
    // 結束時仍停在 fake timer 狀態，外溢到下一個測試的 client.init()，
    // 讓它等不到 MockWebSocket 的 onopen 而真的卡到 vitest timeout。
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
    if (client) {
      await client.close();
    }
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
      // 認證改走 WebSocket subprotocols，且不送 configure 訊息，故連線後應為空
      expect(client.websocket.sentMessages.length).toBe(0);
    });

    it('應該累積發送的音訊位元組數', () => {
      client.sendAudio(new ArrayBuffer(512));
      client.sendAudio(new ArrayBuffer(768));
      client.sendAudio(new ArrayBuffer(256));

      expect(client.stats.audioBytesSent).toBe(1536);
    });
  });

  // 影片暫停時無音訊，Deepgram 會在 10 秒後以 NET-0001 斷線，
  // 因此連線期間需持續送 KeepAlive text frame 維持連線。
  describe('KeepAlive 機制', () => {
    beforeEach(async () => {
      // 這組與其他 describe 相反，必須「全程」在 fake timer 下完成連線：
      // KeepAlive 的 setInterval 建立於 connect() 之中，若先以真實 timer 連線再切換，
      // 該 interval 會留在真實時鐘上，advanceTimersByTime 永遠推不到它。
      vi.useFakeTimers();
      const initPromise = client.init();
      // 推進 MockWebSocket 模擬 onopen 的 10ms 與 waitForConnection 輪詢的 100ms
      await vi.advanceTimersByTimeAsync(200);
      await initPromise;
    });

    it('應該定期發送 KeepAlive 訊息', async () => {
      // 連線建立後尚未觸發任何傳送（認證走 subprotocols，不佔訊息）
      expect(client.websocket.sentMessages.length).toBe(0);

      await vi.advanceTimersByTimeAsync(5000);

      expect(client.websocket.sentMessages.length).toBe(1);
      expect(JSON.parse(client.websocket.sentMessages[0])).toEqual({
        type: 'KeepAlive',
      });

      await vi.advanceTimersByTimeAsync(5000);
      expect(client.websocket.sentMessages.length).toBe(2);
    });

    it('應該以 text frame 傳送而非 binary', async () => {
      await vi.advanceTimersByTimeAsync(5000);

      // 送成 binary 會被 Deepgram 錯誤解讀，必須是字串
      expect(typeof client.websocket.sentMessages[0]).toBe('string');
    });

    it('應該在關閉時停止 KeepAlive', async () => {
      await vi.advanceTimersByTimeAsync(5000);

      // close() 會將 client.websocket 設為 null，先留住參考才能驗證後續無新訊息
      const ws = client.websocket;
      expect(ws.sentMessages.length).toBe(1);

      await client.close();
      await vi.advanceTimersByTimeAsync(15000);

      expect(client.keepAliveTimer).toBeNull();
      expect(ws.sentMessages.length).toBe(1);
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
      // 同上：先連線再切 fake timer
      await client.init();
      vi.useFakeTimers();
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
    it('應該在非正常關閉時嘗試重連', async () => {
      // 先連線再切 fake timer，否則 init() 等不到 MockWebSocket 的 onopen
      await client.init();
      const originalSocket = client.websocket;
      vi.useFakeTimers();

      // 模擬非正常關閉
      client.websocket.close(1006, 'Abnormal closure');
      await vi.advanceTimersByTimeAsync(100);

      expect(client.reconnectAttempts).toBe(1);

      // 只驗計數器不夠：scheduleReconnect() 把 reconnectAttempts++ 放在 setTimeout 之外
      // 同步執行，真正的 connect() 要等 RECONNECT_DELAY(1000ms) 才觸發。
      // 若只推進 100ms，即使 connect() 整段被刪除本測試仍會通過。
      await vi.advanceTimersByTimeAsync(1200);

      // 確認真的重新連上：換了新的 socket 實例、狀態回到 connected
      expect(client.websocket).not.toBe(originalSocket);
      expect(client.getState()).toBe('connected');
    });

    it('應該在正常關閉時不重連', async () => {
      await client.init();
      vi.useFakeTimers();

      // 正常關閉
      client.websocket.close(1000, 'Normal closure');
      await vi.advanceTimersByTimeAsync(100);

      expect(client.reconnectAttempts).toBe(0);
    });

    it('應該在超過最大重連次數後停止', async () => {
      await client.init();
      vi.useFakeTimers();

      // 強制設定重連次數
      client.reconnectAttempts = 5;

      // 模擬非正常關閉
      client.websocket.close(1006, 'Abnormal closure');
      await vi.advanceTimersByTimeAsync(100);

      // 不應再嘗試重連
      expect(client.reconnectAttempts).toBe(5);
    });

    it('close() 之後即使關閉握手不乾淨也不重連', async () => {
      await client.init();
      const originalSocket = client.websocket;
      vi.useFakeTimers();

      await client.close();

      // close() 已把 client.websocket 設為 null，但 onclose 仍掛在原 socket 上。
      // 模擬伺服器沒回 close frame（網路先斷）：wasClean 為 false。
      // 少了 shouldReconnect 閂，這裡會重連出一條沒有任何參照能關掉的孤兒連線，
      // 帶著 KeepAlive 持續消耗 Deepgram 配額。
      originalSocket.onclose({ code: 1006, reason: 'Abnormal closure', wasClean: false });

      // 推進超過 RECONNECT_DELAY(1000ms)，確認連 connect() 都沒被觸發
      await vi.advanceTimersByTimeAsync(3000);

      expect(client.reconnectAttempts).toBe(0);
      expect(client.websocket).toBeNull();
      expect(client.keepAliveTimer).toBeNull();
    });

    it('close() 後重新 init() 應恢復重連能力', async () => {
      await client.init();
      await client.close();
      expect(client.shouldReconnect).toBe(false);

      // 閂只在 init() 開啟。若在 connect() 開啟，競態中的重連會自行解除
      // close() 剛閂上的鎖，等於這道防護沒有作用。
      await client.init();
      expect(client.shouldReconnect).toBe(true);
    });
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
