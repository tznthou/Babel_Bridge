/**
 * OverlapProcessor - 音訊段重疊處理與斷句優化
 *
 * 負責處理 Whisper API 辨識結果的重疊區比對、去重與斷句優化。
 * 使用 Rolling Window 策略處理連續音訊段，避免句子被切斷。
 *
 * 參考專案（授權合規）：
 * - tokenx (MIT): Overlap 管理策略
 * - WhisperJAV (MIT): 字幕去重邏輯
 * - srt (MIT): 字幕處理工具
 *
 * @module subtitle-processor
 * @license MIT
 */

import { calculateSimilarity, quickSimilarityCheck } from '../lib/text-similarity.js'
import { BabelBridgeError, ErrorCodes } from '../lib/errors.js'
import { LanguageRules } from '../lib/language-rules.js'

/**
 * OverlapProcessor 類別
 *
 * 處理連續音訊段的 Whisper 辨識結果：
 * 1. 調整時間戳為絕對時間
 * 2. 比對重疊區的 segments（時間戳 + 文字相似度）
 * 3. 移除重複的 segments
 * 4. 合併破碎的句子
 *
 * @class
 */
export class OverlapProcessor {
  /**
   * 建立 OverlapProcessor 實例
   *
   * @param {Object} [config={}] - 配置選項
   * @param {number} [config.overlapDuration=1000] - 重疊區時長（毫秒）
   * @param {number} [config.similarityThreshold=0.8] - 文字相似度閾值（0-1）
   * @param {number} [config.mergeTimeGap=0.3] - 句子合併時間間隔閾值（秒）
   * @param {number} [config.maxCompareLength=100] - 文字比對最大長度（效能優化）
   * @param {boolean} [config.debug=false] - 是否啟用 Debug 模式
   */
  constructor(config = {}) {
    this.config = {
      overlapDuration: config.overlapDuration || 1000,      // 1 秒重疊
      similarityThreshold: config.similarityThreshold || 0.8, // 80% 相似度
      mergeTimeGap: config.mergeTimeGap || 0.3,             // 0.3 秒間隔
      maxCompareLength: config.maxCompareLength || 100,     // 比對前 100 字元
      debug: config.debug || false,
      ...config
    }

    /** @type {Array<Segment>|null} 上一段的 segments */
    this.previousSegments = null

    /** @type {Array<Segment>} 已處理的所有 segments */
    this.processedSegments = []

    /** @type {number} 處理的音訊段計數 */
    this.chunkCount = 0

    this._log('OverlapProcessor initialized with config:', this.config)
  }

  /**
   * 處理新的 Whisper API 回應
   *
   * @param {WhisperResponse} response - Whisper API 回應
   * @param {number} chunkStartTime - 該音訊段的開始時間（秒）
   * @returns {Array<Segment>} 去重後的新 segments
   * @throws {BabelBridgeError} 如果輸入格式無效
   *
   * @example
   * const processor = new OverlapProcessor()
   * const newSegments = processor.process(whisperResponse, 0.0)
   */
  process(response, chunkStartTime) {
    this.chunkCount++

    // 驗證輸入
    if (!response || !response.segments) {
      throw new BabelBridgeError(
        ErrorCodes.INVALID_INPUT,
        'Invalid Whisper response: missing segments',
        { response, chunkStartTime }
      )
    }

    this._log(`\n=== Processing Chunk #${this.chunkCount} (start: ${chunkStartTime}s) ===`)
    this._log(`Raw segments count: ${response.segments.length}`)

    // 1. 調整 segments 的時間戳為絕對時間
    const adjustedSegments = this._adjustTimestamps(
      response.segments,
      chunkStartTime
    )

    this._log(`Adjusted segments: ${adjustedSegments.length}`)

    // 2. 如果是第一段，直接返回
    if (!this.previousSegments) {
      this._log('First chunk - returning all segments')
      this.previousSegments = adjustedSegments
      this.processedSegments = [...adjustedSegments]
      return adjustedSegments
    }

    // 3. 處理重疊區
    const newSegments = this._processOverlap(
      this.previousSegments,
      adjustedSegments,
      chunkStartTime
    )

    this._log(`New segments after deduplication: ${newSegments.length}`)

    // 4. 更新狀態
    this.previousSegments = adjustedSegments
    this.processedSegments.push(...newSegments)

    return newSegments
  }

  /**
   * 調整 segments 的時間戳為絕對時間
   *
   * Whisper API 回傳的時間戳是相對於音訊段開始的相對時間。
   * 需要加上 chunkStartTime 轉換為整個影片的絕對時間。
   *
   * @private
   * @param {Array<Segment>} segments - Whisper 回傳的 segments
   * @param {number} chunkStartTime - 音訊段開始時間（秒）
   * @returns {Array<Segment>} 調整後的 segments
   */
  _adjustTimestamps(segments, chunkStartTime) {
    return segments.map(seg => ({
      ...seg,
      start: seg.start + chunkStartTime,
      end: seg.end + chunkStartTime,
      _originalStart: seg.start,  // 保留原始時間戳供 debug
      _originalEnd: seg.end
    }))
  }

