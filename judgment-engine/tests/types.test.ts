import { describe, it, expect } from 'vitest';
import type { ReviewInput, JudgmentResult } from '../src/types';

describe('types', () => {
  it('allows constructing a minimal ReviewInput and JudgmentResult', () => {
    const input: ReviewInput = {
      review_id: 'r1',
      review_type: 'TICKET_USE',
      content_text: '시술 후 만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
      procedure: { is_before_after_exempt: false },
      duplicate_flags: {
        same_customer: false,
        same_hospital_name: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: false,
      },
      hospital_requested_takedown: false,
    };

    const result: JudgmentResult = {
      review_id: 'r1',
      mock_judgment: 'APPROVE_CANDIDATE',
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [{ url: 'https://x/1.jpg', decision: 'APPROVED' }],
    };

    expect(input.review_id).toBe('r1');
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
  });
});
