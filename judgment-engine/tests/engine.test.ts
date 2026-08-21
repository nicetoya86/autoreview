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
    expect(result.matched_rules).toEqual(['ai-error']);
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'ai_error' }]);
  });

  it('Gemini가 노출/민감 사진을 세이프티 정책으로 차단하면 ai-safety-block으로 구분해 NEEDS_REVIEW를 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'blocked_by_safety_filter', block_reason: 'OTHER' }),
    } as unknown as Response);

    const result = await judgeReview(baseInput({}), { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.ai_invoked).toBe(true);
    expect(result.matched_rules).toEqual(['ai-safety-block']);
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'ai_safety_block' }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('korcen이 욕설 후보로 표시해도 여기서 바로 보류하지 않고 AI에게 profanity_candidate로 넘겨 재확인시킨다', async () => {
    let capturedBody: string | undefined;
    global.fetch = vi.fn(async (url: string, options: RequestInit) => {
      capturedBody = options.body as string;
      return {
        ok: true,
        json: async () => ({
          content_relevant: true,
          content_flag: null, // AI가 재확인한 결과 실제로는 욕설이 아니라고 판단(korcen 오탐)
          photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
          confidence: 0.9,
          reasoning: 'korcen이 후보로 표시했으나 실제로는 정상적인 문장',
        }),
      } as unknown as Response;
    });

    const result = await judgeReview(baseInput({ content_text: '시발 개짜증나네' }), {
      proxyUrl: 'https://proxy.example/api/judge-content',
    });

    expect(JSON.parse(capturedBody!)).toMatchObject({ profanity_candidate: true });
    // AI가 실제 욕설이 아니라고 재확인했으므로 korcen 후보만으로 보류하지 않는다
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.matched_rules).not.toContain('contains-profanity');
  });

  it('AI가 profanity_candidate 재확인 결과 실제 욕설이라고 판단하면(content_flag: profanity) AUTO_HOLD_CANDIDATE', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content_relevant: true,
        content_flag: 'profanity',
        photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
        confidence: 0.9,
        reasoning: '실제 욕설 확인됨',
      }),
    } as unknown as Response);

    const result = await judgeReview(baseInput({ content_text: '시발 개짜증나네' }), {
      proxyUrl: 'https://proxy.example/api/judge-content',
    });

    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
    expect(result.matched_rules).toContain('ai-content-profanity');
  });

  it('객관적 규칙 확정 경로에서 photos가 손상되어도 예외 대신 NEEDS_REVIEW를 반환', async () => {
    global.fetch = vi.fn();
    // hospital_requested_takedown: true → runObjectiveRules가 decided:true를 반환하고,
    // 정상 경로라면 input.photos.map(...)이 실행된다. photos를 null로 손상시켜
    // (브라우저 확장이 런타임 타입과 다른 값을 넘기는 상황을 모사) 그 .map() 호출이
    // 예외를 던지는지, 그리고 그 예외가 objective-rules 전용 try/catch로 안전하게 흡수되는지 확인한다.
    const input = baseInput({ hospital_requested_takedown: true, photos: null as any });

    const result = await judgeReview(input, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.matched_rules).toEqual(['objective-rules-error']);
    expect(result.confidence).toBe(0);
    expect(result.ai_invoked).toBe(false);
    expect(result.photo_results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
