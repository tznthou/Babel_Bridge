/**
 * Offscreen Document - 以 MediaRecorder 擷取 tab 音訊
 *
 * Manifest V3 限制：
 * - Service Worker 不支援 MediaStream / AudioContext
 * - 需在 Offscreen Document 取得音訊並以非阻塞方式切片
 *
 * 新流程：
 * Service Worker → getMediaStreamId() → streamId
 * → Offscreen Document (MediaRecorder) → audio/webm chunk
 * → Service Worker → Whisper API
 */

// === 狀態 ===
let mediaStream = null;
let mediaRecorder = null;
let playbackElement = null;
let chunkIndex = 0;
let captureStartMs = 0;
let lastChunkTimestampMs = 0;
let accumulatedDuration = 0;
let activeMimeType = 'audio/webm;codecs=opus';

const CHUNK_CONFIG = {
  CHUNK_DURATION: 3, // 3 秒 timeslice
};

const RECORDER_PREFERENCES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

/**
 * 選擇第一個被瀏覽器支援的 MediaRecorder MIME 類型
 */
function resolveMimeType() {
  for (const candidate of RECORDER_PREFERENCES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * 處理來自 Service Worker 的訊息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  console.log('[Offscreen] 收到訊息:', type);

  switch (type) {
    case 'OFFSCREEN_START_AUDIO_CAPTURE':
      handleStartAudioCapture(data, sendResponse);
      return true; // 異步回應

    case 'OFFSCREEN_STOP_AUDIO_CAPTURE':
      handleStopAudioCapture(sendResponse);
      return true;

    default:
      console.warn('[Offscreen] 未知訊息類型:', type);
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

/**
 * 開始音訊擷取
 */
async function handleStartAudioCapture(captureData, sendResponse) {
  console.log('[Offscreen] ========================================');
  console.log('[Offscreen] 🎙️ handleStartAudioCapture');
  console.log('[Offscreen] ========================================');

  try {
    const { streamId, tabId } = captureData;

    console.log('[Offscreen] StreamID:', streamId);
    console.log('[Offscreen] TabID:', tabId);

    await stopAudioCapture();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          suppressLocalAudioPlayback: true,
        },
      },
    });

    console.log('[Offscreen] ✅ MediaStream 已取得');

    const mimeType = resolveMimeType();
    activeMimeType = mimeType || 'audio/webm';

    const recorderOptions = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 };
    mediaRecorder = new MediaRecorder(mediaStream, recorderOptions);

    resetRecorderState();
    wireRecorderEvents(tabId);

    mediaRecorder.start(CHUNK_CONFIG.CHUNK_DURATION * 1000);

    console.log('[Offscreen] ✅ MediaRecorder 已啟動，timeslice:', CHUNK_CONFIG.CHUNK_DURATION, 's');
    ensurePlaybackMirror();
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Offscreen] ❌ 無法啟動音訊擷取:', error);
    await stopAudioCapture();
    sendResponse({ success: false, error: error.message });
  }
}

function resetRecorderState() {
  chunkIndex = 0;
  captureStartMs = performance.now();
  lastChunkTimestampMs = captureStartMs;
  accumulatedDuration = 0;
}

function wireRecorderEvents(tabId) {
  mediaRecorder.onstart = () => {
    console.log('[Offscreen] 🎬 MediaRecorder onstart (Tab', tabId, ')');
  };

  mediaRecorder.onerror = (event) => {
    console.error('[Offscreen] ❌ MediaRecorder 錯誤:', event.error);
  };

  mediaRecorder.onstop = () => {
    console.log('[Offscreen] ⏹️ MediaRecorder 已停止');
    stopPlaybackMirror();
  };

  mediaRecorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0) {
      return;
    }

    const now = performance.now();
    const durationSeconds = Math.max(0.1, (now - lastChunkTimestampMs) / 1000);
    const startTime = accumulatedDuration;
    const endTime = startTime + durationSeconds;

    lastChunkTimestampMs = now;
    accumulatedDuration = endTime;

    const mimeType = event.data.type || activeMimeType;
    const blobSize = event.data.size;

    console.log('[Offscreen] 🎧 Chunk 準備完成', {
      chunkIndex,
      size: `${(blobSize / 1024).toFixed(2)} KB`,
      duration: durationSeconds.toFixed(2) + 's',
      mimeType,
    });

    const currentChunkIndex = chunkIndex;
    chunkIndex += 1;

    event.data.arrayBuffer()
      .then((arrayBuffer) => {
        const base64Audio = arrayBufferToBase64(arrayBuffer);

        const payload = {
          chunkIndex: currentChunkIndex,
          startTime,
          endTime,
          audioBase64: base64Audio,
          audioByteLength: arrayBuffer.byteLength,
          size: blobSize,
          duration: durationSeconds,
          mimeType,
          tabId,
        };

        const sendPromise = chrome.runtime.sendMessage({
          type: 'AUDIO_CHUNK_READY',
          data: payload,
        });

        if (sendPromise && typeof sendPromise.catch === 'function') {
          sendPromise.catch((err) => {
            console.error('[Offscreen] ❌ 傳送 chunk 失敗:', err);
          });
        }
      })
      .catch((error) => {
        console.error('[Offscreen] ❌ 轉換音訊資料失敗:', error);
      });
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const subArray = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, subArray);
  }

  return btoa(binary);
}

/**
 * 停止音訊擷取
 */
function handleStopAudioCapture(sendResponse) {
  stopAudioCapture()
    .then(() => sendResponse({ success: true }))
    .catch((error) => {
      console.error('[Offscreen] ❌ 停止音訊擷取失敗:', error);
      sendResponse({ success: false, error: error.message });
    });
}

async function stopAudioCapture() {
  console.log('[Offscreen] 🛑 stopAudioCapture');

  stopPlaybackMirror();

  if (mediaRecorder) {
    if (mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (error) {
        console.warn('[Offscreen] 停止 MediaRecorder 時發生錯誤:', error.message);
      }
    }
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onerror = null;
    mediaRecorder.onstart = null;
    mediaRecorder.onstop = null;
    mediaRecorder = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  chunkIndex = 0;
  accumulatedDuration = 0;
}

console.log('[Offscreen] ========================================');
console.log('[Offscreen] 🚀 Offscreen document 已載入 (MediaRecorder)');
console.log('[Offscreen] UserAgent:', navigator.userAgent);
console.log('[Offscreen] ========================================');

function ensurePlaybackMirror() {
  if (!mediaStream) {
    return;
  }

  if (playbackElement) {
    playbackElement.srcObject = mediaStream;
    return;
  }

  playbackElement = new Audio();
  playbackElement.srcObject = mediaStream;
  playbackElement.autoplay = true;
  playbackElement.playsInline = true;
  playbackElement.volume = 1;
  playbackElement.muted = false;

  const playPromise = playbackElement.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch((error) => {
      console.warn('[Offscreen] ⚠️ Audio mirror 無法播放:', error.message);
    });
  }
}

function stopPlaybackMirror() {
  if (!playbackElement) {
    return;
  }

  try {
    playbackElement.pause();
  } catch (error) {
    console.warn('[Offscreen] 停止 Audio mirror 錯誤:', error.message);
  }

  playbackElement.srcObject = null;
  playbackElement = null;
}
