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
  // 檢查是否已有 API Key
  const apiKey = await APIKeyManager.getKey();
  if (apiKey) {
    apiKeyInput.value = apiKey;
    showStatus(apiKeyStatus, '已設定 API Key', 'success');
  }

  // 載入成本統計
  await loadCostStats();
}

/**
 * 驗證 API Key
 */
async function verifyApiKey() {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus(apiKeyStatus, '請輸入 API Key', 'error');
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = '驗證中...';
  showStatus(apiKeyStatus, '正在驗證...', '');

  try {
    await APIKeyManager.verifyAndSave(apiKey);
    showStatus(apiKeyStatus, '✓ API Key 驗證成功並已儲存', 'success');
  } catch (error) {
    showStatus(apiKeyStatus, `✗ ${error.message}`, 'error');
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.textContent = '驗證並儲存';
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
