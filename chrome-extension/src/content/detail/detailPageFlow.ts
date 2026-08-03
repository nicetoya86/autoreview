import { parseDetailPage } from '../../parsing/detailParser';
import { renderPanel } from './renderPanel';
import type { CacheEntry, ExtensionMessage, ExtensionResponse } from '../../shared/types';

export async function runDetailPageFlow(
  root: HTMLElement,
  panelContainer: HTMLElement,
  reviewId: string,
  sendMessage: (message: ExtensionMessage) => Promise<ExtensionResponse>
): Promise<void> {
  const cacheResponse = await sendMessage({ type: 'GET_CACHE', reviewId });
  let currentEntry: CacheEntry | null = cacheResponse.type === 'CACHE_ENTRY' ? cacheResponse.entry : null;

  const draw = () => {
    renderPanel(panelContainer, currentEntry, {
      onJudge: async () => {
        const detail = parseDetailPage(root, reviewId);
        const response = await sendMessage({ type: 'JUDGE_DETAIL', detail });
        if (response.type === 'ERROR') {
          alert(`모의판정 실패: ${response.message}`);
          return;
        }
        if (response.type === 'JUDGE_DETAIL_RESULT') {
          currentEntry = response.entry;
          draw();
        }
      },
      onFeedback: async (feedback) => {
        const response = await sendMessage({ type: 'SAVE_FEEDBACK', reviewId, feedback });
        if (response.type === 'FEEDBACK_SAVED' && response.entry) {
          currentEntry = response.entry;
          draw();
        }
      },
    });
  };

  draw();
}
