/**
 * MP3 Encoder Web Worker
 *
 * 使用 lamejs 將 PCM 音訊編碼為 MP3 格式
 * 在 Worker 中執行避免阻塞主執行緒
 */

import lamejs from 'lamejs';

const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BITRATE: 128,
  MP3_MODE: 3, // 單聲道
};

/**
 * 將 Float32Array 轉換為 Int16Array (PCM 格式)
 */
function floatTo16BitPCM(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // 將 -1.0 ~ 1.0 的浮點數轉換為 -32768 ~ 32767 的整數
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * 編碼音訊為 MP3
 */
function encodeMP3(samples) {
  const pcmData = floatTo16BitPCM(samples);

  // 初始化 MP3 編碼器
  const mp3encoder = new lamejs.Mp3Encoder(
    AUDIO_CONFIG.CHANNELS,
    AUDIO_CONFIG.SAMPLE_RATE,
    AUDIO_CONFIG.BITRATE
  );

  const mp3Data = [];
  const sampleBlockSize = 1152; // MP3 frame size

  // 分塊編碼
  for (let i = 0; i < pcmData.length; i += sampleBlockSize) {
    const sampleChunk = pcmData.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);

    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  // 完成編碼
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  // 合併所有 MP3 數據
  const totalLength = mp3Data.reduce((acc, buf) => acc + buf.length, 0);
  const mergedArray = new Uint8Array(totalLength);
  let offset = 0;

  for (const buf of mp3Data) {
    mergedArray.set(buf, offset);
    offset += buf.length;
  }

  return mergedArray;
}

/**
 * Worker 訊息處理
 */
self.addEventListener('message', (event) => {
  const { id, type, data } = event.data;

  if (type === 'encode') {
    try {
      const startTime = performance.now();

      // 編碼
      const mp3Data = encodeMP3(data.samples);

      // 建立 Blob
      const blob = new Blob([mp3Data], { type: 'audio/mp3' });

      const duration = performance.now() - startTime;

      // 回傳結果
      self.postMessage({
        id,
        type: 'success',
        data: {
          blob,
          size: blob.size,
          duration,
        },
      });

      console.log(`[MP3 Worker] 編碼完成`, {
        inputSamples: data.samples.length,
        outputSize: blob.size,
        duration: duration.toFixed(2) + 'ms',
      });
    } catch (error) {
      self.postMessage({
        id,
        type: 'error',
        error: {
          message: error.message,
          stack: error.stack,
        },
      });
    }
  }
});

// Worker 就緒通知
self.postMessage({ type: 'ready' });
