/**
 * PCM AudioWorklet Processor - Deepgram 即時音訊處理
 *
 * 功能：
 * 1. 接收 48kHz stereo 音訊（瀏覽器預設）
 * 2. 重採樣至 16kHz mono（Deepgram 要求）
 * 3. 轉換為 linear16 PCM 格式
 * 4. 以 20ms frames 發送到主執行緒
 *
 * @author Claude (AI Coding Assistant)
 * @date 2025-11-16
 */

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // 音訊參數
    this.inputSampleRate = sampleRate; // 瀏覽器提供（通常 48000）
    this.outputSampleRate = 16000; // Deepgram 要求
    this.channels = 1; // Mono

    // 重採樣參數
    this.resampleRatio = this.inputSampleRate / this.outputSampleRate;
    this.resampleBuffer = [];
    this.resamplePosition = 0;

    // Frame buffer (20ms = 320 samples at 16kHz)
    this.frameSize = Math.floor(this.outputSampleRate * 0.02); // 320 samples
    this.frameBuffer = new Float32Array(this.frameSize);
    this.frameBufferIndex = 0;

    // 統計
    this.totalSamples = 0;
    this.totalFrames = 0;

    console.log('[PCMProcessor] 初始化', {
      inputSampleRate: this.inputSampleRate,
      outputSampleRate: this.outputSampleRate,
      resampleRatio: this.resampleRatio.toFixed(2),
      frameSize: this.frameSize,
    });
  }

  /**
   * 處理音訊 frame（128 samples per call）
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // 如果沒有輸入，返回 true 繼續運行
    if (!input || input.length === 0) {
      return true;
    }

    // 取得第一個聲道（stereo → mono：只取 left channel）
    const inputChannel = input[0];

    if (!inputChannel || inputChannel.length === 0) {
      return true;
    }

    this.totalSamples += inputChannel.length;

    // 重採樣並緩衝
    for (let i = 0; i < inputChannel.length; i++) {
      this.resampleBuffer.push(inputChannel[i]);

      // 當累積足夠 samples 可產生一個輸出 sample
      while (this.resampleBuffer.length >= this.resampleRatio) {
        const outputSample = this.linearInterpolate();

        // 添加到 frame buffer
        this.frameBuffer[this.frameBufferIndex++] = outputSample;

        // 當 frame buffer 滿時，轉換並發送
        if (this.frameBufferIndex >= this.frameSize) {
          this.sendPCMFrame();
          this.frameBufferIndex = 0;
        }
      }
    }

    return true; // 繼續處理
  }

  /**
   * 線性插值重採樣
   */
  linearInterpolate() {
    if (this.resampleBuffer.length < 2) {
      return this.resampleBuffer.shift() || 0;
    }

    const fraction = this.resamplePosition % 1;
    const index = Math.floor(this.resamplePosition);

    const sample1 = this.resampleBuffer[index] || 0;
    const sample2 = this.resampleBuffer[index + 1] || 0;

    const interpolated = sample1 + (sample2 - sample1) * fraction;

    this.resamplePosition += this.resampleRatio;

    // 移除已使用的 samples
    while (this.resamplePosition >= 1.0 && this.resampleBuffer.length > 0) {
      this.resampleBuffer.shift();
      this.resamplePosition -= 1.0;
    }

    return interpolated;
  }

  /**
   * 轉換 Float32 PCM → Int16 PCM 並發送到主執行緒
   */
  sendPCMFrame() {
    // Float32 [-1.0, 1.0] → Int16 [-32768, 32767]
    const int16Buffer = new Int16Array(this.frameSize);

    for (let i = 0; i < this.frameSize; i++) {
      const float = this.frameBuffer[i];
      // Clamp to [-1.0, 1.0] and convert
      const clamped = Math.max(-1, Math.min(1, float));
      int16Buffer[i] = Math.floor(clamped * 32767);
    }

    // 轉換為 ArrayBuffer 發送
    const arrayBuffer = int16Buffer.buffer.slice(0);

    this.totalFrames++;

    // 發送到主執行緒
    this.port.postMessage({
      type: 'PCM_FRAME',
      data: arrayBuffer,
      frameIndex: this.totalFrames,
      sampleCount: this.frameSize,
      sampleRate: this.outputSampleRate,
    }, [arrayBuffer]); // Transferable object

    // 每 100 frames 輸出統計（避免 console 污染）
    if (this.totalFrames % 100 === 0) {
      this.port.postMessage({
        type: 'STATS',
        stats: {
          totalFrames: this.totalFrames,
          totalSamples: this.totalSamples,
          resampleBufferSize: this.resampleBuffer.length,
        },
      });
    }
  }
}

// 註冊 AudioWorkletProcessor
registerProcessor('pcm-processor', PCMProcessor);
