import { parseListPage, buildHeaderIndex } from '../../parsing/listParser';
import { renderBadge } from './renderBadge';
import type { ExtensionMessage, ExtensionResponse, ReviewStatusLabel } from '../../shared/types';

const KNOWN_STATUS_LABELS: ReviewStatusLabel[] = ['대기', '승인', '보류', '숨김'];
const DETAIL_LINK_PATTERN = /\/posts\/reviews\/detail\/(\d+)/;

function scrapeAllRowStatuses(table: HTMLTableElement): Array<{ review_id: string; review_status: ReviewStatusLabel }> {
  const statusIndex = buildHeaderIndex(table)['검수 상태'];
  if (statusIndex === undefined) return [];

  return Array.from(table.querySelectorAll('tbody tr')).flatMap((rowEl) => {
    const row = rowEl as HTMLTableRowElement;
    const link = row.querySelector('a[href*="/posts/reviews/detail/"]');
    const match = link?.getAttribute('href')?.match(DETAIL_LINK_PATTERN);
    const status = row.cells[statusIndex]?.textContent?.trim() as ReviewStatusLabel;
    if (!match || !KNOWN_STATUS_LABELS.includes(status)) return [];
    return [{ review_id: match[1], review_status: status }];
  });
}

/**
 * "이 페이지 모의판정 실행" 클릭 시 실행되는 순수 오케스트레이션.
 * chrome.runtime.sendMessage 자체는 index.ts에서 주입한다.
 */
export async function runListPageFlow(
  table: HTMLTableElement,
  sendMessage: (message: ExtensionMessage) => Promise<ExtensionResponse>
): Promise<void> {
  const rows = parseListPage(table);

  const judgeResponse = await sendMessage({ type: 'JUDGE_LIST', rows });
  if (judgeResponse.type === 'JUDGE_LIST_RESULT') {
    for (const entry of judgeResponse.entries) {
      const link = table.querySelector(`a[href*="/posts/reviews/detail/${entry.review_id}"]`);
      const rowEl = link?.closest('tr');
      if (rowEl) renderBadge(rowEl as HTMLElement, entry);
    }
  }

  const allStatuses = scrapeAllRowStatuses(table);
  if (allStatuses.length > 0) {
    await sendMessage({ type: 'CAPTURE_STATUS', rows: allStatuses });
  }
}
