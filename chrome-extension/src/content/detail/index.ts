import { runDetailPageFlow } from './detailPageFlow';
import type { ExtensionMessage, ExtensionResponse } from '../../shared/types';

function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message);
}

function extractReviewId(): string | null {
  const match = window.location.pathname.match(/\/posts\/reviews\/detail\/(\d+)/);
  return match ? match[1] : null;
}

const root = document.querySelector('.review-detail') as HTMLElement | null;
const reviewId = extractReviewId();

if (root && reviewId) {
  const panelContainer = document.createElement('div');
  panelContainer.className = 'rvw-mock-panel-container';
  root.parentElement?.insertBefore(panelContainer, root);
  runDetailPageFlow(root, panelContainer, reviewId, sendMessage);
}
