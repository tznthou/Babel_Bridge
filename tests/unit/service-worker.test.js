/**
 * SubtitleService 連線生命週期測試
 *
 * 聚焦 enable() 與 disable() 的併發行為：enable() 中間隔著數個 await，
 * 期間插進來的 disable() 若沒被處理，會留下「Popup 顯示已啟用、管線其實已被清掉」
 * 的靜默失效，或反過來留下一條沒人關的 Deepgram 連線持續消耗配額。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// service-worker.js 在載入當下就註冊三個 chrome listener，
// chrome stub 必須在 import 之前備妥——vi.hoisted 會提到所有 import 之上執行。
vi.hoisted(() => {
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      getURL: (path) => path,
    },
    tabs: {
      onRemoved: { addListener: () => {} },
      sendMessage: async () => ({ success: true }),
      create: async () => {},
    },
    storage: { local: { get: async () => ({}) } },
  };
});

// 兩個依賴的 init()/start() 都刻意停在 pending，由測試決定何時完成，
// 才能精準地在「連線建立中」「音訊啟動中」這兩個空隙插入 disable()。
const { MockDeepgramStreamClient, MockAudioCapture, spawned } = vi.hoisted(() => {
  const spawned = { clients: [], captures: [] };

  class MockDeepgramStreamClient {
    constructor() {
      this.closed = false;
      this.settleInit = null;
      spawned.clients.push(this);
    }

    init() {
      return new Promise((resolve) => {
        this.settleInit = resolve;
      });
    }

    async close() {
      this.closed = true;
    }
  }

  class MockAudioCapture {
    constructor() {
      this.stopped = false;
      this.settleStart = null;
      spawned.captures.push(this);
    }

    start() {
      return new Promise((resolve) => {
        this.settleStart = resolve;
      });
    }

    async stop() {
      this.stopped = true;
    }
  }

  return { MockDeepgramStreamClient, MockAudioCapture, spawned };
});

vi.mock('../../src/background/deepgram-stream-client.js', () => ({
  DeepgramStreamClient: MockDeepgramStreamClient,
  ConnectionState: {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    CLOSING: 'closing',
    ERROR: 'error',
  },
}));

vi.mock('../../src/background/audio-capture.js', () => ({
  AudioCapture: MockAudioCapture,
}));

vi.mock('../../src/lib/error-handler.js', () => ({
  ErrorHandler: { handle: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/lib/api-key-manager.js', () => ({
  APIKeyManager: {
    verifyAndSave: vi.fn(),
    getCurrentMonthStats: vi.fn(),
  },
}));

const { SubtitleService } = await import('../../src/background/service-worker.js');

/** 清空所有 pending microtask，讓 enable() 推進到下一個 await */
const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 推進 enable() 直到 client 建好、正卡在啟動音訊擷取
 *
 * 回傳包在物件裡：async function 直接 return promise 會把它 await 掉，
 * 而這裡要的正是那個「還沒完成」的 enable()。
 */
async function advanceToCapture(service, tabId = 1) {
  const enabling = service.enable(tabId);
  await settleMicrotasks();
  spawned.clients.at(-1).settleInit();
  await settleMicrotasks();
  return { enabling };
}

