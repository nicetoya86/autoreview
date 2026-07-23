import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeReview } from '../src/engine';
import type { ReviewInput } from '../src/types';

function baseInput(overrides: Partial<ReviewInput>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '시술 후 만족스러웠어요',
    photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('judgeReview', () => {
  it('객관적 규칙으로 확정되면 AI를 호출하지 않음', async () => {
    global.fetch = vi.fn();
    const input = baseInput({ hospital_requested_takedown: true });

    const result = await judgeReview(input, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.ai_invoked).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('객관적 규칙이 없으면 AI를 호출해 결과를 매핑', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content_relevant: true,
        content_flag: null,
        photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
        confidence: 0.9,
        reasoning: 'ok',
      }),
    } as unknown as Response);

    const result = await judgeReview(baseInput({}), { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.ai_invoked).toBe(true);
  });

  it('AI 호출이 실패해도 예외를 던지지 않고 NEEDS_REVIEW를 반환', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await judgeReview(baseInput({}), { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.ai_invoked).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'ai_error' }]);
  });
});
