/**
 * Offscreen Document - Deepgram AudioWorklet PCM 音訊處理
 *
 * Manifest V3 限制：
 * - Service Worker 不支援 MediaStream / AudioContext
 * - 需在 Offscreen Document 取得音訊並處理
 *
 * Deepgram 流程（即時串流）：
 * Service Worker → getMediaStreamId() → streamId
 * → Offscreen Document (AudioWorklet) → PCM linear16 frames (20ms)
 * → Service Worker → DeepgramStreamClient → WebSocket
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-11-16
 */

// === 狀態 ===
let mediaStream = null;
let audioContext = null;
let workletNode = null;
let sourceNode = null;
let isProcessing = false;
let frameCount = 0;

/**
 * 處理來自 Service Worker 的訊息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  console.log('[Offscreen Deepgram] 收到訊息:', type);

  switch (type) {
    case 'OFFSCREEN_START_AUDIO_CAPTURE':
      handleStartAudioCapture(data, sendResponse);
      return true; // 異步回應

    case 'OFFSCREEN_STOP_AUDIO_CAPTURE':
      handleStopAudioCapture(sendResponse);
      return true;

    default:
      console.warn('[Offscreen Deepgram] 未知訊息類型:', type);
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

/**
 * 開始音訊擷取與 PCM 轉換
 */
async function handleStartAudioCapture(captureData, sendResponse) {
  console.log('[Offscreen Deepgram] ========================================');
  console.log('[Offscreen Deepgram] 🎙️ 開始音訊擷取（AudioWorklet PCM）');
  console.log('[Offscreen Deepgram] ========================================');

  try {
    const { streamId, tabId, videoStartTime } = captureData;

    console.log('[Offscreen Deepgram] StreamID:', streamId);
    console.log('[Offscreen Deepgram] TabID:', tabId);
    console.log('[Offscreen Deepgram] 影片起始時間:', videoStartTime, 's');

    // 清理舊資源
    await stopAudioCapture();

    // 1. 取得 tab 音訊串流
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          suppressLocalAudioPlayback: true, // 避免回音
        },
      },
    });

    console.log('[Offscreen Deepgram] ✅ MediaStream 已取得');

    // 2. 建立 AudioContext (48kHz 預設)
    audioContext = new AudioContext();

    console.log('[Offscreen Deepgram] 🎵 AudioContext 建立', {
      sampleRate: audioContext.sampleRate,
      state: audioContext.state,
    });

    // 3. 載入 AudioWorklet 模組
    await audioContext.audioWorklet.addModule(
      chrome.runtime.getURL('src/offscreen/pcm-processor.js')
    );

    console.log('[Offscreen Deepgram] ✅ PCM processor 已載入');

    // 4. 建立 AudioWorklet 節點
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    // 5. 監聽 PCM frames
    workletNode.port.onmessage = (event) => {
      handlePCMFrame(event.data, tabId);
    };

    // 6. 連接音訊管線: Source → Worklet (不需要連到 Destination)
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    sourceNode.connect(workletNode);

    isProcessing = true;
    frameCount = 0;

    console.log('[Offscreen Deepgram] ✅ 音訊管線已建立（48kHz → 16kHz PCM）');

    sendResponse({ success: true });
  } catch (error) {
    console.error('[Offscreen Deepgram] ❌ 啟動失敗:', error);
    await stopAudioCapture();
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 處理 PCM frame（來自 AudioWorklet）
 */
function handlePCMFrame(frameData, tabId) {
  const { type, data, frameIndex, sampleCount, sampleRate } = frameData;

  if (type === 'PCM_FRAME') {
    frameCount++;

    // 只在首次和每 100 frames 記錄（避免 console 污染）
    if (frameCount === 1 || frameCount % 100 === 0) {
      console.log('[Offscreen Deepgram] 🎵 PCM Frame', {
        frameIndex,
        sampleCount,
        sampleRate,
        byteLength: data.byteLength,
        frameCount,
      });
    }

    // 轉發到 Service Worker → DeepgramStreamClient
    chrome.runtime.sendMessage({
      type: 'DEEPGRAM_PCM_FRAME',
      data: {
        pcmData: data, // ArrayBuffer (Int16)
        frameIndex,
        sampleCount,
        sampleRate,
        tabId,
      },
    }).catch((error) => {
      console.error('[Offscreen Deepgram] ❌ 轉發 PCM frame 失敗:', error);
    });
  } else if (type === 'STATS') {
    // 統計資訊
    console.log('[Offscreen Deepgram] 📊 統計:', frameData.stats);
  }
}

/**
 * 停止音訊擷取
 */
function handleStopAudioCapture(sendResponse) {
  stopAudioCapture()
    .then(() => sendResponse({ success: true }))
    .catch((error) => {
      console.error('[Offscreen Deepgram] ❌ 停止失敗:', error);
      sendResponse({ success: false, error: error.message });
    });
}

async function stopAudioCapture() {
  console.log('[Offscreen Deepgram] 🛑 停止音訊擷取');

  isProcessing = false;

  // 斷開音訊節點
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (error) {
      console.warn('[Offscreen Deepgram] sourceNode disconnect 錯誤:', error.message);
    }
    sourceNode = null;
  }

  if (workletNode) {
    try {
      workletNode.disconnect();
      workletNode.port.onmessage = null;
    } catch (error) {
      console.warn('[Offscreen Deepgram] workletNode disconnect 錯誤:', error.message);
    }
    workletNode = null;
  }

  // 關閉 AudioContext
  if (audioContext) {
    try {
      await audioContext.close();
    } catch (error) {
      console.warn('[Offscreen Deepgram] AudioContext close 錯誤:', error.message);
    }
    audioContext = null;
  }

  // 停止 MediaStream
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  frameCount = 0;

  console.log('[Offscreen Deepgram] ✅ 已清理所有資源');
}

console.log('[Offscreen Deepgram] ========================================');
console.log('[Offscreen Deepgram] 🚀 Deepgram offscreen document 已載入');
console.log('[Offscreen Deepgram] AudioWorklet PCM processing ready');
console.log('[Offscreen Deepgram] UserAgent:', navigator.userAgent);
console.log('[Offscreen Deepgram] ========================================');
