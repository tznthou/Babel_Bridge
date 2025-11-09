/**
 * Text Similarity Utilities for Babel Bridge
 *
 * Provides text similarity calculation using Levenshtein Distance algorithm.
 * Implementation inspired by NaturalNode/natural (MIT License)
 * @see https://github.com/NaturalNode/natural
 *
 * @module text-similarity
 * @license MIT
 */

/**
 * 計算兩個字串之間的 Levenshtein Distance (編輯距離)
 *
 * Levenshtein Distance 是指將一個字串轉換成另一個字串所需的最少編輯操作次數。
 * 編輯操作包括：插入、刪除、替換單一字元。
 *
 * 時間複雜度: O(m * n)，其中 m 和 n 是兩個字串的長度
 * 空間複雜度: O(m * n)
 *
 * @param {string} source - 來源字串
 * @param {string} target - 目標字串
 * @param {Object} [options={}] - 選項配置
 * @param {boolean} [options.caseSensitive=false] - 是否區分大小寫
 * @returns {number} 編輯距離（0 表示完全相同）
 *
 * @example
 * levenshteinDistance('kitten', 'sitting')  // 返回 3
 * levenshteinDistance('hello', 'hello')      // 返回 0
 * levenshteinDistance('abc', 'xyz')          // 返回 3
 */
export function levenshteinDistance(source, target, options = {}) {
  const { caseSensitive = false } = options

  // 如果不區分大小寫，轉為小寫
  const str1 = caseSensitive ? source : source.toLowerCase()
  const str2 = caseSensitive ? target : target.toLowerCase()

  const len1 = str1.length
  const len2 = str2.length

  // 邊界條件：如果其中一個字串為空
  if (len1 === 0) return len2
  if (len2 === 0) return len1

  // 建立 DP 矩陣
  // dp[i][j] 表示 str1[0..i-1] 轉換成 str2[0..j-1] 的最少操作次數
  const dp = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0))

  // 初始化第一行和第一列
  // dp[i][0] = i：表示將 str1[0..i-1] 刪除成空字串需要 i 次刪除操作
  // dp[0][j] = j：表示將空字串插入成 str2[0..j-1] 需要 j 次插入操作
  for (let i = 0; i <= len1; i++) {
    dp[i][0] = i
  }
  for (let j = 0; j <= len2; j++) {
    dp[0][j] = j
  }

  // 動態規劃填表
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      // 如果當前字元相同，則不需要額外操作
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 刪除 str1[i-1]
        dp[i][j - 1] + 1,      // 插入 str2[j-1]
        dp[i - 1][j - 1] + cost // 替換（如果不同）或不操作（如果相同）
      )
    }
  }

  return dp[len1][len2]
}

/**
 * 正規化文字：移除標點符號、多餘空白，並統一大小寫
 *
 * 用於在比對文字相似度前進行預處理，提高比對準確度。
 *
 * @param {string} text - 原始文字
 * @param {Object} [options={}] - 選項配置
 * @param {boolean} [options.removePunctuation=true] - 是否移除標點符號
 * @param {boolean} [options.toLowerCase=true] - 是否轉為小寫
 * @param {boolean} [options.removeWhitespace=false] - 是否完全移除空白
 * @returns {string} 正規化後的文字
 *
 * @example
 * normalizeText('Hello, World!')  // 'hello world'
 * normalizeText('今天天氣很好！')   // '今天天氣很好'
 */
