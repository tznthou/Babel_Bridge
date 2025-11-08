/**
 * AudioChunker 單元測試
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AudioChunker } from '../../src/background/audio-chunker.js';

describe('AudioChunker', () => {
  let mockAudioContext;
  let chunker;

  beforeEach(() => {
    // Mock AudioContext
    mockAudioContext = {
      sampleRate: 16000,
      currentTime: 0,
      createScriptProcessor: () => ({
        connect: () => {},
        disconnect: () => {},
      }),
    };

    chunker = new AudioChunker(mockAudioContext);
  });

  it('應該正確初始化', () => {
    expect(chunker.sampleRate).toBe(16000);
    expect(chunker.chunkIndex).toBe(0);
    expect(chunker.buffer).toEqual([]);
  });

  it('應該正確計算 chunk 樣本數', () => {
    // 3 秒 @ 16kHz = 48000 samples
    expect(chunker.chunkSamples).toBe(48000);
  });

  it('應該正確計算重疊樣本數', () => {
    // 1 秒 @ 16kHz = 16000 samples
    expect(chunker.overlapSamples).toBe(16000);
  });

  it('應該正確計算步進樣本數', () => {
    // 3 - 1 = 2 秒 @ 16kHz = 32000 samples
    expect(chunker.stepSamples).toBe(32000);
  });

  it('getStats 應該回傳正確統計', () => {
    const stats = chunker.getStats();

    expect(stats).toHaveProperty('totalChunks');
    expect(stats).toHaveProperty('bufferSamples');
    expect(stats).toHaveProperty('bufferDuration');
    expect(stats).toHaveProperty('totalDuration');

    expect(stats.totalChunks).toBe(0);
    expect(stats.bufferSamples).toBe(0);
  });
});
