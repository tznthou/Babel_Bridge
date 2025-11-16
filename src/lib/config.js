/**
 * Babel Bridge 全域配置
 */

/**
 * 音訊處理配置
 */
export const AUDIO_CONFIG = {
  // 採樣率 (16kHz 符合 Whisper 要求)
  SAMPLE_RATE: 16000,

  // 聲道數 (單聲道)
  CHANNELS: 1,

  // 位元率 (kbps)
  BITRATE: 128,

  // MP3 編碼模式 (0=立體聲, 1=聯合立體聲, 2=雙聲道, 3=單聲道)
  MP3_MODE: 3,
};

/**
 * Rolling Window 音訊切塊配置
 */
export const CHUNK_CONFIG = {
  // 每段音訊長度 (秒)
  CHUNK_DURATION: 3,

  // 重疊區長度 (秒)
  OVERLAP_DURATION: 1,

  // 最小切塊長度 (秒) - 小於此長度不送 Whisper
  MIN_CHUNK_DURATION: 0.5,

  // 最大切塊長度 (秒) - Whisper 限制 25MB,約 10 分鐘音訊
  MAX_CHUNK_DURATION: 600,
};

/**
 * Whisper API 配置
 */
export const WHISPER_CONFIG = {
  // API 端點
  API_URL: 'https://api.openai.com/v1/audio/transcriptions',

  // 模型
  MODEL: 'whisper-1',

  // 回應格式 (需要時間戳)
  RESPONSE_FORMAT: 'verbose_json',

  // 溫度參數 (0-1, 越低越確定性)
  TEMPERATURE: 0.2,

  // 語言 (auto-detect)
  LANGUAGE: null,

  // 重試次數
  MAX_RETRIES: 3,

  // 重試延遲 (ms)
  RETRY_DELAY: 1000,

  // 超時時間 (ms)
  TIMEOUT: 30000,
};

/**
 * GPT 翻譯配置
 */
export const TRANSLATION_CONFIG = {
  // API 端點
  API_URL: 'https://api.openai.com/v1/chat/completions',

  // 模型
  MODEL: 'gpt-4o-mini',

  // 溫度參數
  TEMPERATURE: 0.3,

  // 最大 tokens
  MAX_TOKENS: 500,

  // 系統提示詞
  SYSTEM_PROMPT: `You are a professional subtitle translator.
Translate the following subtitle text accurately while preserving:
1. Natural speech rhythm and timing
2. Cultural context and idioms
3. Proper names and technical terms
Keep translations concise and suitable for on-screen display.`,

  // 重試配置
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  TIMEOUT: 15000,
};

/**
 * 字幕處理配置
 */
export const SUBTITLE_CONFIG = {
  // 重疊區文字相似度閾值 (0-1)
  OVERLAP_SIMILARITY_THRESHOLD: 0.7,

  // 時間戳容差 (秒)
  TIMESTAMP_TOLERANCE: 0.3,

  // 最大字幕顯示時長 (秒)
  MAX_DISPLAY_DURATION: 10,

  // 最小字幕顯示時長 (秒)
  MIN_DISPLAY_DURATION: 1,
};

/**
 * OverlapProcessor 配置
 *
 * 用於音訊段重疊處理與斷句優化
 */
export const OVERLAP_CONFIG = {
  // 重疊區時長 (毫秒) - 與 CHUNK_CONFIG.OVERLAP_DURATION 對應
  overlapDuration: 1000,

  // 文字相似度閾值 (0-1)
  // 當文字相似度 > 此值且時間戳重疊 > 50% 時，判定為重複
  similarityThreshold: 0.8,

  // 句子合併時間間隔閾值 (秒)
  // 當相鄰 segments 時間間隔 < 此值時，可能合併
  mergeTimeGap: 0.3,

  // 文字比對最大長度（效能優化）
  // 只比對文字的前 N 個字元以加速相似度計算
  maxCompareLength: 100,

  // Debug 模式
  debug: false,
};

/**
 * 成本計算配置 (USD)
 */
export const COST_CONFIG = {
  // Whisper: $0.006 / 分鐘
  WHISPER_PER_MINUTE: 0.006,

  // GPT-4o-mini: $0.150 / 1M input tokens, $0.600 / 1M output tokens
  GPT_INPUT_PER_1M_TOKENS: 0.15,
  GPT_OUTPUT_PER_1M_TOKENS: 0.6,

  // 預估平均 tokens (每分鐘字幕)
  ESTIMATED_TOKENS_PER_MINUTE: 150,
};

