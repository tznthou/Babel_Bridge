/**
 * AudioChunker - 實作 Rolling Window 音訊切塊策略
 *
 * 核心概念:
 * ┌─────────┬─────────┐
 * │ Chunk 1 │         │
 * └─────────┴─────────┘
 *      ┌─────────┬─────────┐
 *      │ Overlap │ Chunk 2 │
 *      └─────────┴─────────┘
 *           ┌─────────┬─────────┐
 *           │ Overlap │ Chunk 3 │
 *           └─────────┴─────────┘
 *
 * 每個 chunk 包含:
 * - 主體部分 (2秒)
 * - 前重疊區 (1秒,與前一 chunk 重複)
 * - 後重疊區 (1秒,與下一 chunk 重複)
 */
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js';
import { AUDIO_CONFIG, CHUNK_CONFIG } from '../lib/config.js';

export class AudioChunker {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.sampleRate = AUDIO_CONFIG.SAMPLE_RATE;

    // 計算樣本數
    this.chunkSamples = this.sampleRate * CHUNK_CONFIG.CHUNK_DURATION;
    this.overlapSamples = this.sampleRate * CHUNK_CONFIG.OVERLAP_DURATION;
    this.stepSamples = this.chunkSamples - this.overlapSamples;

    // 緩衝區
    this.buffer = [];
    this.totalSamples = 0;
    this.chunkIndex = 0;

    // 時間戳追蹤
    this.startTime = 0;

    console.log('[AudioChunker] 初始化完成', {
      chunkDuration: CHUNK_CONFIG.CHUNK_DURATION,
      overlapDuration: CHUNK_CONFIG.OVERLAP_DURATION,
      chunkSamples: this.chunkSamples,
      overlapSamples: this.overlapSamples,
      stepSamples: this.stepSamples,
    });
  }

  /**
   * 開始處理音訊串流
   * @param {MediaStreamAudioSourceNode} sourceNode
   * @param {Function} onChunkReady - 當一個 chunk 準備好時的回調
   */
  start(sourceNode, onChunkReady) {
    this.startTime = this.audioContext.currentTime;
    this.onChunkReady = onChunkReady;

    // 使用 ScriptProcessorNode 處理音訊
    // bufferSize: 4096 samples (約 256ms @ 16kHz)
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      this.processAudioData(event.inputBuffer);
    };

    // 連接節點
    sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);

    console.log('[AudioChunker] 開始處理音訊串流');
  }

  /**
   * 停止處理
   */
  stop() {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    // 處理剩餘的緩衝區
    if (this.buffer.length > 0) {
      this.flushBuffer();
    }

    console.log('[AudioChunker] 已停止處理');
  }

  /**
   * 處理音訊數據
   * @private
   */
  processAudioData(audioBuffer) {
    // 取得第一聲道數據
    const channelData = audioBuffer.getChannelData(0);

    // 加入緩衝區
    this.buffer.push(...channelData);
    this.totalSamples += channelData.length;

    // 檢查是否累積足夠的樣本
    while (this.buffer.length >= this.chunkSamples) {
      this.extractChunk();
    }
  }

  /**
   * 從緩衝區提取一個 chunk
   * @private
   */
  extractChunk() {
    // 取出 chunkSamples 數量的樣本
    const samples = this.buffer.slice(0, this.chunkSamples);

    // 計算時間戳
    const startTime = this.chunkIndex * (this.stepSamples / this.sampleRate);
    const endTime = startTime + CHUNK_CONFIG.CHUNK_DURATION;

    // 建立 AudioBuffer
    const audioBuffer = this.audioContext.createBuffer(
      AUDIO_CONFIG.CHANNELS,
      samples.length,
      this.sampleRate
    );
    audioBuffer.getChannelData(0).set(samples);

    // 建立 chunk 資料結構
    const chunk = {
      index: this.chunkIndex,
      audioBuffer,
      samples: new Float32Array(samples),
      startTime,
      endTime,
      overlapStart: 0,
      overlapEnd: this.overlapSamples / this.sampleRate,
    };

    // 如果不是第一個 chunk,設定前重疊區
    if (this.chunkIndex > 0) {
      chunk.overlapStart = this.overlapSamples / this.sampleRate;
    }

    console.log(`[AudioChunker] Chunk ${this.chunkIndex} 準備完成`, {
      startTime: startTime.toFixed(2),
      endTime: endTime.toFixed(2),
      samples: samples.length,
    });

    // 觸發回調
    if (this.onChunkReady) {
      this.onChunkReady(chunk);
    }

    // 移除已處理的樣本 (保留重疊部分)
    this.buffer.splice(0, this.stepSamples);
    this.chunkIndex++;
  }

  /**
   * 處理剩餘的緩衝區 (影片結束時調用)
   * @private
   */
  flushBuffer() {
    if (this.buffer.length < this.sampleRate * CHUNK_CONFIG.MIN_CHUNK_DURATION) {
      console.log('[AudioChunker] 剩餘樣本過少,不處理');
      return;
    }

    const samples = [...this.buffer];
    const startTime = this.chunkIndex * (this.stepSamples / this.sampleRate);
    const duration = samples.length / this.sampleRate;

    const audioBuffer = this.audioContext.createBuffer(
      AUDIO_CONFIG.CHANNELS,
      samples.length,
      this.sampleRate
    );
    audioBuffer.getChannelData(0).set(samples);

    const chunk = {
      index: this.chunkIndex,
      audioBuffer,
      samples: new Float32Array(samples),
      startTime,
      endTime: startTime + duration,
      overlapStart: this.chunkIndex > 0 ? this.overlapSamples / this.sampleRate : 0,
      overlapEnd: 0, // 最後一個 chunk 沒有後重疊區
      isLast: true,
    };

    console.log('[AudioChunker] 處理最後一個 chunk', {
      startTime: startTime.toFixed(2),
      duration: duration.toFixed(2),
    });

    if (this.onChunkReady) {
      this.onChunkReady(chunk);
    }

    this.buffer = [];
  }

  /**
   * 重設狀態
   */
  reset() {
    this.buffer = [];
    this.totalSamples = 0;
    this.chunkIndex = 0;
    this.startTime = 0;
  }

  /**
   * 取得處理統計
   */
  getStats() {
    return {
      totalChunks: this.chunkIndex,
      bufferSamples: this.buffer.length,
      bufferDuration: (this.buffer.length / this.sampleRate).toFixed(2),
      totalDuration: (this.totalSamples / this.sampleRate).toFixed(2),
    };
  }
}
