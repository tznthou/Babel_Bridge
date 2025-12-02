/**
 * Language-Specific Rules for Subtitle Processing
 *
 * 提供多語言的斷句規則，用於判斷是否應該合併相鄰的字幕片段。
 * 不同語言有不同的標點符號、大小寫規則與句子結構。
 *
 * @module language-rules
 * @license MIT
 */

/**
 * 語言規則管理器
 *
 * @class
 */
export class LanguageRules {
  /**
   * 判斷兩個 segment 是否應該合併
   *
   * 根據語言特性自動選擇對應的斷句規則。
   *
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @param {string} [language='auto'] - 語言代碼（auto, zh, zh-TW, zh-CN, en, ja, etc.）
   * @param {number} [mergeTimeGap=0.3] - 時間間隔閾值（秒）
   * @returns {boolean} 是否應該合併
   *
   * @example
   * LanguageRules.shouldMerge(seg1, seg2, 'zh-TW')
   * LanguageRules.shouldMerge(seg1, seg2, 'en')
   */
  static shouldMerge(seg1, seg2, language = 'auto', mergeTimeGap = 0.3) {
    // 基本檢查：時間間隔是否過大
    const timeGap = seg2.start - seg1.end
    if (timeGap > mergeTimeGap) {
      return false
    }

    // 根據語言選擇對應規則
    switch (language.toLowerCase()) {
      case 'zh':
      case 'zh-tw':
      case 'zh-cn':
      case 'zh-hk':
        return this._shouldMergeChinese(seg1, seg2)

      case 'en':
      case 'en-us':
      case 'en-gb':
        return this._shouldMergeEnglish(seg1, seg2)

      case 'ja':
      case 'jp':
        return this._shouldMergeJapanese(seg1, seg2)

      case 'ko':
      case 'kr':
        return this._shouldMergeKorean(seg1, seg2)

      case 'es':
      case 'fr':
      case 'de':
      case 'it':
      case 'pt':
        return this._shouldMergeEuropean(seg1, seg2)

      case 'auto':
      default:
        return this._shouldMergeAuto(seg1, seg2)
    }
  }

  /**
   * 中文斷句規則
   *
   * 中文特點：
   * - 無大小寫
   * - 標點：。！？；： 為句末，，、 為句中
   * - 引號：「」『』
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @returns {boolean} 是否應該合併
   */
  static _shouldMergeChinese(seg1, seg2) {
    const text1 = seg1.text.trim()
    const text2 = seg2.text.trim()

    // 檢查前一句是否以句末標點結束
    const endsWithCompletePunctuation = /[。！？；：]$/.test(text1)
    if (endsWithCompletePunctuation) {
      return false  // 完整句子，不合併
    }

    // 檢查前一句是否以句中標點結束（支援半形和全形逗號）
    const endsWithIncompletePunctuation = /[,，、]$/.test(text1)
    if (endsWithIncompletePunctuation) {
      return true  // 句中標點，應該合併
    }

    // 檢查是否在引號中
    const inQuotes = /[「『]$/.test(text1) || /^[」』]/.test(text2)
    if (inQuotes) {
      return true  // 引號內容，合併
    }

    // 預設不合併
    return false
  }

  /**
   * 英文斷句規則
   *
   * 英文特點：
   * - 大小寫：句首大寫
   * - 標點：. ! ? ; : 為句末，, 為句中
   * - 引號："" ''
   * - 縮寫：Mr. Dr. etc. 不是句末
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @returns {boolean} 是否應該合併
   */
  static _shouldMergeEnglish(seg1, seg2) {
    const text1 = seg1.text.trim()
    const text2 = seg2.text.trim()

    // 檢查前一句是否以句末標點結束
    const endsWithPeriod = /\.$/.test(text1)
    if (endsWithPeriod) {
      // 檢查是否為常見縮寫
      const commonAbbreviations = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|etc|e\.g|i\.e|vs|Ph\.D)\.$/.test(text1)
      if (commonAbbreviations) {
        return true  // 縮寫，應該合併
      }
      return false  // 真正的句末，不合併
    }

    const endsWithCompletePunctuation = /[!?;:]$/.test(text1)
    if (endsWithCompletePunctuation) {
      return false  // 完整句子，不合併
    }

    // 檢查前一句是否以逗號結束
    const endsWithComma = /,$/.test(text1)
    if (endsWithComma) {
      // 檢查下一句是否以大寫開頭（可能是新句）
      const startsWithCapital = /^[A-Z]/.test(text2)
      if (startsWithCapital) {
        // 可能是新句，但也可能是專有名詞，採保守策略：合併
        return true
      }
      return true  // 逗號，應該合併
    }

    // 檢查是否在引號中
    const inQuotes = /"$/.test(text1) || /^"/.test(text2)
    if (inQuotes) {
      return true
    }

