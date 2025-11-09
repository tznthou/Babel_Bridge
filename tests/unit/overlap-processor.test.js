/**
 * OverlapProcessor 單元測試
 *
 * 測試音訊段重疊處理與斷句優化功能
 *
 * @module tests/unit/overlap-processor
 */

import { describe, test, expect, beforeEach } from '@jest/globals'
import { OverlapProcessor } from '../../src/background/subtitle-processor.js'
import {
  calculateSimilarity,
  levenshteinDistance,
  normalizeText
} from '../../src/lib/text-similarity.js'
import { LanguageRules } from '../../src/lib/language-rules.js'

describe('OverlapProcessor', () => {
  let processor

  beforeEach(() => {
    processor = new OverlapProcessor({
      overlapDuration: 1000,
      similarityThreshold: 0.8,
      debug: false
    })
  })

  describe('基礎功能', () => {
    test('應該正確初始化', () => {
      expect(processor).toBeDefined()
      expect(processor.config.overlapDuration).toBe(1000)
      expect(processor.config.similarityThreshold).toBe(0.8)
      expect(processor.previousSegments).toBeNull()
      expect(processor.processedSegments).toEqual([])
    })

    test('應該正確處理第一段音訊', () => {
      const response = {
        text: 'Hello world',
        segments: [
          { id: 0, start: 0.0, end: 2.0, text: 'Hello world' }
        ]
      }

      const result = processor.process(response, 0.0)

      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('Hello world')
      expect(result[0].start).toBe(0.0)
      expect(result[0].end).toBe(2.0)
      expect(processor.previousSegments).toHaveLength(1)
    })

    test('應該正確調整時間戳', () => {
      const response = {
        text: 'Test',
        segments: [
          { id: 0, start: 0.0, end: 1.0, text: 'Test' }
        ]
      }

      const result = processor.process(response, 5.0)

      expect(result[0].start).toBe(5.0)  // 0.0 + 5.0
      expect(result[0].end).toBe(6.0)    // 1.0 + 5.0
    })
  })

  describe('重疊區去重', () => {
    test('應該移除重複的 segments', () => {
      // Chunk 1: 0-3s
      const chunk1 = {
        text: '今天天氣很好，我們去公園',
        segments: [
          { id: 0, start: 0.0, end: 2.0, text: '今天天氣很好' },
          { id: 1, start: 2.0, end: 3.0, text: '我們去公園' }
        ]
      }

      // Chunk 2: 2-5s (重疊 2-3s)
      const chunk2 = {
        text: '我們去公園玩',
        segments: [
          { id: 0, start: 0.0, end: 1.0, text: '我們去公園' },  // 重複
          { id: 1, start: 1.0, end: 3.0, text: '玩遊戲' }
        ]
      }

      const result1 = processor.process(chunk1, 0.0)
      expect(result1).toHaveLength(2)

      const result2 = processor.process(chunk2, 2.0)

      // 第一個 segment 應該被過濾掉（重複）
      expect(result2.length).toBeLessThan(2)
      expect(result2[0].text).toBe('玩遊戲')
    })

    test('應該保留非重複的 segments', () => {
      // Chunk 1
      const chunk1 = {
        text: 'Hello',
        segments: [
          { id: 0, start: 0.0, end: 2.0, text: 'Hello' }
        ]
      }

      // Chunk 2: 完全不同的內容
      const chunk2 = {
        text: 'World',
        segments: [
          { id: 0, start: 0.0, end: 2.0, text: 'World' }
        ]
      }

      processor.process(chunk1, 0.0)
      const result2 = processor.process(chunk2, 2.0)

      expect(result2).toHaveLength(1)
      expect(result2[0].text).toBe('World')
    })

    test('應該正確處理三段連續音訊', () => {
      const chunk1 = {
        segments: [
          { id: 0, start: 0.0, end: 1.5, text: '第一段' },
          { id: 1, start: 1.5, end: 3.0, text: '第二段' }
        ]
      }

      const chunk2 = {
        segments: [
          { id: 0, start: 0.0, end: 1.0, text: '第二段' },  // 重複
          { id: 1, start: 1.0, end: 3.0, text: '第三段' }
        ]
      }

      const chunk3 = {
        segments: [
          { id: 0, start: 0.0, end: 1.0, text: '第三段' },  // 重複
          { id: 1, start: 1.0, end: 3.0, text: '第四段' }
        ]
      }

      processor.process(chunk1, 0.0)
      processor.process(chunk2, 2.0)
      processor.process(chunk3, 4.0)

      const allSegments = processor.getAllSegments()

      // 檢查無重複
      const texts = allSegments.map(s => s.text)
      const uniqueTexts = new Set(texts)
      expect(texts.length).toBe(uniqueTexts.size)
    })
  })

  describe('句子合併', () => {
    test('應該合併破碎的句子（中文）', () => {
      const segments = [
        { start: 0.0, end: 1.0, text: '今天天氣,' },
        { start: 1.0, end: 2.0, text: '很好' }
      ]

      const result = processor.mergeBrokenSentences(segments, 'zh-TW')

      expect(result).toHaveLength(1)
      expect(result[0].text).toContain('今天天氣')
      expect(result[0].text).toContain('很好')
      expect(result[0].end).toBe(2.0)
    })

    test('應該合併破碎的句子（英文）', () => {
      const segments = [
        { start: 0.0, end: 1.0, text: 'The weather is good,' },
        { start: 1.0, end: 2.0, text: 'today' }
      ]

      const result = processor.mergeBrokenSentences(segments, 'en')

      expect(result).toHaveLength(1)
      expect(result[0].text).toContain('weather')
      expect(result[0].text).toContain('today')
    })

    test('不應該合併完整的句子', () => {
      const segments = [
        { start: 0.0, end: 1.0, text: '今天天氣很好。' },
        { start: 1.5, end: 2.5, text: '我們去公園。' }
      ]

      const result = processor.mergeBrokenSentences(segments, 'zh-TW')

      expect(result).toHaveLength(2)
    })

    test('不應該合併時間間隔過大的句子', () => {
      const segments = [
        { start: 0.0, end: 1.0, text: 'Hello,' },
        { start: 2.0, end: 3.0, text: 'world' }  // 間隔 1 秒
      ]

      const result = processor.mergeBrokenSentences(segments, 'en')

      expect(result).toHaveLength(2)
    })
  })

  describe('重置功能', () => {
    test('應該正確重置狀態', () => {
      const response = {
        segments: [
          { id: 0, start: 0.0, end: 2.0, text: 'Test' }
        ]
      }

      processor.process(response, 0.0)
      expect(processor.previousSegments).not.toBeNull()
      expect(processor.processedSegments.length).toBeGreaterThan(0)

      processor.reset()

      expect(processor.previousSegments).toBeNull()
      expect(processor.processedSegments).toEqual([])
      expect(processor.chunkCount).toBe(0)
    })
  })

  describe('錯誤處理', () => {
    test('應該拋出錯誤當輸入無效', () => {
      expect(() => {
        processor.process(null, 0.0)
      }).toThrow()

      expect(() => {
        processor.process({}, 0.0)
      }).toThrow()

      expect(() => {
        processor.process({ text: 'test' }, 0.0)
      }).toThrow()
    })
  })
})

