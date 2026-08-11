import { parseListPage, buildHeaderIndex } from '../../parsing/listParser';
import { renderBadge } from './renderBadge';
import type { ExtensionMessage, ExtensionResponse, ReviewStatusLabel } from '../../shared/types';

const KNOWN_STATUS_LABELS: ReviewStatusLabel[] = ['대기', '승인', '보류', '숨김'];

function scrapeAllRowStatuses(table: HTMLTableElement): Array<{ review_id: string; review_status: ReviewStatusLabel }> {
  const statusIndex = buildHeaderIndex(table)['검수 상태'];
  if (statusIndex === undefined) return [];

  return Array.from(table.querySelectorAll('tbody tr')).flatMap((rowEl) => {
    const row = rowEl as HTMLTableRowElement;
    const reviewId = row.querySelector('button[data-id]')?.getAttribute('data-id');
    const status = row.cells[statusIndex]?.textContent?.trim() as ReviewStatusLabel;
    if (!reviewId || !KNOWN_STATUS_LABELS.includes(status)) return [];
    return [{ review_id: reviewId, review_status: status }];
  });
}

/**
 * "이 페이지 모의판정 실행" 클릭 시 실행되는 순수 오케스트레이션.
 * chrome.runtime.sendMessage 자체는 index.ts에서 주입한다.
 * 버튼 클릭은 명시적 사용자 행동이므로 지문이 같아도 항상 강제 재판정한다(force: true) —
 * 지문 캐시는 새로고침으로 지워지지 않아, 그것만으로는 재판정 로직 수정 후 재검수가 불가능했다.
 */
export async function runListPageFlow(
  table: HTMLTableElement,
  sendMessage: (message: ExtensionMessage) => Promise<ExtensionResponse>
): Promise<void> {
  const rows = parseListPage(table);

  const judgeResponse = await sendMessage({ type: 'JUDGE_LIST', rows, force: true });
  if (judgeResponse.type === 'ERROR') {
    alert(`모의판정 실패: ${judgeResponse.message}`);
    return;
  }
  if (judgeResponse.type === 'JUDGE_LIST_RESULT') {
    for (const entry of judgeResponse.entries) {
      const button = table.querySelector(`button[data-id="${entry.review_id}"]`);
      const rowEl = button?.closest('tr');
      if (rowEl) renderBadge(rowEl as HTMLElement, entry);
    }
  }

  const allStatuses = scrapeAllRowStatuses(table);
  if (allStatuses.length > 0) {
    await sendMessage({ type: 'CAPTURE_STATUS', rows: allStatuses });
  }
}
