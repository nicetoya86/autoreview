import { handleMessage } from './messageHandler';
import { createCacheStore } from './cache';
import { createPopupWindowController } from './popupWindow';
import { PROXY_URL } from '../shared/proxyConfig';
import type { ExtensionMessage } from '../shared/types';

const cacheStore = createCacheStore(chrome.storage.local);
const aiConfig = { proxyUrl: PROXY_URL };

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message, { cacheStore, aiConfig }).then(sendResponse, (err) => {
    console.error('[모의검수] 처리 실패', message.type, err);
    sendResponse({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
  });
  return true; // 비동기 응답을 위해 채널을 열어둔다
});

const popupController = createPopupWindowController(chrome.windows, chrome.runtime.getURL('src/popup/index.html'));

chrome.action.onClicked.addListener(() => {
  popupController.openOrFocus();
});

chrome.windows.onRemoved.addListener((windowId) => {
  popupController.handleClosed(windowId);
});