  /**
   * 處理重疊區邏輯（核心方法）
   *
   * 比對相鄰音訊段的重疊區 segments：
   * 1. 找出重疊區的 segments
   * 2. 計算時間戳重疊度 + 文字相似度
   * 3. 標記重複的 segments
   * 4. 過濾並返回非重複的 segments
   *
   * @private
   * @param {Array<Segment>} previousSegments - 上一段的 segments
   * @param {Array<Segment>} currentSegments - 當前段的 segments
   * @param {number} chunkStartTime - 當前段開始時間（秒）
   * @returns {Array<Segment>} 去重後的新 segments
   */
  _processOverlap(previousSegments, currentSegments, chunkStartTime) {
    const overlapStart = chunkStartTime
    const overlapEnd = chunkStartTime + (this.config.overlapDuration / 1000)

    this._log(`Overlap region: ${overlapStart.toFixed(2)}s - ${overlapEnd.toFixed(2)}s`)

    // 1. 找出重疊區的 segments
    const prevOverlap = previousSegments.filter(seg =>
      seg.end > overlapStart && seg.start < overlapEnd
    )
    const currOverlap = currentSegments.filter(seg =>
      seg.start < overlapEnd && seg.end > overlapStart
    )

    this._log(`Previous overlap segments: ${prevOverlap.length}`)
    this._log(`Current overlap segments: ${currOverlap.length}`)

    if (this.config.debug) {
      prevOverlap.forEach(seg => {
        this._log(`  [Prev] ${seg.start.toFixed(2)}s-${seg.end.toFixed(2)}s: "${seg.text}"`)
      })
      currOverlap.forEach(seg => {
        this._log(`  [Curr] ${seg.start.toFixed(2)}s-${seg.end.toFixed(2)}s: "${seg.text}"`)
      })
    }

    // 2. 找出重複的 segments（在 currentSegments 中的索引）
    const duplicateIndices = this._findDuplicates(prevOverlap, currOverlap, currentSegments)

    this._log(`Duplicate segments found: ${duplicateIndices.size}`)

    // 3. 過濾掉重複的 segments
    const newSegments = currentSegments.filter((seg, idx) => {
      // 如果在重疊區之外，直接保留
      if (seg.start >= overlapEnd) return true

      // 如果在重疊區內，檢查是否重複
      return !duplicateIndices.has(idx)
    })

    return newSegments
  }

  /**
   * 找出重複的 segments
   *
   * 比對策略（參考 WhisperJAV 與 srt 的去重邏輯）：
   * 1. 時間戳重疊檢查：計算兩個 segment 的時間重疊長度
   * 2. 文字相似度檢查：使用 Levenshtein Distance 計算相似度
   * 3. 綜合判斷：時間戳重疊 > 50% 且文字相似度 > 閾值 → 標記為重複
   *
   * @private
   * @param {Array<Segment>} prevOverlap - 上一段重疊區的 segments
   * @param {Array<Segment>} currOverlap - 當前段重疊區的 segments
   * @param {Array<Segment>} allCurrentSegments - 當前段所有 segments（用於找索引）
   * @returns {Set<number>} 重複 segment 的索引集合（在 allCurrentSegments 中的索引）
   */
  _findDuplicates(prevOverlap, currOverlap, allCurrentSegments) {
    const duplicates = new Set()

    for (let i = 0; i < currOverlap.length; i++) {
      const curr = currOverlap[i]

      for (const prev of prevOverlap) {
        // 快速預檢：使用簡化的相似度檢查
        const quickCheck = quickSimilarityCheck(
          prev.text,
          curr.text,
          this.config.similarityThreshold
        )

        if (!quickCheck) {
          continue  // 快速排除明顯不相似的
        }

        // 1. 計算時間戳重疊
        const timeOverlap = this._calculateTimeOverlap(prev, curr)
        const prevDuration = prev.end - prev.start
        const currDuration = curr.end - curr.start
        const minDuration = Math.min(prevDuration, currDuration)

        // 時間戳重疊比例
        const timeOverlapRatio = minDuration > 0 ? timeOverlap / minDuration : 0

        // 2. 計算文字相似度
        const textSimilarity = calculateSimilarity(prev.text, curr.text, {
          normalize: true,
          maxLength: this.config.maxCompareLength
        })

        if (this.config.debug) {
          this._log(`\n[Comparing]`)
          this._log(`  Previous: "${prev.text}" (${prev.start.toFixed(2)}s - ${prev.end.toFixed(2)}s)`)
          this._log(`  Current:  "${curr.text}" (${curr.start.toFixed(2)}s - ${curr.end.toFixed(2)}s)`)
          this._log(`  Time overlap: ${timeOverlap.toFixed(2)}s (ratio: ${(timeOverlapRatio * 100).toFixed(1)}%)`)
          this._log(`  Text similarity: ${(textSimilarity * 100).toFixed(1)}%`)
        }

        // 3. 判斷是否重複
        // 策略 1: 時間戳重疊 > 80% → 強制視為重複（即使文字略有差異）
        if (timeOverlapRatio > 0.8) {
          const globalIdx = allCurrentSegments.indexOf(curr)
          if (globalIdx !== -1) {
            duplicates.add(globalIdx)
            this._log(`  ✓ Marked as duplicate (high time overlap)`)
          }
          break
        }

        // 策略 2: 時間戳重疊 > 50% 且文字相似度 > 閾值
        if (timeOverlapRatio > 0.5 && textSimilarity > this.config.similarityThreshold) {
          const globalIdx = allCurrentSegments.indexOf(curr)
          if (globalIdx !== -1) {
            duplicates.add(globalIdx)
            this._log(`  ✓ Marked as duplicate (time + text similarity)`)
          }
          break
        }
      }
    }

    return duplicates
  }

