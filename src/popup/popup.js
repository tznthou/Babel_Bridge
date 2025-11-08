/**
 * Popup UI 控制邏輯
 */
import { APIKeyManager } from '../lib/api-key-manager.js';
import { MessageTypes } from '../lib/config.js';

// DOM 元素
const apiKeyInput = document.getElementById('api-key-input');
const verifyBtn = document.getElementById('verify-btn');
const apiKeyStatus = document.getElementById('api-key-status');

const enableBtn = document.getElementById('enable-btn');
const disableBtn = document.getElementById('disable-btn');
const statusText = document.getElementById('status-text');

const whisperCostEl = document.getElementById('whisper-cost');
const gptCostEl = document.getElementById('gpt-cost');
const totalCostEl = document.getElementById('total-cost');
const refreshStatsBtn = document.getElementById('refresh-stats-btn');

/**
 * 初始化 UI
 */
async function init() {
  try {
    // 檢查是否已有加密儲存的 API Key
    const apiKey = await APIKeyManager.getKey();
    if (apiKey) {
      // 不顯示完整 API Key，使用遮罩格式
      const maskedKey = maskApiKey(apiKey);
      apiKeyInput.value = maskedKey;
      apiKeyInput.disabled = true; // 已設定時禁用輸入
      showStatus(apiKeyStatus, '✓ 已設定並加密儲存 API Key', 'success');

      // 顯示「更換 API Key」按鈕提示
      verifyBtn.textContent = '更換 API Key';
    }
  } catch (error) {
    console.error('初始化失敗:', error);
    // 如果解密失敗，可能是瀏覽器指紋改變
    if (error.code === 'CRYPTO_DECRYPTION_FAILED') {
      showStatus(
        apiKeyStatus,
        '⚠️ API Key 解密失敗，請重新輸入（可能是更換了瀏覽器或電腦）',
        'error'
      );
    }
  }

  // 載入成本統計
  await loadCostStats();
}

/**
 * 遮罩 API Key（只顯示前後部分）
 * @param {string} apiKey - 完整的 API Key
 * @returns {string} 遮罩後的 API Key
 */
function maskApiKey(apiKey) {
  if (!apiKey || apiKey.length < 20) return '****';

  const prefix = apiKey.substring(0, 10); // 顯示前10個字元 (如 sk-proj-ab)
  const suffix = apiKey.substring(apiKey.length - 4); // 顯示最後4個字元
  return `${prefix}${'*'.repeat(20)}${suffix}`;
}

/**
 * 驗證 API Key
 */
async function verifyApiKey() {
  // 如果當前是「更換 API Key」模式，先清除舊的並啟用輸入
  if (verifyBtn.textContent === '更換 API Key') {
    await APIKeyManager.removeKey();
    apiKeyInput.value = '';
    apiKeyInput.disabled = false;
    apiKeyInput.focus();
    verifyBtn.textContent = '驗證並儲存';
    showStatus(apiKeyStatus, '請輸入新的 API Key', '');
    return;
  }

  const apiKey = apiKeyInput.value.trim();

  // 檢查是否為遮罩的 key（避免用戶誤操作）
  if (apiKey.includes('*')) {
    showStatus(apiKeyStatus, '請輸入完整的 API Key', 'error');
    return;
  }

  if (!apiKey) {
    showStatus(apiKeyStatus, '請輸入 API Key', 'error');
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = '驗證中...';
  showStatus(apiKeyStatus, '正在驗證並加密 API Key...', '');

  try {
    const result = await APIKeyManager.verifyAndSave(apiKey);

    // 驗證成功後，顯示遮罩的 key
    const maskedKey = maskApiKey(apiKey);
    apiKeyInput.value = maskedKey;
    apiKeyInput.disabled = true;

    showStatus(
      apiKeyStatus,
      `✓ ${result.keyType} 驗證成功並已加密儲存 (可用模型: ${result.modelsCount})`,
      'success'
    );

    verifyBtn.textContent = '更換 API Key';
  } catch (error) {
    console.error('API Key 驗證失敗:', error);
    showStatus(apiKeyStatus, `✗ ${error.message}`, 'error');
    verifyBtn.textContent = '驗證並儲存';
  } finally {
    verifyBtn.disabled = false;
  }
}

/**
 * 啟用字幕
 */
async function enableSubtitles() {
  enableBtn.disabled = true;
  statusText.textContent = '啟動中...';

  try {
    // 取得當前 tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('無法取得當前分頁');
    }

    // 發送啟用訊息到 Background
    const response = await chrome.runtime.sendMessage({
      type: MessageTypes.ENABLE_SUBTITLES,
      data: { tabId: tab.id },
    });

    if (response.success) {
      statusText.textContent = '✓ 已啟用字幕';
      statusText.className = 'status success';
      enableBtn.disabled = true;
      disableBtn.disabled = false;
    } else {
      throw new Error(response.error || '啟用失敗');
    }
  } catch (error) {
    statusText.textContent = `✗ ${error.message}`;
    statusText.className = 'status error';
    enableBtn.disabled = false;
  }
}

/**
 * 停用字幕
 */
async function disableSubtitles() {
  disableBtn.disabled = true;
  statusText.textContent = '停用中...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageTypes.DISABLE_SUBTITLES,
    });

    if (response.success) {
      statusText.textContent = '未啟用';
      statusText.className = 'status';
      enableBtn.disabled = false;
      disableBtn.disabled = true;
    } else {
      throw new Error(response.error || '停用失敗');
    }
  } catch (error) {
    statusText.textContent = `✗ ${error.message}`;
    statusText.className = 'status error';
    disableBtn.disabled = false;
  }
}

/**
 * 載入成本統計
 */
async function loadCostStats() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageTypes.GET_COST_STATS,
    });

    if (response.success) {
      const { whisper, gpt, total } = response.data;

      whisperCostEl.textContent = `$${whisper.cost.toFixed(4)}`;
      gptCostEl.textContent = `$${gpt.cost.toFixed(4)}`;
      totalCostEl.textContent = `$${total.toFixed(4)}`;
    }
  } catch (error) {
    console.error('載入成本統計失敗:', error);
  }
}

/**
 * 顯示狀態訊息
 */
function showStatus(element, message, type) {
  element.textContent = message;
  element.className = `status ${type}`;
}

// 事件監聽
verifyBtn.addEventListener('click', verifyApiKey);
enableBtn.addEventListener('click', enableSubtitles);
disableBtn.addEventListener('click', disableSubtitles);
refreshStatsBtn.addEventListener('click', loadCostStats);

// 初始化
init();
