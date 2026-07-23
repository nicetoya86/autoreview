import { describe, it, expect } from 'vitest';
import { runObjectiveRules } from '../src/rules/objectiveRules';
import type { ReviewInput } from '../src/types';

function baseInput(overrides: Partial<ReviewInput>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '시술 후 만족스러웠어요',
    photos: [],
    procedure: { is_before_after_exempt: false },
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
    ...overrides,
  };
}

describe('runObjectiveRules', () => {
  it('병원 게시중단 요청이면 즉시 NEEDS_REVIEW', () => {
    const result = runObjectiveRules(baseInput({ hospital_requested_takedown: true }));
    expect(result).toMatchObject({ decided: true, mock_judgment: 'NEEDS_REVIEW' });
  });

  it('중복이면 즉시 AUTO_HOLD_CANDIDATE', () => {
    const result = runObjectiveRules(
      baseInput({
        duplicate_flags: {
          same_customer: true,
          same_written_at: true,
          same_procedure_event: true,
          same_content: true,
          same_photo: true,
          same_receipt: false,
        },
      })
    );
    expect(result).toMatchObject({ decided: true, mock_judgment: 'AUTO_HOLD_CANDIDATE' });
    if (result.decided) expect(result.matched_rules).toContain('8.4-duplicate');
  });

  it('영수증 금액 불일치면 즉시 AUTO_HOLD_CANDIDATE', () => {
    const result = runObjectiveRules(
      baseInput({
        review_type: 'RECEIPT',
        receipt: {
          amount_matches: false,
          date_matches: true,
          hospital_name_matches: true,
          photo_count: 1,
          is_app_payment_receipt: false,
        },
      })
    );
    expect(result).toMatchObject({ decided: true, mock_judgment: 'AUTO_HOLD_CANDIDATE' });
    if (result.decided) expect(result.matched_rules).toContain('receipt-amount-mismatch');
  });

  it('의미 불명 텍스트면 즉시 AUTO_HOLD_CANDIDATE', () => {
    const result = runObjectiveRules(baseInput({ content_text: 'ㄱㄴㄷㄹㅁ' }));
    expect(result).toMatchObject({ decided: true, mock_judgment: 'AUTO_HOLD_CANDIDATE' });
  });

  it('영수증 필드 확인 불가면 NEEDS_REVIEW', () => {
    const result = runObjectiveRules(
      baseInput({
        review_type: 'RECEIPT',
        receipt: {
          amount_matches: null,
          date_matches: true,
          hospital_name_matches: true,
          photo_count: 1,
          is_app_payment_receipt: false,
        },
      })
    );
    expect(result).toMatchObject({ decided: true, mock_judgment: 'NEEDS_REVIEW' });
  });

  it('아무 객관적 사유도 없으면 decided: false (AI 필요)', () => {
    const result = runObjectiveRules(baseInput({}));
    expect(result).toEqual({ decided: false });
  });
});
