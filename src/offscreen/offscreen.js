/**
 * Offscreen Document - 處理 MP3 編碼
 *
 * Service Worker 不支援 Web Worker，因此我們使用 Offscreen Document
 * 來創建 Worker 並處理音訊編碼。
 *
 * 通訊流程:
 * Service Worker → chrome.runtime.sendMessage → Offscreen Document → Worker
 */

let mp3Worker = null;
let pendingRequests = new Map(); // 存儲待處理的請求
let requestIdCounter = 0;

/**
 * 初始化 MP3 Encoder Worker
 */
function initWorker() {
  if (mp3Worker) {
    return;
  }

  // 創建 Worker（Offscreen Document 支援）
  mp3Worker = new Worker('/src/workers/mp3-encoder.worker.js', { type: 'module' });

  // 監聽 Worker 訊息
  mp3Worker.onmessage = (event) => {
    const { requestId, type, data, error } = event.data;

    const pending = pendingRequests.get(requestId);
    if (!pending) {
      console.warn('[Offscreen] 收到未知 requestId 的回應:', requestId);
      return;
    }

    pendingRequests.delete(requestId);

    if (type === 'ENCODE_COMPLETE') {
      pending.resolve(data);
    } else if (type === 'ENCODE_ERROR') {
      pending.reject(new Error(error));
    }
  };

  mp3Worker.onerror = (error) => {
    console.error('[Offscreen] Worker 錯誤:', error);

    // 拒絕所有待處理的請求
    for (const [requestId, pending] of pendingRequests.entries()) {
      pending.reject(new Error('Worker crashed'));
      pendingRequests.delete(requestId);
    }
  };

  console.log('[Offscreen] MP3 Worker 已初始化');
}

/**
 * 處理來自 Service Worker 的訊息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  console.log('[Offscreen] 收到訊息:', type);

  switch (type) {
    case 'OFFSCREEN_INIT_WORKER':
      handleInitWorker(sendResponse);
      return true; // 異步回應

    case 'OFFSCREEN_ENCODE_MP3':
      handleEncodeMp3(data, sendResponse);
      return true; // 異步回應

    case 'OFFSCREEN_TERMINATE_WORKER':
      handleTerminateWorker(sendResponse);
      return true; // 異步回應

    default:
      console.warn('[Offscreen] 未知訊息類型:', type);
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

/**
 * 處理 Worker 初始化請求
 */
function handleInitWorker(sendResponse) {
  try {
    initWorker();
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Offscreen] Worker 初始化失敗:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 處理 MP3 編碼請求
 */
async function handleEncodeMp3(encodingData, sendResponse) {
  try {
    if (!mp3Worker) {
      initWorker();
    }

    // 生成唯一的請求 ID
    const requestId = requestIdCounter++;

    // 創建 Promise 等待 Worker 回應
    const resultPromise = new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
    });

    // 發送編碼請求到 Worker
    mp3Worker.postMessage({
      type: 'ENCODE',
      requestId,
      data: encodingData
    });

    // 等待結果
    const result = await resultPromise;

    sendResponse({ success: true, data: result });
  } catch (error) {
    console.error('[Offscreen] MP3 編碼失敗:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 處理 Worker 終止請求
 */
function handleTerminateWorker(sendResponse) {
  try {
    if (mp3Worker) {
      mp3Worker.terminate();
      mp3Worker = null;
      pendingRequests.clear();
      console.log('[Offscreen] Worker 已終止');
    }
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Offscreen] Worker 終止失敗:', error);
    sendResponse({ success: false, error: error.message });
  }
}

console.log('[Offscreen] Offscreen document 已載入');
