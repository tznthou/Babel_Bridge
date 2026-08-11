/**
 * Deepgram API 連線驗證測試
 *
 * 驗證各種 model + language 組合是否能成功建立 WebSocket 連線。
 * 這是純連線測試，不發送音訊，因此成本為零。
 *
 * 使用方式：
 *   DEEPGRAM_API_KEY=your_key npm run test:integration
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-12-01
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';

// 從環境變數讀取 API Key
const API_KEY = process.env.DEEPGRAM_API_KEY;

// npm run test:integration 會帶上這個旗標：既然是明確要求跑整合測試，
// 缺金鑰就該是失敗而非全綠。npm run test 不帶旗標，缺金鑰改為跳過，
// 才不會讓沒有金鑰的一般開發者永遠看到紅字。
const REQUIRE_KEY = !!process.env.REQUIRE_DEEPGRAM_KEY;

if (!API_KEY && REQUIRE_KEY) {
  throw new Error(
    'DEEPGRAM_API_KEY 未設定：npm run test:integration 需要真實金鑰才能驗證連線。\n' +
      '使用方式：DEEPGRAM_API_KEY=your_key npm run test:integration'
  );
}

// 被跳過時給出可執行的提示，避免看到 skipped 卻不知道少跑了什麼
if (!API_KEY) {
  console.log(
    '\n⏭️  跳過 Deepgram 連線測試（未設定 DEEPGRAM_API_KEY）\n' +
      '   啟用方式：DEEPGRAM_API_KEY=your_key npm run test:integration\n'
  );
}

// Deepgram WebSocket 基礎 URL
const WEBSOCKET_BASE_URL = 'wss://api.deepgram.com/v1/listen';

// 連線超時時間（毫秒）
const CONNECTION_TIMEOUT = 15000;

/**
 * 測試案例定義
 *
 * shouldWork:
 *   - true: 預期連線成功
 *   - false: 預期連線失敗（如 Nova-2 不支援 multi）
 *   - 'unknown': 待驗證（測試會執行但不 assert）
 */
const TEST_CASES = [
  // Nova-2 測試
  {
    model: 'nova-2',
    language: 'en-US',
    shouldWork: true,
    description: 'Nova-2 + English (US)',
  },
  {
    model: 'nova-2',
    language: 'en',
    shouldWork: true,
    description: 'Nova-2 + English (generic)',
  },
  {
    model: 'nova-2',
    language: 'zh-TW',
    shouldWork: true,
    description: 'Nova-2 + 繁體中文',
  },
  {
    model: 'nova-2',
    language: 'zh',
    shouldWork: true,
    description: 'Nova-2 + 简体中文',
  },
  {
    model: 'nova-2',
    language: 'ja',
    shouldWork: true,
    description: 'Nova-2 + 日本語',
  },
  {
    model: 'nova-2',
    language: 'multi',
    shouldWork: true,
    description: 'Nova-2 + multi (實測支援)',
  },

  // Nova-3 測試
  {
    model: 'nova-3',
    language: 'multi',
    shouldWork: true,
    description: 'Nova-3 + 自動偵測 (官方推薦)',
  },
  {
    model: 'nova-3',
    language: 'en-US',
    shouldWork: true,
    description: 'Nova-3 + English (US)',
  },
  {
    model: 'nova-3',
    language: 'en',
    shouldWork: true,
    description: 'Nova-3 + English (generic)',
  },
  {
    model: 'nova-3',
    language: 'zh-TW',
    shouldWork: false,
    description: 'Nova-3 + 繁體中文 (不支援，返回 400)',
  },
  {
    model: 'nova-3',
    language: 'zh',
    shouldWork: false,
    description: 'Nova-3 + 简体中文 (不支援，返回 400)',
  },
  {
    model: 'nova-3',
    language: 'ja',
    shouldWork: true,
    description: 'Nova-3 + 日本語',
  },
];

/**
 * 建構 WebSocket URL
 */
function buildWebSocketUrl(model, language) {
  const params = new URLSearchParams({
    model,
    language,
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: '300',
  });

  return `${WEBSOCKET_BASE_URL}?${params.toString()}`;
}

/**
 * 測試 WebSocket 連線
 *
 * @returns {Promise<{success: boolean, error?: string, code?: number}>}
 */
