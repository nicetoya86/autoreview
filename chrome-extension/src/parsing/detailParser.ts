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

// 실사용 화면(admin.fastlane.kr) 확인 결과, 단순 값 필드는 dt/dd가 아니라
// label(.form-label) 다음에 오는 형제 블록의 .form-control 안에 값이 있다.
// (예: <label>사진 유형</label> ... <div class="form-control">...일반 사진...</div>)
function extractLabeledFields(root: ParentNode, labels: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const labelEls = root.querySelectorAll('label, .form-label');
  labelEls.forEach((labelEl) => {
    const label = labelEl.textContent?.trim() ?? '';
    if (!labels.includes(label)) return;
    const col = labelEl.closest('.col');
    const value = col?.querySelector('.form-control');
    if (value) result[label] = value.textContent?.trim() ?? '';
  });
  return result;
}

// '시술 후기 내용'/'상담 후기 내용'은 위 필드와 다르게 <h4> 제목 다음
// <textarea readonly>에 값이 담긴다.
function extractTextareaValue(root: ParentNode, heading: string): string | undefined {
  const headingEl = Array.from(root.querySelectorAll('h4')).find((el) => el.textContent?.trim() === heading);
  const textarea = headingEl?.parentElement?.parentElement?.querySelector('textarea');
  return textarea?.textContent?.trim() || undefined;
}

// 사진 영역은 data-value="photo" 박스 안에 있는데, 같은 화면에 "유사도가 높은
// 포토 후기 이미지"(다른 리뷰의 중복 검사용 사진) 박스도 같은 속성을 쓰므로
// 헤더 텍스트("후기 사진")로 실제 첨부 사진 박스만 골라야 한다.
// '시술 전'/'시술 후' 소제목이 있으면 그 그룹 안 사진만 해당 slot으로,
// 없으면 전부 GENERAL로 처리한다(사진 유형은 사진 한 장 단위가 아니라 리뷰 전체 단위 설정).
function parsePhotos(root: ParentNode): DetailPageData['photos'] {
  const photoSection = Array.from(root.querySelectorAll('[data-value="photo"]')).find(
    (box) => box.querySelector('p.font-semibold')?.textContent?.trim() === '후기 사진'
  );
  if (!photoSection) return [];

  const groups = Array.from(photoSection.querySelectorAll('p')).filter((p) => {
    const text = p.textContent?.trim();
    return text === '시술 전' || text === '시술 후';
  });

  if (groups.length === 0) {
    return Array.from(photoSection.querySelectorAll('img')).map((img) => ({
      url: (img as HTMLImageElement).src,
      declared_category: 'GENERAL' as const,
    }));
  }

  return groups.flatMap((group) => {
    const slot: 'BEFORE' | 'AFTER' = group.textContent?.trim() === '시술 전' ? 'BEFORE' : 'AFTER';
    const imgs = Array.from(group.parentElement?.querySelectorAll('img') ?? []);
    return imgs.map((img) => ({
      url: (img as HTMLImageElement).src,
      declared_category: 'BEFORE_AFTER' as const,
      before_after_slot: slot,
    }));
  });
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
    photo_count: parsePhotos(root).length,
    // 실제 화면에서 여신티켓 앱 결제 영수증을 구분하는 표시가 아직 확인되지 않음 — 확인 전까지 false로 보수적으로 처리하고, Task 19 스모크 테스트에서 실제 신호를 확인해 이 함수만 조정한다.
    is_app_payment_receipt: false,
  };
}

export function parseDetailPage(root: ParentNode, reviewId: string): DetailPageData {
  // 상세 화면은 후기 유형에 따라 '시술 후기 내용' 또는 '상담 후기 내용' 중 하나로 텍스트를 표시한다.
  // 텍스트 검수는 둘 다 대상이므로 있는 걸 전부 합쳐서 판정에 넘긴다.
  // '받은 시술'/'수정 일시' 라벨은 실사용 화면에서 아직 정확한 위치를 확인하지 못했다 —
  // 못 찾으면 undefined/빈 문자열로 안전하게 떨어진다(Task 19 스모크 테스트에서 재확인 필요).
  const fields = extractLabeledFields(root, ['후기유형', '수정 일시', '받은 시술', '병원명']);
  const review_type = REVIEW_TYPE_LABELS[fields['후기유형']] ?? 'TICKET_USE';

  const photos = parsePhotos(root);

  const procedureName = fields['받은 시술'] || undefined;

  const content_text = [extractTextareaValue(root, '시술 후기 내용'), extractTextareaValue(root, '상담 후기 내용')]
    .filter((v): v is string => !!v)
    .join('\n');

  return {
    review_id: reviewId,
    review_type,
    content_text,
    photos,
    hospital_name: fields['병원명'] || undefined,
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
