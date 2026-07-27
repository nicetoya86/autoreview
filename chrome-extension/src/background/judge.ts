import type { AiAdapterConfig, DuplicateFlags, JudgmentResult, ReviewInput } from 'judgment-engine';
import { judgeReview } from 'judgment-engine';
import type { DetailPageData, ListRowData } from '../shared/types';

export async function judgeListRow(
  row: ListRowData,
  duplicateFlags: DuplicateFlags,
  aiConfig: AiAdapterConfig
): Promise<JudgmentResult> {
  const input: ReviewInput = {
    review_id: row.review_id,
    review_type: row.review_type,
    content_text: row.content_text,
    photos: row.photos,
    // 목록 단계에서는 '받은 시술' 텍스트를 신뢰성 있게 파싱할 수 없어 예외 없음으로 보수 처리한다.
    procedure: { is_before_after_exempt: false },
    receipt:
      row.review_type === 'RECEIPT'
        ? {
            amount_matches: null,
            date_matches: null,
            hospital_name_matches: null,
            photo_count: row.photos.filter((p) => p.declared_category === 'RECEIPT').length,
            is_app_payment_receipt: false,
          }
        : undefined,
    duplicate_flags: duplicateFlags,
    hospital_requested_takedown: false,
  };

  return judgeReview(input, aiConfig);
}

export async function judgeDetail(
  detail: DetailPageData,
  duplicateFlags: DuplicateFlags,
  aiConfig: AiAdapterConfig
): Promise<JudgmentResult> {
  const input: ReviewInput = {
    review_id: detail.review_id,
    review_type: detail.review_type,
    content_text: detail.content_text,
    photos: detail.photos,
    procedure: detail.procedure,
    receipt: detail.receipt,
    duplicate_flags: duplicateFlags,
    hospital_requested_takedown: detail.hospital_requested_takedown,
  };

  return judgeReview(input, aiConfig);
}