export function normalizeText(text, options = {}) {
  const {
    removePunctuation = true,
    toLowerCase = true,
    removeWhitespace = false
  } = options

  let normalized = text

  // 移除標點符號（保留中英文字母、數字、空白）
  if (removePunctuation) {
    // 移除英文標點： . , ! ? ; : " ' ( ) [ ] { } - _ / \
    // 移除中文標點： 。 ， ！ ？ ； ： 「 」 『 』 （ ） 、
    normalized = normalized.replace(/[.,!?;:'"()\[\]{}\-_/\\。，！？；：「」『』（）、]/g, '')
  }

  // 轉換為小寫
  if (toLowerCase) {
    normalized = normalized.toLowerCase()
  }

  // 處理空白
  if (removeWhitespace) {
    normalized = normalized.replace(/\s+/g, '')
  } else {
    // 將多個空白合併為單一空白
    normalized = normalized.replace(/\s+/g, ' ').trim()
  }

  return normalized
}

/**
 * 計算兩個字串的相似度 (0-1 之間)
 *
 * 相似度計算方式：
 * similarity = (maxLength - distance) / maxLength
 * 其中 distance 是 Levenshtein Distance
 *
 * 相似度 1.0 表示完全相同，0.0 表示完全不同
 *
 * @param {string} text1 - 第一個字串
 * @param {string} text2 - 第二個字串
 * @param {Object} [options={}] - 選項配置
 * @param {boolean} [options.normalize=true] - 是否進行文字正規化
 * @param {number} [options.maxLength=Infinity] - 最大比對長度（效能優化）
 * @returns {number} 相似度 (0-1)
 *
 * @example
 * calculateSimilarity('hello', 'hello')        // 1.0
 * calculateSimilarity('hello', 'hallo')        // 0.8
 * calculateSimilarity('abc', 'xyz')            // 0.0
 * calculateSimilarity('Hello, World!', 'hello world', { normalize: true })  // 1.0
 */
export function calculateSimilarity(text1, text2, options = {}) {
  const {
    normalize = true,
    maxLength = Infinity
  } = options

  // 正規化文字
  let str1 = normalize ? normalizeText(text1) : text1
  let str2 = normalize ? normalizeText(text2) : text2

  // 快速檢查：如果完全相同
  if (str1 === str2) return 1.0

  // 快速檢查：長度差異過大（超過 50%）
  const len1 = str1.length
  const len2 = str2.length
  const lengthDiff = Math.abs(len1 - len2)
  const maxLen = Math.max(len1, len2)

  if (maxLen > 0 && lengthDiff / maxLen > 0.5) {
    return 0.0  // 長度差異過大，直接判定為不相似
  }

  // 效能優化：限制比對長度
  if (maxLength < Infinity) {
    str1 = str1.slice(0, maxLength)
    str2 = str2.slice(0, maxLength)
  }

  // 計算 Levenshtein Distance
  const distance = levenshteinDistance(str1, str2, { caseSensitive: false })

  // 轉換為相似度
  const similarity = maxLen > 0 ? (maxLen - distance) / maxLen : 0.0

  return Math.max(0, Math.min(1, similarity))  // 確保在 [0, 1] 範圍內
}

/**
 * 快速相似度檢查（簡化版，僅用於快速篩選）
 *
 * 使用簡單的啟發式方法進行快速檢查，適合大量文字的初步篩選。
 * 比 calculateSimilarity 快很多，但準確度較低。
 *
 * @param {string} text1 - 第一個字串
 * @param {string} text2 - 第二個字串
 * @param {number} [threshold=0.8] - 相似度閾值
 * @returns {boolean} 是否可能相似（需要進一步用 calculateSimilarity 確認）
 *
 * @example
 * quickSimilarityCheck('hello world', 'hello world')  // true
 * quickSimilarityCheck('abc', 'xyz')                  // false
 */
export function quickSimilarityCheck(text1, text2, threshold = 0.8) {
  // 正規化
  const str1 = normalizeText(text1)
  const str2 = normalizeText(text2)

  // 完全相同
  if (str1 === str2) return true

  // 長度檢查
  const len1 = str1.length
  const len2 = str2.length
  const lengthDiff = Math.abs(len1 - len2)
  const maxLen = Math.max(len1, len2)

  // 長度差異超過 (1 - threshold) 倍，直接判定為不相似
  if (maxLen > 0 && lengthDiff / maxLen > (1 - threshold)) {
    return false
  }

  // 簡單字元集合比對（共同字元比例）
  const chars1 = new Set(str1)
  const chars2 = new Set(str2)
  const intersection = new Set([...chars1].filter(x => chars2.has(x)))
  const union = new Set([...chars1, ...chars2])

  const jaccardSimilarity = intersection.size / union.size

  // 如果 Jaccard 相似度低於閾值，可能不相似
  return jaccardSimilarity >= (threshold * 0.6)  // 降低標準，避免誤判
}

// 導出所有函數作為預設物件（便於測試）
export default {
  levenshteinDistance,
  normalizeText,
  calculateSimilarity,
  quickSimilarityCheck
}
