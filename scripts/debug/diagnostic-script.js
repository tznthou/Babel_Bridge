/**
 * Babel Bridge 字幕顯示診斷腳本
 * 使用方式：
 * 1. 在 YouTube 頁面開啟 DevTools Console (F12)
 * 2. 複製整個檔案內容
 * 3. 貼到 Console 並按 Enter
 * 4. 查看診斷結果
 */

(async function babelBridgeDiagnose() {
  console.log('========================================');
  console.log('🔍 Babel Bridge 字幕顯示診斷工具');
  console.log('========================================\n');

  const results = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    checks: {},
  };

  // ==================== 檢查 1: Content Script 注入 ====================
  console.log('📋 檢查 1: Content Script 是否注入');
  console.log('─────────────────────────────────────');

  results.checks.contentScriptInjected = {
    hasBabelBridge: typeof window.babelBridge !== 'undefined',
    hasSubtitleOverlay: typeof SubtitleOverlay !== 'undefined',
    hasVideoMonitor: typeof VideoMonitor !== 'undefined',
    scriptTags: Array.from(document.querySelectorAll('script'))
      .filter((s) => s.src.includes('babel') || s.src.includes('content'))
      .map((s) => s.src),
  };

  console.log('window.babelBridge:', results.checks.contentScriptInjected.hasBabelBridge);
  console.log('SubtitleOverlay:', results.checks.contentScriptInjected.hasSubtitleOverlay);
  console.log('VideoMonitor:', results.checks.contentScriptInjected.hasVideoMonitor);
  console.log('相關 script 標籤:', results.checks.contentScriptInjected.scriptTags);

  if (results.checks.contentScriptInjected.hasBabelBridge) {
    console.log('✅ Content Script 已注入');
  } else {
    console.log('❌ Content Script 未注入');
  }
  console.log('');

  // ==================== 檢查 2: 字幕容器 ====================
  console.log('📋 檢查 2: 字幕容器是否建立');
  console.log('─────────────────────────────────────');

  const overlay = document.querySelector('#babel-bridge-subtitle-overlay');
  results.checks.subtitleContainer = {
    exists: !!overlay,
    display: overlay?.style.display || 'N/A',
    innerHTML: overlay?.innerHTML || 'N/A',
    position: overlay ? overlay.getBoundingClientRect() : null,
    allBabelElements: Array.from(document.querySelectorAll('[id*="babel"], [class*="babel"]')).map(
      (el) => ({
        tag: el.tagName,
        id: el.id,
        class: el.className,
        visible: window.getComputedStyle(el).display !== 'none',
      })
    ),
  };

  console.log('容器存在:', results.checks.subtitleContainer.exists);
  if (overlay) {
    console.log('display:', results.checks.subtitleContainer.display);
    console.log('innerHTML:', results.checks.subtitleContainer.innerHTML);
    console.log('位置:', results.checks.subtitleContainer.position);
    console.log('✅ 字幕容器存在');
  } else {
    console.log('❌ 字幕容器不存在');
  }
  console.log('所有 Babel 相關元素:', results.checks.subtitleContainer.allBabelElements);
  console.log('');

  // ==================== 檢查 3: CSS 樣式 ====================
  console.log('📋 檢查 3: CSS 樣式是否載入');
  console.log('─────────────────────────────────────');

  const stylesheets = Array.from(document.styleSheets);
  const babelCSS = stylesheets.find((s) => s.href && s.href.includes('subtitle-overlay'));

  const allRules = stylesheets.flatMap((sheet) => {
    try {
      return Array.from(sheet.cssRules || []);
    } catch (e) {
      return [];
    }
  });
  const babelRules = allRules.filter(
    (r) =>
      r.selectorText &&
      (r.selectorText.includes('babel-bridge') || r.selectorText.includes('babel-subtitle'))
  );

  results.checks.cssLoaded = {
    hasBabelCSS: !!babelCSS,
    cssHref: babelCSS?.href || 'N/A',
    ruleCount: babelRules.length,
    rules: babelRules.map((r) => r.selectorText),
  };

  console.log('Babel Bridge CSS 存在:', results.checks.cssLoaded.hasBabelCSS);
  console.log('CSS 檔案:', results.checks.cssLoaded.cssHref);
  console.log('CSS 規則數量:', results.checks.cssLoaded.ruleCount);
  console.log('CSS 規則:', results.checks.cssLoaded.rules);

  if (babelRules.length > 0) {
    console.log('✅ CSS 已載入');
  } else {
    console.log('❌ CSS 未載入');
  }
  console.log('');

  // ==================== 檢查 4: 手動測試字幕顯示 ====================
  console.log('📋 檢查 4: 手動測試字幕顯示');
  console.log('─────────────────────────────────────');

  // 移除舊的測試容器（如果存在）
  const oldTest = document.querySelector('#babel-bridge-subtitle-test');
  if (oldTest) oldTest.remove();

  // 建立測試容器
  const testOverlay = document.createElement('div');
  testOverlay.id = 'babel-bridge-subtitle-test';
  testOverlay.style.cssText = `
    position: fixed;
    bottom: 50px;
    left: 0;
    right: 0;
    z-index: 2147483647;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    pointer-events: none;
  `;

  const testSubtitle = document.createElement('div');
  testSubtitle.style.cssText = `
    background: rgba(0, 0, 0, 0.85);
    color: #ffffff;
    font-size: 24px;
    font-family: Arial, sans-serif;
    padding: 12px 24px;
    border-radius: 8px;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
    max-width: 80%;
    text-align: center;
    line-height: 1.4;
  `;
  testSubtitle.textContent = '🎬 測試字幕 - Babel Bridge 診斷工具 - Test Subtitle';

  testOverlay.appendChild(testSubtitle);
  document.body.appendChild(testOverlay);

  results.checks.manualTest = {
    testContainerCreated: true,
    testContainerId: 'babel-bridge-subtitle-test',
    instruction: '請查看影片畫面底部是否有黑底白字的測試字幕',
  };

  console.log('✅ 測試字幕已建立');
  console.log('⚠️ 請查看影片畫面底部是否有黑底白字的測試字幕');
  console.log('測試容器 ID:', 'babel-bridge-subtitle-test');

  // 3 秒後自動移除測試字幕
  setTimeout(() => {
    testOverlay.remove();
    console.log('✅ 測試字幕已自動移除');
  }, 5000);
  console.log('');

  // ==================== 檢查 5: Extension Context ====================
  console.log('📋 檢查 5: Chrome Extension Context');
  console.log('─────────────────────────────────────');

  results.checks.extensionContext = {
    chromeAvailable: typeof chrome !== 'undefined',
    runtimeAvailable: typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined',
    extensionId: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : 'N/A',
  };

  console.log('chrome 存在:', results.checks.extensionContext.chromeAvailable);
  console.log('chrome.runtime 存在:', results.checks.extensionContext.runtimeAvailable);
  console.log('Extension ID:', results.checks.extensionContext.extensionId);

  if (results.checks.extensionContext.runtimeAvailable) {
    console.log('✅ Extension Context 正常');
  } else {
    console.log('❌ Extension Context 不可用');
  }
  console.log('');

  // ==================== 檢查 6: 影片元素 ====================
  console.log('📋 檢查 6: 影片元素');
  console.log('─────────────────────────────────────');

  const video = document.querySelector('video');
  results.checks.videoElement = {
    exists: !!video,
    currentTime: video?.currentTime || 0,
    duration: video?.duration || 0,
    paused: video?.paused || true,
    src: video?.src || video?.currentSrc || 'N/A',
  };

  console.log('影片元素存在:', results.checks.videoElement.exists);
  if (video) {
    console.log('當前時間:', results.checks.videoElement.currentTime);
    console.log('總長度:', results.checks.videoElement.duration);
    console.log('暫停狀態:', results.checks.videoElement.paused);
    console.log('✅ 影片元素正常');
  } else {
    console.log('❌ 影片元素不存在');
  }
  console.log('');

  // ==================== 總結 ====================
  console.log('========================================');
  console.log('📊 診斷結果總結');
  console.log('========================================');

  const issues = [];

  if (!results.checks.contentScriptInjected.hasBabelBridge) {
    issues.push('❌ Content Script 未注入');
  }
  if (!results.checks.subtitleContainer.exists) {
    issues.push('❌ 字幕容器不存在');
  }
  if (results.checks.cssLoaded.ruleCount === 0) {
    issues.push('⚠️ CSS 規則未找到');
  }
  if (!results.checks.extensionContext.runtimeAvailable) {
    issues.push('❌ Extension Context 不可用');
  }
  if (!results.checks.videoElement.exists) {
    issues.push('❌ 影片元素不存在');
  }

  if (issues.length === 0) {
    console.log('✅ 所有基礎檢查通過');
    console.log('⚠️ 但字幕仍未顯示，可能是訊息傳遞問題');
  } else {
    console.log('發現以下問題：');
    issues.forEach((issue) => console.log(issue));
  }

  console.log('');
  console.log('========================================');
  console.log('📋 完整診斷資料（請複製給開發者）');
  console.log('========================================');
  console.log(JSON.stringify(results, null, 2));
  console.log('');
  console.log('⚠️ 注意：測試字幕將在 5 秒後自動移除');

  return results;
})();
