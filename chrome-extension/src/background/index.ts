import { handleMessage } from './messageHandler';
import { createCacheStore } from './cache';
import { PROXY_URL } from '../shared/proxyConfig';
import type { ExtensionMessage } from '../shared/types';

const cacheStore = createCacheStore(chrome.storage.local);
const aiConfig = { proxyUrl: PROXY_URL };

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message, { cacheStore, aiConfig }).then(sendResponse);
  return true; // 비동기 응답을 위해 채널을 열어둔다
});