  /**
   * 計算兩個 segment 的時間重疊長度
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @returns {number} 重疊時長（秒）
   */
  _calculateTimeOverlap(seg1, seg2) {
    const overlapStart = Math.max(seg1.start, seg2.start)
    const overlapEnd = Math.min(seg1.end, seg2.end)
    return Math.max(0, overlapEnd - overlapStart)
  }

  /**
   * 合併破碎的句子
   *
   * 檢查相鄰 segments 是否應該合併：
   * 1. 時間間隔很小（< mergeTimeGap）
   * 2. 前一句以不完整標點結束（如逗號）
   * 3. 當前句不以句首特徵開頭（如大寫、新句）
   *
   * @param {Array<Segment>} segments - 待合併的 segments
   * @param {string} [language='auto'] - 語言代碼（用於斷句規則）
   * @returns {Array<Segment>} 合併後的 segments
   *
   * @example
   * const merged = processor.mergeBrokenSentences(segments, 'zh-TW')
   */
  mergeBrokenSentences(segments, language = 'auto') {
    if (segments.length === 0) return []

    const merged = [{ ...segments[0] }]

    for (let i = 1; i < segments.length; i++) {
      const current = { ...segments[i] }
      const previous = merged[merged.length - 1]

      // 判斷是否應該合併
      const shouldMerge = this._shouldMergeSegments(previous, current, language)

      if (shouldMerge) {
        // 合併文字與時間戳
        previous.text = previous.text.trimEnd() + ' ' + current.text.trimStart()
        previous.end = current.end

        this._log(`[Merged] "${previous.text.slice(0, 50)}..."`)
      } else {
        merged.push(current)
      }
    }

    return merged
  }

  /**
   * 判斷是否應該合併兩個 segments
   *
   * 使用 LanguageRules 提供的多語言斷句規則進行判斷。
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @param {string} language - 語言代碼
   * @returns {boolean} 是否應該合併
   */
  _shouldMergeSegments(seg1, seg2, language) {
    // 使用 LanguageRules 進行多語言斷句判斷
    return LanguageRules.shouldMerge(seg1, seg2, language, this.config.mergeTimeGap)
  }

  /**
   * 取得所有已處理的 segments
   *
   * @returns {Array<Segment>} 所有已處理的 segments
   */
  getAllSegments() {
    return this.processedSegments
  }

  /**
   * 重置處理器狀態
   *
   * 用於處理新的影片或重新開始處理
   */
  reset() {
    this._log('Resetting OverlapProcessor state')
    this.previousSegments = null
    this.processedSegments = []
    this.chunkCount = 0
  }

  /**
   * Debug 日誌輸出
   * @private
   */
  _log(...args) {
    if (this.config.debug) {
      console.log('[OverlapProcessor]', ...args)
    }
  }
}

/**
 * @typedef {Object} Segment
 * @property {number} id - Segment ID（Whisper 回傳）
 * @property {number} start - 開始時間（秒，絕對時間）
 * @property {number} end - 結束時間（秒，絕對時間）
 * @property {string} text - 辨識文字
 * @property {number} [avg_logprob] - 平均對數機率（信心分數）
 * @property {number} [no_speech_prob] - 無語音機率
 */

/**
 * @typedef {Object} WhisperResponse
 * @property {string} text - 完整辨識文字
 * @property {Array<Segment>} segments - 辨識片段
 */

export default OverlapProcessor
