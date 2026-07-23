import { describe, it, expect } from 'vitest';
import { isDuplicate } from '../src/rules/duplicate';
import type { ReviewInput } from '../src/types';

function baseInput(overrides: Partial<ReviewInput>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: 'text',
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

describe('isDuplicate', () => {
  it('TICKET_USE: 모든 조건 충족 시 true', () => {
    const input = baseInput({
      review_type: 'TICKET_USE',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: true,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('TICKET_USE: 한 조건이라도 false면 false', () => {
    const input = baseInput({
      review_type: 'TICKET_USE',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: false,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(false);
  });

  it('CONSULTATION: 시술이벤트가 없는 경우 그 조건은 무시', () => {
    const input = baseInput({
      review_type: 'CONSULTATION',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: false,
        procedure_event_exists: false,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('ONSITE_APP_PAYMENT: 시술이벤트 조건 자체가 없음', () => {
    const input = baseInput({
      review_type: 'ONSITE_APP_PAYMENT',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: false,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('RECEIPT: 동일 영수증만 있어도(OR) 중복', () => {
    const input = baseInput({
      review_type: 'RECEIPT',
      duplicate_flags: {
        same_customer: true,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: true,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('RECEIPT: 고객이 다르면 영수증이 같아도 중복 아님', () => {
    const input = baseInput({
      review_type: 'RECEIPT',
      duplicate_flags: {
        same_customer: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: true,
      },
    });
    expect(isDuplicate(input)).toBe(false);
  });

  it('CONSULTATION: 시술이벤트가 있는데 다르면 false (일반 AND 경로)', () => {
    const input = baseInput({
      review_type: 'CONSULTATION',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: false,
        procedure_event_exists: true,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(false);
  });

  it('알 수 없는 review_type이면 false (방어적 기본값)', () => {
    const input = baseInput({ review_type: 'UNKNOWN' as any });
    expect(isDuplicate(input)).toBe(false);
  });
});
