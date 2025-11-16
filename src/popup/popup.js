/**
 * Popup UI 控制邏輯
 */
import { APIKeyManager } from '../lib/api-key-manager.js';
import { DeepgramKeyManager } from '../lib/deepgram-key-manager.js';
import { MessageTypes } from '../lib/config.js';

// DOM 元素 - Tab 切換
const tabs = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');

// DOM 元素 - OpenAI
const openaiApiKeyInput = document.getElementById('openai-api-key-input');
const verifyOpenaiBtn = document.getElementById('verify-openai-btn');
const openaiApiKeyStatus = document.getElementById('openai-api-key-status');
const openaiKeyInfo = document.getElementById('openai-key-info');
const openaiKeyMasked = document.getElementById('openai-key-masked');
const openaiKeyVerified = document.getElementById('openai-key-verified');
const removeOpenaiKeyBtn = document.getElementById('remove-openai-key');

// DOM 元素 - Deepgram
const deepgramApiKeyInput = document.getElementById('deepgram-api-key-input');
const verifyDeepgramBtn = document.getElementById('verify-deepgram-btn');
const deepgramApiKeyStatus = document.getElementById('deepgram-api-key-status');
const deepgramKeyInfo = document.getElementById('deepgram-key-info');
const deepgramKeyMasked = document.getElementById('deepgram-key-masked');
const deepgramKeyVerified = document.getElementById('deepgram-key-verified');
const deepgramProjectUuid = document.getElementById('deepgram-project-uuid');
const deepgramScopes = document.getElementById('deepgram-scopes');
const removeDeepgramKeyBtn = document.getElementById('remove-deepgram-key');

// DOM 元素 - 字幕控制
const enableBtn = document.getElementById('enable-btn');
const disableBtn = document.getElementById('disable-btn');
const statusText = document.getElementById('status-text');

// DOM 元素 - 成本統計
const whisperCostEl = document.getElementById('whisper-cost');
const gptCostEl = document.getElementById('gpt-cost');
const totalCostEl = document.getElementById('total-cost');
const refreshStatsBtn = document.getElementById('refresh-stats-btn');

/**
 * Tab 切換功能
 */
function initTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchToTab(tabName);
    });
  });
}

/**
 * 切換到指定 Tab
 * @param {string} tabName - Tab 名稱 ('openai' 或 'deepgram')
 */
function switchToTab(tabName) {
  // 移除所有 active 狀態
  tabs.forEach((t) => t.classList.remove('active'));
  tabPanels.forEach((p) => p.classList.remove('active'));

  // 添加 active 到指定 tab
  const targetTab = document.querySelector(`[data-tab="${tabName}"]`);
  const targetPanel = document.getElementById(`${tabName}-panel`);

  if (targetTab && targetPanel) {
    targetTab.classList.add('active');
    targetPanel.classList.add('active');
  }
}

/**
 * 初始化 UI
 */
async function init() {
  // 初始化 Tab 切換
  initTabs();

  try {
  // 載入 OpenAI API Key 狀態
    await loadOpenaiKeyInfo();

    // 載入 Deepgram API Key 狀態
    await loadDeepgramKeyInfo();

    // 載入成本統計
    await loadCostStats();
  } catch (error) {
    console.error('初始化失敗:', error);
  }
}

/**
 * 載入 OpenAI API Key 資訊
 */
async function loadOpenaiKeyInfo() {
  try {
    const hasKey = await APIKeyManager.hasKey();

    if (hasKey) {
      const apiKey = await APIKeyManager.getKey();
      const maskedKey = APIKeyManager.maskKey(apiKey);

      // 顯示 Key 資訊
      openaiKeyMasked.textContent = maskedKey;
      openaiKeyVerified.textContent = '已驗證並加密儲存';
      openaiKeyInfo.classList.remove('hidden');

      // 隱藏輸入框
      openaiApiKeyInput.parentElement.style.display = 'none';
      openaiApiKeyStatus.textContent = '';
    } else {
      // 顯示輸入框
      openaiKeyInfo.classList.add('hidden');
      openaiApiKeyInput.parentElement.style.display = 'flex';
    }
  } catch (error) {
    console.error('[Popup] 載入 OpenAI Key 失敗:', error);

    if (
      error.code === 'CRYPTO_DECRYPTION_FAILED' ||
      error.code === 'API_KEY_MISSING'
    ) {
      showStatus(
        openaiApiKeyStatus,
        '⚠️ API Key 解密失敗，請重新設定',
        'error'
      );
      openaiKeyInfo.classList.add('hidden');
      openaiApiKeyInput.parentElement.style.display = 'flex';
    }
  }
}

/**
 * 載入 Deepgram API Key 資訊
 */
async function loadDeepgramKeyInfo() {
  try {
    const info = await DeepgramKeyManager.getKeyInfo();

    if (info.hasKey) {
      const apiKey = await DeepgramKeyManager.getKey();
      const maskedKey = DeepgramKeyManager.maskKey(apiKey);

      // 顯示 Key 資訊
      deepgramKeyMasked.textContent = maskedKey;

      const verifiedDate = new Date(info.verifiedAt);
      deepgramKeyVerified.textContent = `已驗證 (${verifiedDate.toLocaleDateString()})`;

      deepgramProjectUuid.textContent = info.projectUuid || 'N/A';
      deepgramScopes.textContent = info.scopes.join(', ') || 'N/A';

      deepgramKeyInfo.classList.remove('hidden');

      // 隱藏輸入框
      deepgramApiKeyInput.parentElement.style.display = 'none';
      deepgramApiKeyStatus.textContent = '';
    } else {
      // 顯示輸入框
      deepgramKeyInfo.classList.add('hidden');
      deepgramApiKeyInput.parentElement.style.display = 'flex';
    }
  } catch (error) {
    console.error('[Popup] 載入 Deepgram Key 失敗:', error);

    if (
      error.code === 'DEEPGRAM_API_KEY_DECRYPT_FAILED' ||
      error.code === 'DEEPGRAM_API_KEY_NOT_FOUND'
    ) {
      showStatus(
        deepgramApiKeyStatus,
        '⚠️ API Key 解密失敗，請重新設定',
        'error'
      );
      deepgramKeyInfo.classList.add('hidden');
      deepgramApiKeyInput.parentElement.style.display = 'flex';
    }
  }
}

