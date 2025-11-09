/**
 * Offscreen Document - 處理音訊擷取、切塊和 MP3 編碼
 *
 * Manifest V3 限制：
 * - Service Worker 不支援 AudioContext、MediaStream、Web Worker
 * - 必須在 Offscreen Document 中處理所有音訊相關操作
 *
 * 功能：
 * 1. 使用 streamId 取得 MediaStream
 * 2. 建立 AudioContext 處理音訊
 * 3. 音訊切塊 (Rolling Window)
 * 4. MP3 編碼 (via Worker)
 * 5. 發送處理結果回 Service Worker
 *
 * 通訊流程:
 * Service Worker → getMediaStreamId() → streamId
 * → Offscreen Document → getUserMedia() → MediaStream
 * → AudioContext → AudioChunker → MP3 Worker → MP3 blob
 * → Service Worker → Whisper API
 */

// === MP3 Worker 管理 ===
let mp3Worker = null;
let pendingRequests = new Map();
let requestIdCounter = 0;

// === 音訊擷取狀態 ===
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;

// === 音訊切塊狀態 ===
let chunkBuffer = [];
let chunkIndex = 0;
let totalSamples = 0;
let isProcessingChunk = false; // 🔒 防止並發處理

// === 配置 (暫時硬編碼，之後應從 config.js 導入) ===
const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
};

const CHUNK_CONFIG = {
  CHUNK_DURATION: 3, // 3 秒
  OVERLAP_DURATION: 1, // 1 秒重疊
  MIN_CHUNK_DURATION: 0.5, // 最小 chunk 長度
};

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

    case 'OFFSCREEN_START_AUDIO_CAPTURE':
      handleStartAudioCapture(data, sendResponse);
      return true; // 異步回應

    case 'OFFSCREEN_STOP_AUDIO_CAPTURE':
      handleStopAudioCapture(sendResponse);
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

/**
 * 處理音訊擷取開始請求
 */
async function handleStartAudioCapture(captureData, sendResponse) {
  try {
    const { streamId, tabId } = captureData;

    console.log(`[Offscreen] 開始音訊擷取，streamId: ${streamId}, tabId: ${tabId}`);

    // 停止現有的擷取（如果有）
    stopAudioCapture();

    // Step 1: 使用 streamId 取得 MediaStream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });

    console.log('[Offscreen] MediaStream 已取得');

    // Step 2: 建立 AudioContext
    audioContext = new AudioContext({
      sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
    });

    // 確保 AudioContext 處於 running 狀態（避免被 autoplay policy 暫停）
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
      console.log('[Offscreen] AudioContext 已從暫停狀態恢復');
    }

    console.log(`[Offscreen] AudioContext 已建立，state: ${audioContext.state}, sample rate: ${audioContext.sampleRate}`);

    // Step 3: 建立音訊處理節點
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // 使用 ScriptProcessorNode 處理音訊 (bufferSize: 4096)
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);

    // 計算切塊參數
    const chunkSamples = AUDIO_CONFIG.SAMPLE_RATE * CHUNK_CONFIG.CHUNK_DURATION;
    const overlapSamples = AUDIO_CONFIG.SAMPLE_RATE * CHUNK_CONFIG.OVERLAP_DURATION;
    const stepSamples = chunkSamples - overlapSamples;

    console.log('[Offscreen] 音訊切塊參數', {
      chunkSamples,
      overlapSamples,
      stepSamples,
    });

    // Step 4: 處理音訊資料
    processorNode.onaudioprocess = (event) => {
      const channelData = event.inputBuffer.getChannelData(0);

      // 🚀 效能優化：使用循環替代 spread operator，避免堆疊溢出
      // 原本的 push(...channelData) 每次展開 4096 個元素，造成 GC 壓力
      for (let i = 0; i < channelData.length; i++) {
        chunkBuffer.push(channelData[i]);
      }
      totalSamples += channelData.length;

      // 🔒 非阻塞處理：只在沒有正在處理的 chunk 時觸發
      if (!isProcessingChunk && chunkBuffer.length >= chunkSamples) {
        processNextChunk(chunkSamples, overlapSamples, stepSamples);
      }
    };

    // 連接節點
    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    console.log('[Offscreen] 音訊處理管線已建立');

    sendResponse({ success: true });
  } catch (error) {
    console.error('[Offscreen] 音訊擷取失敗:', error);
    stopAudioCapture();
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 非阻塞處理下一個 chunk
 */
async function processNextChunk(chunkSamples, overlapSamples, stepSamples) {
  isProcessingChunk = true;

  try {
    // 處理所有累積的 chunks（但不阻塞 onaudioprocess）
    while (chunkBuffer.length >= chunkSamples) {
      await extractAndEncodeChunk(chunkSamples, overlapSamples, stepSamples);
    }
  } finally {
    isProcessingChunk = false;
  }
}

/**
 * 從緩衝區提取一個 chunk 並編碼為 MP3
 */
async function extractAndEncodeChunk(chunkSamples, overlapSamples, stepSamples) {
  // 取出 chunk
  const samples = chunkBuffer.slice(0, chunkSamples);

  // 計算時間戳
  const startTime = chunkIndex * (stepSamples / AUDIO_CONFIG.SAMPLE_RATE);
  const endTime = startTime + CHUNK_CONFIG.CHUNK_DURATION;

  console.log(`[Offscreen] 提取 Chunk ${chunkIndex}`, {
    startTime: startTime.toFixed(2),
    endTime: endTime.toFixed(2),
    samples: samples.length,
  });

  try {
    // 初始化 Worker (如果需要)
    if (!mp3Worker) {
      initWorker();
    }

    // 編碼為 MP3
    const requestId = requestIdCounter++;
    const resultPromise = new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
    });

    mp3Worker.postMessage({
      type: 'ENCODE',
      requestId,
      data: {
        samples: new Float32Array(samples),
        sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
      },
    });

    const result = await resultPromise;

    console.log(`[Offscreen] Chunk ${chunkIndex} 編碼完成，大小: ${result.size} bytes`);

    // 發送編碼結果給 Service Worker
    chrome.runtime.sendMessage({
      type: 'AUDIO_CHUNK_READY',
      data: {
        chunkIndex,
        startTime,
        endTime,
        blob: result.blob,
        size: result.size,
        duration: result.duration,
      },
    });

    // 移除已處理的樣本 (保留重疊部分)
    chunkBuffer.splice(0, stepSamples);
    chunkIndex++;
  } catch (error) {
    console.error(`[Offscreen] Chunk ${chunkIndex} 編碼失敗:`, error);
    // 繼續處理下一個 chunk
  }
}

/**
 * 處理音訊擷取停止請求
 */
function handleStopAudioCapture(sendResponse) {
  try {
    stopAudioCapture();
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Offscreen] 停止音訊擷取失敗:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 停止音訊擷取並清理資源
 */
function stopAudioCapture() {
  console.log('[Offscreen] 停止音訊擷取');

  // 斷開音訊節點
  if (processorNode) {
    processorNode.disconnect();
    processorNode.onaudioprocess = null;
    processorNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  // 停止 MediaStream
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  // 關閉 AudioContext
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }

  // 重設狀態
  chunkBuffer = [];
  chunkIndex = 0;
  totalSamples = 0;
  isProcessingChunk = false;
}

console.log('[Offscreen] Offscreen document 已載入');