describe('文字相似度工具', () => {
  describe('Levenshtein Distance', () => {
    test('完全相同應返回 0', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0)
    })

    test('完全不同應返回最大距離', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(3)
    })

    test('單一替換', () => {
      expect(levenshteinDistance('kitten', 'sitten')).toBe(1)
    })

    test('插入操作', () => {
      expect(levenshteinDistance('cat', 'cats')).toBe(1)
    })

    test('刪除操作', () => {
      expect(levenshteinDistance('cats', 'cat')).toBe(1)
    })

    test('多重操作', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
    })
  })

  describe('文字正規化', () => {
    test('應該移除標點符號', () => {
      expect(normalizeText('Hello, World!')).toBe('hello world')
      expect(normalizeText('今天天氣很好！')).toBe('今天天氣很好')
    })

    test('應該轉換為小寫', () => {
      expect(normalizeText('HELLO WORLD')).toBe('hello world')
    })

    test('應該合併多個空白', () => {
      expect(normalizeText('hello    world')).toBe('hello world')
    })
  })

  describe('相似度計算', () => {
    test('完全相同應返回 1.0', () => {
      expect(calculateSimilarity('hello', 'hello')).toBe(1.0)
    })

    test('完全不同應返回接近 0.0', () => {
      expect(calculateSimilarity('abc', 'xyz')).toBeLessThan(0.3)
    })

    test('輕微差異應 > 0.8', () => {
      const similarity = calculateSimilarity('今天天氣很好', '今天天氣好好')
      expect(similarity).toBeGreaterThan(0.8)
    })

    test('應該忽略標點符號和大小寫', () => {
      const similarity = calculateSimilarity('Hello, World!', 'hello world')
      expect(similarity).toBe(1.0)
    })

    test('長度差異過大應返回 0.0', () => {
      const similarity = calculateSimilarity('a', 'abcdefghijklmnop')
      expect(similarity).toBe(0.0)
    })
  })
})

describe('LanguageRules', () => {
  describe('中文斷句', () => {
    test('應該合併句中標點', () => {
      const seg1 = { start: 0, end: 1, text: '今天天氣，' }
      const seg2 = { start: 1, end: 2, text: '很好' }
      expect(LanguageRules.shouldMerge(seg1, seg2, 'zh-TW')).toBe(true)
    })

    test('不應該合併句末標點', () => {
      const seg1 = { start: 0, end: 1, text: '今天天氣很好。' }
      const seg2 = { start: 1, end: 2, text: '我們去公園' }
      expect(LanguageRules.shouldMerge(seg1, seg2, 'zh-TW')).toBe(false)
    })
  })

  describe('英文斷句', () => {
    test('應該合併逗號後的小寫', () => {
      const seg1 = { start: 0, end: 1, text: 'Hello,' }
      const seg2 = { start: 1, end: 2, text: 'world' }
      expect(LanguageRules.shouldMerge(seg1, seg2, 'en')).toBe(true)
    })

    test('不應該合併句號', () => {
      const seg1 = { start: 0, end: 1, text: 'Hello.' }
      const seg2 = { start: 1, end: 2, text: 'World' }
      expect(LanguageRules.shouldMerge(seg1, seg2, 'en')).toBe(false)
    })

    test('應該識別常見縮寫', () => {
      const seg1 = { start: 0, end: 1, text: 'Mr.' }
      const seg2 = { start: 1, end: 2, text: 'Smith' }
      expect(LanguageRules.shouldMerge(seg1, seg2, 'en')).toBe(true)
    })
  })

  describe('語言檢測', () => {
    test('應該檢測中文', () => {
      expect(LanguageRules.detectLanguage('今天天氣很好')).toBe('zh')
    })

    test('應該檢測英文', () => {
      expect(LanguageRules.detectLanguage('Hello world')).toBe('en')
    })

    test('應該檢測日文', () => {
      expect(LanguageRules.detectLanguage('こんにちは')).toBe('ja')
    })

    test('應該檢測韓文', () => {
      expect(LanguageRules.detectLanguage('안녕하세요')).toBe('ko')
    })
  })
})
