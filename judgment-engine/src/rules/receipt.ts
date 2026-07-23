import type { ReviewInput } from '../types';

export interface ReceiptCheckResult {
  holdReason: string | null;
  unconfirmed: boolean;
}

/**
 * PRD 8.3 영수증 사진 조건 중 기계적으로 확인 가능한 것들만 체크한다.
 * amount/date/hospital_name matches가 null이면(OCR 자동 대사 불가) unconfirmed=true로
 * 반환해, 호출자가 NEEDS_REVIEW로 보낼 수 있게 한다 (스펙 §8 열린 질문).
 */
export function checkReceiptObjective(input: ReviewInput): ReceiptCheckResult {
  if (input.review_type !== 'RECEIPT' || !input.receipt) {
    return { holdReason: null, unconfirmed: false };
  }

  const r = input.receipt;

  if (r.photo_count === 0) return { holdReason: 'receipt-missing', unconfirmed: false };
  if (r.photo_count > 1) return { holdReason: 'receipt-multiple', unconfirmed: false };
  if (r.is_app_payment_receipt) return { holdReason: 'receipt-app-payment', unconfirmed: false };
  if (r.amount_matches === false) return { holdReason: 'receipt-amount-mismatch', unconfirmed: false };
  if (r.date_matches === false) return { holdReason: 'receipt-date-mismatch', unconfirmed: false };
  if (r.hospital_name_matches === false) return { holdReason: 'receipt-hospital-mismatch', unconfirmed: false };

  const unconfirmed = r.amount_matches === null || r.date_matches === null || r.hospital_name_matches === null;
  return { holdReason: null, unconfirmed };
}