describe('SubtitleService 連線生命週期', () => {
  let service;

  beforeEach(() => {
    spawned.clients.length = 0;
    spawned.captures.length = 0;
    service = new SubtitleService();
  });

  describe('正常流程', () => {
    it('未被打斷時應完成啟用', async () => {
      const { enabling } = await advanceToCapture(service);
      spawned.captures[0].settleStart();

      await expect(enabling).resolves.toEqual({ success: true });
      expect(service.isActive).toBe(true);
      expect(service.deepgramClient).toBe(spawned.clients[0]);
      expect(service.audioCapture).toBe(spawned.captures[0]);
      expect(spawned.clients[0].closed).toBe(false);
    });

    it('音訊啟動前 client 就要掛上，避免漏接開頭的 PCM frame', async () => {
      const { enabling } = await advanceToCapture(service);

      // capture.start() 仍在 pending，但 PCM frame 隨時會回送到
      // handlePCMFrame()，而它讀的是 this.deepgramClient
      expect(spawned.captures.length).toBe(1);
      expect(service.deepgramClient).toBe(spawned.clients[0]);

      spawned.captures[0].settleStart();
      await enabling;
    });

    it('啟用流程進行中應擋掉重複的 enable()', async () => {
      const { enabling } = await advanceToCapture(service);

      const duplicate = await service.enable(2);

      expect(duplicate.success).toBe(false);
      // 第二次請求不該另外建連線，否則前一次的 client 會變成沒人管的孤兒
      expect(spawned.clients.length).toBe(1);

      spawned.captures[0].settleStart();
      await enabling;
      expect(service.currentTabId).toBe(1);
    });

    it('disable() 應收掉連線並回到未啟用', async () => {
      const { enabling } = await advanceToCapture(service);
      spawned.captures[0].settleStart();
      await enabling;

      await expect(service.disable()).resolves.toEqual({ success: true });

      expect(service.isActive).toBe(false);
      expect(service.deepgramClient).toBeNull();
      expect(service.audioCapture).toBeNull();
      expect(spawned.clients[0].closed).toBe(true);
      expect(spawned.captures[0].stopped).toBe(true);
    });
  });

  describe('enable() 被 disable() 打斷', () => {
    it('連線建立中被打斷：不留下已啟用假象，半路的連線要收掉', async () => {
      const enabling = service.enable(1);
      await settleMicrotasks();
      expect(spawned.clients.length).toBe(1);

      // 使用者在連線還沒建好時就按下停用
      await service.disable();

      // 連線這時才完成，enable() 繼續往下跑
      spawned.clients[0].settleInit();
      const result = await enabling;

      expect(result.success).toBe(false);
      expect(service.isActive).toBe(false);
      expect(service.deepgramClient).toBeNull();
      // 沒收掉的話，這條連線帶著 KeepAlive 誰也關不掉
      expect(spawned.clients[0].closed).toBe(true);
      // 停用之後不該再往下建音訊擷取
      expect(spawned.captures.length).toBe(0);
    });

    it('音訊啟動中被打斷：不留下運作中的擷取', async () => {
      const { enabling } = await advanceToCapture(service);
      expect(spawned.captures.length).toBe(1);

      await service.disable();

      spawned.captures[0].settleStart();
      const result = await enabling;

      expect(result.success).toBe(false);
      expect(service.isActive).toBe(false);
      expect(service.deepgramClient).toBeNull();
      expect(service.audioCapture).toBeNull();
      expect(spawned.clients[0].closed).toBe(true);
      expect(spawned.captures[0].stopped).toBe(true);
    });

    it('被打斷之後仍能重新啟用', async () => {
      const interrupted = service.enable(1);
      await settleMicrotasks();
      await service.disable();
      spawned.clients[0].settleInit();
      await expect(interrupted).resolves.toMatchObject({ success: false });

      // 被作廢的那一輪必須把 isEnabling 交還，否則之後永遠啟用不了
      expect(service.isEnabling).toBe(false);

      const { enabling } = await advanceToCapture(service, 2);
      spawned.captures[0].settleStart();

      await expect(enabling).resolves.toEqual({ success: true });
      expect(service.isActive).toBe(true);
      expect(service.deepgramClient).toBe(spawned.clients[1]);
      expect(service.currentTabId).toBe(2);
      expect(spawned.clients[1].closed).toBe(false);
    });
  });

  describe('Content Script 回報失敗', () => {
    it('頁面沒有 video 時要收掉已建立的連線', async () => {
      chrome.tabs.sendMessage = async () => ({ success: false, error: '頁面沒有影片' });

      const enabling = service.enable(1);
      await settleMicrotasks();
      spawned.clients[0].settleInit();

      const result = await enabling;

      expect(result).toEqual({ success: false, error: '頁面沒有影片' });
      expect(service.isActive).toBe(false);
      expect(service.deepgramClient).toBeNull();
      expect(spawned.clients[0].closed).toBe(true);

      chrome.tabs.sendMessage = async () => ({ success: true });
    });
  });
});
