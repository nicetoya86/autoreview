import { describe, it, expect } from 'vitest';
import { checkReceiptObjective } from '../src/rules/receipt';
import type { ReviewInput } from '../src/types';

function receiptInput(receipt: Partial<NonNullable<ReviewInput['receipt']>>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'RECEIPT',
    content_text: 'text',
    photos: [],
    procedure: { is_before_after_exempt: false },
    receipt: {
      amount_matches: true,
      date_matches: true,
      hospital_name_matches: true,
      photo_count: 1,
      is_app_payment_receipt: false,
      ...receipt,
    },
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
  };
}

describe('checkReceiptObjective', () => {
  it('모든 조건 충족 시 holdReason null, unconfirmed false', () => {
    const result = checkReceiptObjective(receiptInput({}));
    expect(result).toEqual({ holdReason: null, unconfirmed: false });
  });

  it('영수증 미등록(photo_count 0)', () => {
    const result = checkReceiptObjective(receiptInput({ photo_count: 0 }));
    expect(result.holdReason).toBe('receipt-missing');
  });

  it('다수 영수증 등록(photo_count > 1)', () => {
    const result = checkReceiptObjective(receiptInput({ photo_count: 2 }));
    expect(result.holdReason).toBe('receipt-multiple');
  });

  it('앱결제 영수증 등록', () => {
    const result = checkReceiptObjective(receiptInput({ is_app_payment_receipt: true }));
    expect(result.holdReason).toBe('receipt-app-payment');
  });

  it('결제금액 불일치', () => {
    const result = checkReceiptObjective(receiptInput({ amount_matches: false }));
    expect(result.holdReason).toBe('receipt-amount-mismatch');
  });

  it('결제일자 불일치', () => {
    const result = checkReceiptObjective(receiptInput({ date_matches: false }));
    expect(result.holdReason).toBe('receipt-date-mismatch');
  });

  it('병원명 불일치', () => {
    const result = checkReceiptObjective(receiptInput({ hospital_name_matches: false }));
    expect(result.holdReason).toBe('receipt-hospital-mismatch');
  });

  it('금액 일치 여부를 알 수 없으면(null) unconfirmed true', () => {
    const result = checkReceiptObjective(receiptInput({ amount_matches: null }));
    expect(result).toEqual({ holdReason: null, unconfirmed: true });
  });

  it('RECEIPT가 아닌 유형이면 항상 통과', () => {
    const input = receiptInput({});
    input.review_type = 'TICKET_USE';
    input.receipt = undefined;
    expect(checkReceiptObjective(input)).toEqual({ holdReason: null, unconfirmed: false });
  });
});
