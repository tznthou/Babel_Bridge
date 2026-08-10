/**
 * 測試 Service Worker → Content Script 訊息傳遞
 * 在 YouTube Console 執行
 */

(function testMessagePassing() {
  console.log('========================================');
  console.log('📨 測試訊息傳遞');
  console.log('========================================\n');

  // 設置訊息監聽器
  let messageReceived = false;

  const listener = (message, sender, sendResponse) => {
    console.log('📥 收到訊息:', message);
    messageReceived = true;
    sendResponse({ success: true, note: '測試腳本收到訊息' });
  };

  chrome.runtime.onMessage.addListener(listener);
  console.log('✅ 訊息監聽器已設置\n');

  // 等待 5 秒檢查
  setTimeout(() => {
    if (messageReceived) {
      console.log('✅ 在過去 5 秒內有收到訊息');
    } else {
      console.log('❌ 在過去 5 秒內沒有收到任何訊息');
      console.log('⚠️ 可能原因：');
      console.log('  1. Service Worker 沒有發送訊息');
      console.log('  2. Whisper API 辨識失敗');
      console.log('  3. OverlapProcessor 過濾掉所有 segments');
    }

    // 移除監聽器
    chrome.runtime.onMessage.removeListener(listener);
  }, 5000);

  // 手動發送測試訊息給 Service Worker
  console.log('📤 發送測試訊息給 Service Worker...');
  chrome.runtime.sendMessage({ type: 'PING', source: 'test-script' }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('❌ 發送失敗:', chrome.runtime.lastError.message);
    } else {
      console.log('✅ 收到 Service Worker 回應:', response);
    }
  });

  console.log('\n⏳ 等待 5 秒觀察訊息...');
})();