/**
 * UI 配置
 */
export const UI_CONFIG = {
  // 字幕樣式預設值
  DEFAULT_STYLE: {
    fontSize: '24px',
    fontFamily: 'Arial, sans-serif',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    position: 'bottom-center',
    offset: 50, // 距離底部像素
  },

  // 支援的語言
  SUPPORTED_LANGUAGES: [
    { code: 'zh-TW', name: '繁體中文' },
    { code: 'zh-CN', name: '简体中文' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
  ],
};

/**
 * Deepgram Streaming API 配置
 */
export const DEEPGRAM_CONFIG = {
  // API 端點
  AUTH_URL: 'https://api.deepgram.com/v1/auth/token',
  WEBSOCKET_URL: 'wss://api.deepgram.com/v1/listen',

  // 模型設定
  MODEL: 'nova-2', // Nova-2 最新且支援中文
  LANGUAGE: 'zh-TW', // 或 'zh-CN'

  // 音訊格式
  ENCODING: 'linear16',
  SAMPLE_RATE: 16000,
  CHANNELS: 1,

  // Streaming 設定
  INTERIM_RESULTS: true, // 啟用即時字幕
  PUNCTUATE: true, // 自動標點
  SMART_FORMAT: true, // 智能格式化
  ENDPOINTING: 300, // 300ms 靜音視為句子結束

  // 連線管理
  KEEPALIVE_INTERVAL: 5000, // 5 秒發送 KeepAlive
  RECONNECT_MAX_RETRIES: 5, // 最多重連 5 次
  RECONNECT_DELAY: 1000, // 重連延遲 1 秒

  // 成本計算（Nova-2 定價）
  COST_PER_MINUTE: 0.0043, // $0.0043/分鐘
};

/**
 * AudioWorklet PCM 處理配置
 */
export const AUDIO_WORKLET_CONFIG = {
  FRAME_SIZE_MS: 20, // 20ms per frame
  INPUT_SAMPLE_RATE: 48000, // 瀏覽器預設
  OUTPUT_SAMPLE_RATE: 16000, // Deepgram 要求
  CHANNELS: 1, // Mono
};

/**
 * 儲存鍵名
 */
export const STORAGE_KEYS = {
  // OpenAI
  API_KEY_ENCRYPTED: 'openai_api_key_encrypted', // 加密後的 API Key (AES-GCM)
  API_KEY_TYPE: 'openai_api_key_type', // 密鑰類型 (Standard/Project/Admin/Org)
  API_KEY_VERIFIED_AT: 'openai_api_key_verified_at', // 驗證時間戳

  // Deepgram
  DEEPGRAM_API_KEY_ENCRYPTED: 'deepgram_api_key_encrypted',
  DEEPGRAM_API_KEY_VERIFIED_AT: 'deepgram_api_key_verified_at',
  DEEPGRAM_API_KEY_SCOPES: 'deepgram_api_key_scopes',
  DEEPGRAM_PROJECT_UUID: 'deepgram_project_uuid',

  // 通用
  USER_SETTINGS: 'user_settings',
  COST_TRACKING: 'cost_tracking',
  SUBTITLE_CACHE: 'subtitle_cache',
};

/**
 * 訊息類型
 */
export const MessageTypes = {
  // Popup → Background
  ENABLE_SUBTITLES: 'ENABLE_SUBTITLES',
  DISABLE_SUBTITLES: 'DISABLE_SUBTITLES',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  VERIFY_API_KEY: 'VERIFY_API_KEY',
  GET_COST_STATS: 'GET_COST_STATS',

  // Background → Content
  SUBTITLE_UPDATE: 'SUBTITLE_UPDATE',
  STYLE_UPDATE: 'STYLE_UPDATE',
  CLEAR_SUBTITLES: 'CLEAR_SUBTITLES',

  // Content → Background
  VIDEO_STATE_CHANGED: 'VIDEO_STATE_CHANGED',
  SUBTITLE_RENDERED: 'SUBTITLE_RENDERED',

  // 錯誤回報
  ERROR: 'ERROR',
};