/**
 * 驗證 OpenAI API Key
 */
async function verifyOpenaiKey() {
  const apiKey = openaiApiKeyInput.value.trim();

  if (!apiKey) {
    showStatus(openaiApiKeyStatus, '請輸入 OpenAI API Key', 'error');
    return;
  }

  verifyOpenaiBtn.disabled = true;
  verifyOpenaiBtn.textContent = '驗證中...';
  showStatus(openaiApiKeyStatus, '正在驗證並加密 API Key...', '');

  try {
    const result = await APIKeyManager.verifyAndSave(apiKey);

    showStatus(
      openaiApiKeyStatus,
      `✓ ${result.keyType} 驗證成功並已加密儲存 (可用模型: ${result.modelsCount})`,
      'success'
    );

    // 重新載入 Key 資訊
    await loadOpenaiKeyInfo();

    // 清空輸入框
    openaiApiKeyInput.value = '';

    // 驗證成功後自動切換到 OpenAI Tab
    switchToTab('openai');
  } catch (error) {
    console.error('[Popup] OpenAI Key 驗證失敗:', error);
    showStatus(openaiApiKeyStatus, `✗ ${error.message}`, 'error');
  } finally {
    verifyOpenaiBtn.disabled = false;
    verifyOpenaiBtn.textContent = '驗證並儲存';
  }
}

/**
 * 驗證 Deepgram API Key
 */
async function verifyDeepgramKey() {
  const apiKey = deepgramApiKeyInput.value.trim();

  if (!apiKey) {
    showStatus(deepgramApiKeyStatus, '請輸入 Deepgram API Key', 'error');
    return;
  }

  verifyDeepgramBtn.disabled = true;
  verifyDeepgramBtn.textContent = '驗證中...';
  showStatus(deepgramApiKeyStatus, '正在驗證並加密 API Key...', '');

  try {
    const result = await DeepgramKeyManager.verifyAndSave(apiKey);

    showStatus(
      deepgramApiKeyStatus,
      `✓ 驗證成功！Project: ${result.projectUuid}`,
      'success'
    );

    // 重新載入 Key 資訊
    await loadDeepgramKeyInfo();

    // 清空輸入框
    deepgramApiKeyInput.value = '';

    // 驗證成功後自動切換到 Deepgram Tab
    switchToTab('deepgram');
  } catch (error) {
    console.error('[Popup] Deepgram Key 驗證失敗:', error);
    showStatus(deepgramApiKeyStatus, `✗ ${error.message}`, 'error');
  } finally {
    verifyDeepgramBtn.disabled = false;
    verifyDeepgramBtn.textContent = '驗證並儲存';
  }
}

/**
 * 移除 OpenAI API Key
 */
async function removeOpenaiKey() {
  if (!confirm('確定要移除 OpenAI API Key 嗎？')) {
    return;
  }

  try {
    await APIKeyManager.removeKey();
    showStatus(openaiApiKeyStatus, '✓ API Key 已移除', 'success');

    // 重新載入 UI
    await loadOpenaiKeyInfo();
  } catch (error) {
    console.error('[Popup] 移除 OpenAI Key 失敗:', error);
    showStatus(openaiApiKeyStatus, `✗ ${error.message}`, 'error');
  }
}

/**
 * 移除 Deepgram API Key
 */
async function removeDeepgramKey() {
  if (!confirm('確定要移除 Deepgram API Key 嗎？')) {
    return;
  }

  try {
    await DeepgramKeyManager.removeKey();
    showStatus(deepgramApiKeyStatus, '✓ API Key 已移除', 'success');

    // 重新載入 UI
    await loadDeepgramKeyInfo();
  } catch (error) {
    console.error('[Popup] 移除 Deepgram Key 失敗:', error);
    showStatus(deepgramApiKeyStatus, `✗ ${error.message}`, 'error');
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
      // 友善的錯誤提示
      throw new Error(response.error || '啟用失敗');
    }
  } catch (error) {
    // 針對「沒有影片」的錯誤，顯示更友善的訊息
    const errorMessage = error.message.includes('沒有影片')
      ? '⚠️ ' + error.message
      : `✗ ${error.message}`;

    statusText.textContent = errorMessage;
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

// 事件監聽 - OpenAI
verifyOpenaiBtn.addEventListener('click', verifyOpenaiKey);
removeOpenaiKeyBtn.addEventListener('click', removeOpenaiKey);

// 事件監聽 - Deepgram
verifyDeepgramBtn.addEventListener('click', verifyDeepgramKey);
removeDeepgramKeyBtn.addEventListener('click', removeDeepgramKey);

// 事件監聽 - 字幕控制
enableBtn.addEventListener('click', enableSubtitles);
disableBtn.addEventListener('click', disableSubtitles);

// 事件監聽 - 成本統計
refreshStatsBtn.addEventListener('click', loadCostStats);

// 初始化
init();
