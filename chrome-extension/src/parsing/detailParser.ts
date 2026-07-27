import type { DetailPageData } from '../shared/types';
import type { ReviewType } from 'judgment-engine';

const REVIEW_TYPE_LABELS: Record<string, ReviewType> = {
  '티켓 사용 후기': 'TICKET_USE',
  '상담 후기': 'CONSULTATION',
  '현장 앱결제 후기': 'ONSITE_APP_PAYMENT',
  '영수증 후기': 'RECEIPT',
};

// PRD §8.0 예외 규칙 중 문서에 명시된 예시만 반영 (브라질리언 제모).
// 그 외 시술의 전/후 촬영 예외 여부는 실사용 검증 후 목록을 넓힌다.
const BEFORE_AFTER_EXEMPT_PROCEDURES = ['브라질리언 제모'];

function extractLabeledFields(root: ParentNode, labels: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const dts = root.querySelectorAll('dt');
  dts.forEach((dt) => {
    const label = dt.textContent?.trim() ?? '';
    if (!labels.includes(label)) return;
    const value = dt.nextElementSibling;
    if (value) result[label] = value.textContent?.trim() ?? '';
  });
  return result;
}

function compareReceiptValue(input?: string, registered?: string): boolean | null {
  if (!input || !registered) return null;
  return input === registered;
}

function parseReceiptFields(root: ParentNode): DetailPageData['receipt'] {
  const fieldRows = Array.from(root.querySelectorAll('.receipt-field'));
  if (fieldRows.length === 0) return undefined;

  const values: Record<string, { input?: string; registered?: string }> = {};
  fieldRows.forEach((row) => {
    const label = row.querySelector('dt')?.textContent?.trim() ?? '';
    const input = row.querySelector('.input-value')?.textContent?.trim() || undefined;
    const registered = row.querySelector('.registered-value')?.textContent?.trim() || undefined;
    values[label] = { input, registered };
  });

  return {
    amount_matches: compareReceiptValue(values['결제금액']?.input, values['결제금액']?.registered),
    date_matches: compareReceiptValue(values['결제일']?.input, values['결제일']?.registered),
    hospital_name_matches: compareReceiptValue(values['병원명']?.input, values['병원명']?.registered),
    photo_count: root.querySelectorAll('.photos img').length,
    // 실제 화면에서 여신티켓 앱 결제 영수증을 구분하는 표시가 아직 확인되지 않음 — 확인 전까지 false로 보수적으로 처리하고, Task 19 스모크 테스트에서 실제 신호를 확인해 이 함수만 조정한다.
    is_app_payment_receipt: false,
  };
}

export function parseDetailPage(root: ParentNode, reviewId: string): DetailPageData {
  const fields = extractLabeledFields(root, ['후기유형', '후기 내용', '수정 일시', '받은 시술']);
  const review_type = REVIEW_TYPE_LABELS[fields['후기유형']] ?? 'TICKET_USE';

  const photos = Array.from(root.querySelectorAll('.photos img')).map((img) => ({
    url: (img as HTMLImageElement).src,
    declared_category: 'GENERAL' as const,
  }));

  const procedureName = fields['받은 시술'] || undefined;

  return {
    review_id: reviewId,
    review_type,
    content_text: fields['후기 내용'] ?? '',
    photos,
    procedure: {
      name: procedureName,
      is_before_after_exempt: procedureName ? BEFORE_AFTER_EXEMPT_PROCEDURES.includes(procedureName) : false,
    },
    receipt: review_type === 'RECEIPT' ? parseReceiptFields(root) : undefined,
    // 병원 게시중단 요청은 이미 승인된 후기에만 발생하는 별도 프로세스이며,
    // 이 파서는 '대기' 상태 후기만 다루므로 항상 false (스펙 §5 에러 처리 참고).
    hospital_requested_takedown: false,
    modified_at: fields['수정 일시'] ?? '',
  };
}