    return false
  }

  /**
   * 日文斷句規則
   *
   * 日文特點：
   * - 無大小寫（假名、漢字）
   * - 標點：。！？ 為句末，、 為句中
   * - 引號：「」『』
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @returns {boolean} 是否應該合併
   */
  static _shouldMergeJapanese(seg1, seg2) {
    const text1 = seg1.text.trim()
    const text2 = seg2.text.trim()

    // 檢查前一句是否以句末標點結束
    const endsWithCompletePunctuation = /[。！？]$/.test(text1)
    if (endsWithCompletePunctuation) {
      return false
    }

    // 檢查前一句是否以句中標點結束
    const endsWithIncompletePunctuation = /[、]$/.test(text1)
    if (endsWithIncompletePunctuation) {
      return true
    }

    // 檢查是否在引號中
    const inQuotes = /[「『]$/.test(text1) || /^[」』]/.test(text2)
    if (inQuotes) {
      return true
    }

    return false
  }

  /**
   * 韓文斷句規則
   *
   * 韓文特點：
   * - 諺文（韓字）
   * - 標點：. ! ? 為句末，, 為句中
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @returns {boolean} 是否應該合併
   */
  static _shouldMergeKorean(seg1, seg2) {
    const text1 = seg1.text.trim()
    const text2 = seg2.text.trim()

    // 檢查前一句是否以句末標點結束
    const endsWithCompletePunctuation = /[.!?。！？]$/.test(text1)
    if (endsWithCompletePunctuation) {
      return false
    }

    // 檢查前一句是否以逗號結束
    const endsWithComma = /[,，]$/.test(text1)
    if (endsWithComma) {
      return true
    }

    return false
  }

  /**
   * 歐洲語言斷句規則（西班牙文、法文、德文、義大利文、葡萄牙文）
   *
   * 共同特點：
   * - 大小寫：句首大寫
   * - 標點：. ! ? ; : 為句末，, 為句中
   * - 特殊字元：¿¡ （西班牙文倒問號、倒感嘆號）
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @returns {boolean} 是否應該合併
   */
  static _shouldMergeEuropean(seg1, seg2) {
    const text1 = seg1.text.trim()
    const text2 = seg2.text.trim()

    // 檢查前一句是否以句末標點結束
    const endsWithCompletePunctuation = /[.!?;:]$/.test(text1)
    if (endsWithCompletePunctuation) {
      return false
    }

    // 檢查前一句是否以逗號結束
    const endsWithComma = /,$/.test(text1)
    if (endsWithComma) {
      // 檢查下一句是否以大寫開頭
      const startsWithCapital = /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ]/.test(text2)
      if (startsWithCapital) {
        return true  // 保守策略：合併
      }
      return true
    }

    return false
  }

  /**
   * 自動檢測斷句規則
   *
   * 當語言未知時，嘗試自動檢測並應用對應規則。
   * 檢測策略：
   * 1. 檢測文字中的字元特徵
   * 2. 應用最可能的語言規則
   *
   * @private
   * @param {Segment} seg1 - 第一個 segment
   * @param {Segment} seg2 - 第二個 segment
   * @returns {boolean} 是否應該合併
   */
  static _shouldMergeAuto(seg1, seg2) {
    const text1 = seg1.text.trim()
    const text2 = seg2.text.trim()
    const combinedText = text1 + text2

    // 檢測中文字元（包含繁簡體）
    const hasChinese = /[\u4e00-\u9fff]/.test(combinedText)
    if (hasChinese) {
      return this._shouldMergeChinese(seg1, seg2)
    }

    // 檢測日文字元（平假名、片假名）
    const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(combinedText)
    if (hasJapanese) {
      return this._shouldMergeJapanese(seg1, seg2)
    }

    // 檢測韓文字元（諺文）
    const hasKorean = /[\uac00-\ud7af]/.test(combinedText)
    if (hasKorean) {
      return this._shouldMergeKorean(seg1, seg2)
    }

    // 預設使用英文規則（適用於拉丁字母語言）
    return this._shouldMergeEnglish(seg1, seg2)
  }

  /**
   * 檢測文字的主要語言
   *
   * 根據文字中的字元分布自動檢測語言。
   *
   * @param {string} text - 待檢測文字
   * @returns {string} 語言代碼（zh, ja, ko, en, auto）
   *
   * @example
   * LanguageRules.detectLanguage('今天天氣很好')  // 'zh'
   * LanguageRules.detectLanguage('Hello world')   // 'en'
   */
  static detectLanguage(text) {
    // 計算各種字元的出現次數
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const japaneseChars = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length
    const koreanChars = (text.match(/[\uac00-\ud7af]/g) || []).length
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length

    const total = text.length

    // 判斷主要語言（字元佔比 > 30%）
    if (chineseChars / total > 0.3) return 'zh'
    if (japaneseChars / total > 0.3) return 'ja'
    if (koreanChars / total > 0.3) return 'ko'
    if (latinChars / total > 0.3) return 'en'

    return 'auto'
  }
}

/**
 * @typedef {Object} Segment
 * @property {number} start - 開始時間（秒）
 * @property {number} end - 結束時間（秒）
 * @property {string} text - 文字內容
 */

export default LanguageRules
