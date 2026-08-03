import type { ListRowData, ReviewStatusLabel } from '../shared/types';
import type { ReviewType } from 'judgment-engine';

const REVIEW_TYPE_LABELS: Record<string, ReviewType> = {
  '티켓 사용 후기': 'TICKET_USE',
  '상담 후기': 'CONSULTATION',
  '현장 앱결제 후기': 'ONSITE_APP_PAYMENT',
  '영수증 후기': 'RECEIPT',
};

const KNOWN_STATUS_LABELS: ReviewStatusLabel[] = ['대기', '승인', '보류', '숨김'];

export function buildHeaderIndex(table: HTMLTableElement): Record<string, number> {
  const headerCells = Array.from(table.querySelectorAll('thead th'));
  const index: Record<string, number> = {};
  headerCells.forEach((cell, i) => {
    const label = cell.textContent?.trim() ?? '';
    if (label) index[label] = i;
  });
  return index;
}

function cellText(cells: HTMLCollectionOf<HTMLTableCellElement>, index: number | undefined): string {
  if (index === undefined) return '';
  return cells[index]?.textContent?.trim() ?? '';
}

/**
 * 목록 화면 실제 CSS 클래스는 미확인 상태 — 컬럼 헤더 텍스트로 위치를 찾는다.
 * 실사용 스모크 테스트(Task 19)에서 실제 마크업과 어긋나면 이 함수만 조정한다.
 */
export function parseListPage(table: HTMLTableElement): ListRowData[] {
  const headerIndex = buildHeaderIndex(table);
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const result: ListRowData[] = [];

  for (const row of rows) {
    const cells = row.cells;
    const statusText = cellText(cells, headerIndex['검수 상태']) as ReviewStatusLabel;
    if (!KNOWN_STATUS_LABELS.includes(statusText) || statusText !== '대기') continue;

    const reviewId = row.querySelector('button[data-id]')?.getAttribute('data-id');
    if (!reviewId) continue;

    const typeText = cellText(cells, headerIndex['후기 유형']);
    const review_type = REVIEW_TYPE_LABELS[typeText];
    if (!review_type) continue;

    const photoCellIndex = headerIndex['사진'];
    const imgs = photoCellIndex !== undefined ? Array.from(cells[photoCellIndex]?.querySelectorAll('img') ?? []) : [];
    const photos = imgs.map((img) => {
      const alt = img.getAttribute('alt')?.trim();
      if (alt === '전') return { url: img.src, declared_category: 'BEFORE_AFTER' as const, before_after_slot: 'BEFORE' as const };
      if (alt === '후') return { url: img.src, declared_category: 'BEFORE_AFTER' as const, before_after_slot: 'AFTER' as const };
      return { url: img.src, declared_category: 'GENERAL' as const };
    });

    result.push({
      review_id: reviewId,
      review_type,
      content_text: cellText(cells, headerIndex['후기 내용']),
      photos,
      review_status: statusText,
      modified_at: cellText(cells, headerIndex['수정 일시']),
      author: cellText(cells, headerIndex['작성자']),
    });
  }

  return result;
}