function testConnection(model, language, apiKey) {
  return new Promise((resolve) => {
    const url = buildWebSocketUrl(model, language);
    let resolved = false;

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };

    // 連線成功
    ws.on('open', () => {
      if (resolved) return;
      resolved = true;
      ws.close();
      resolve({ success: true });
    });

    // 連線錯誤
    ws.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      resolve({
        success: false,
        error: err.message,
      });
    });

    // 連線關閉（可能在 open 之前發生，表示握手失敗）
    ws.on('close', (code, reason) => {
      if (resolved) return;
      resolved = true;
      resolve({
        success: false,
        error: `Connection closed: ${code} - ${reason.toString()}`,
        code,
      });
    });

    // 超時處理
    setTimeout(() => {
      if (resolved) return;
      cleanup();
      resolve({
        success: false,
        error: 'Connection timeout',
      });
    }, CONNECTION_TIMEOUT);
  });
}

/**
 * 格式化測試結果
 */
function formatResult(testCase, result) {
  const status = result.success ? '✅' : '❌';
  const expected =
    testCase.shouldWork === 'unknown'
      ? '❓'
      : testCase.shouldWork
        ? '✅'
        : '❌';

  return {
    test: testCase.description,
    model: testCase.model,
    language: testCase.language,
    expected,
    actual: status,
    success: result.success,
    error: result.error || null,
    match:
      testCase.shouldWork === 'unknown' ||
      result.success === testCase.shouldWork,
  };
}

// ============================================================================
// 測試套件
// ============================================================================

// 缺 API Key 時整組跳過。這組測試需要真實憑證才能連線，
// 缺 key 屬於「未執行」而非「失敗」——若照舊 throw，npm run test 會永遠是紅的，
// 測試結果就失去了作為訊號的意義。
describe.skipIf(!API_KEY)('Deepgram API Connection Validation', () => {
  // 儲存所有測試結果，最後輸出摘要
  const results = [];

  beforeAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 Deepgram API 連線驗證測試');
    console.log('='.repeat(60));
    console.log(`API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);
    console.log(`測試案例數: ${TEST_CASES.length}`);
    console.log('='.repeat(60) + '\n');
  });

  afterAll(() => {
    // 輸出測試摘要
    console.log('\n' + '='.repeat(60));
    console.log('📊 測試結果摘要');
    console.log('='.repeat(60));

    // 按 model 分組顯示
    const byModel = {};
    results.forEach((r) => {
      if (!byModel[r.model]) byModel[r.model] = [];
      byModel[r.model].push(r);
    });

    Object.entries(byModel).forEach(([model, modelResults]) => {
      console.log(`\n【${model.toUpperCase()}】`);
      modelResults.forEach((r) => {
        const matchIcon = r.match ? '' : ' ⚠️ UNEXPECTED';
        console.log(`  ${r.actual} ${r.language.padEnd(8)} ${matchIcon}`);
        if (r.error) {
          console.log(`     └─ Error: ${r.error}`);
        }
      });
    });

    // 統計
    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const unexpected = results.filter((r) => !r.match).length;

    console.log('\n' + '-'.repeat(60));
    console.log(`✅ 連線成功: ${passed}/${results.length}`);
    console.log(`❌ 連線失敗: ${failed}/${results.length}`);
    if (unexpected > 0) {
      console.log(`⚠️  非預期結果: ${unexpected}`);
    }
    console.log('='.repeat(60) + '\n');
  });

  // 動態生成測試案例
  TEST_CASES.forEach((testCase) => {
    it(
      testCase.description,
      async () => {
        const result = await testConnection(
          testCase.model,
          testCase.language,
          API_KEY
        );

        const formatted = formatResult(testCase, result);
        results.push(formatted);

        // 根據預期結果進行斷言
        if (testCase.shouldWork === true) {
          expect(
            result.success,
            `預期連線成功，但失敗了: ${result.error}`
          ).toBe(true);
        } else if (testCase.shouldWork === false) {
          expect(result.success, '預期連線失敗，但成功了').toBe(false);
        }
        // shouldWork === 'unknown' 時不做斷言，只記錄結果
      },
      CONNECTION_TIMEOUT + 5000
    );
  });
});

// ============================================================================
// 獨立執行模式（不透過 vitest）
// ============================================================================

// 如果直接執行此檔案，跑簡單的連線測試
if (process.argv[1]?.endsWith('deepgram-api.test.js')) {
  (async () => {
    const apiKey = process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      console.error('❌ 請設定 DEEPGRAM_API_KEY 環境變數');
      process.exit(1);
    }

    console.log('🔍 快速連線測試...\n');

    for (const tc of TEST_CASES) {
      process.stdout.write(`  ${tc.description.padEnd(35)} `);
      const result = await testConnection(tc.model, tc.language, apiKey);
      console.log(result.success ? '✅' : `❌ ${result.error}`);
    }

    console.log('\n完成！');
  })();
}
