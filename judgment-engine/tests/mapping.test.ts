import { describe, it, expect } from 'vitest';
import { buildResultFromAi } from '../src/rules/mapping';
import type { AiContentJudgment, ReviewInput } from '../src/types';

function inputWithPhotos(urls: string[]): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '시술 후 만족스러웠어요',
    photos: urls.map((url) => ({ url, declared_category: 'GENERAL' as const })),
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
  };
}

describe('buildResultFromAi', () => {
  it('모든 사진과 텍스트가 문제없으면 APPROVE_CANDIDATE', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'APPROVED' }]);
    expect(result.ai_invoked).toBe(true);
  });

  it('사진 2장 중 1장만 무관하면 그 사진만 HIDDEN이고 전체는 승인', () => {
    const input = inputWithPhotos(['https://x/1.jpg', 'https://x/2.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/2.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.8 },
      ],
      confidence: 0.9,
      reasoning: 'photo2는 시술과 무관',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.photo_results).toEqual([
      { url: 'https://x/1.jpg', decision: 'APPROVED' },
      { url: 'https://x/2.jpg', decision: 'HIDDEN', reason: 'irrelevant' },
    ]);
  });

  it('남는 승인 사진이 없으면 AUTO_HOLD_CANDIDATE', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.8 }],
      confidence: 0.8,
      reasoning: '사진이 시술과 무관',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
  });

  it('사진에 미풍양속 플래그가 있으면 NEEDS_REVIEW (사람 판단 필요)', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: 'public_order', confidence: 0.7 }],
      confidence: 0.7,
      reasoning: '미풍양속 위배 소지 있음',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.photo_results[0]).toEqual({ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'public_order' });
  });

  it('텍스트가 미풍양속 위배면 NEEDS_REVIEW', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: 'public_order',
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: '텍스트에 미풍양속 위배 소지',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
  });

  it('input에 있는 사진이 AI 응답에 없으면 HIDDEN/irrelevant로 처리하고 confidence에 영향 없음', () => {
    const input = inputWithPhotos(['https://x/1.jpg', 'https://x/2.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'photo2는 AI가 판단하지 않음',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.photo_results).toEqual([
      { url: 'https://x/1.jpg', decision: 'APPROVED' },
      { url: 'https://x/2.jpg', decision: 'HIDDEN', reason: 'irrelevant' },
    ]);
    expect(result.confidence).toBe(0.9);
  });

  it('AI 응답에 input에 없는 phantom 사진이 있어도 confidence에 영향 없음', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/phantom.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.1 },
      ],
      confidence: 0.9,
      reasoning: 'phantom 항목 포함',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'APPROVED' }]);
    expect(result.confidence).toBe(0.9); // NOT dragged down to 0.1 by the phantom entry
  });

  it('매칭됐지만 HIDDEN 처리된 사진의 confidence도 전체 결과에 반영됨', () => {
    const input = inputWithPhotos(['https://x/1.jpg', 'https://x/2.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/2.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.3 },
      ],
      confidence: 0.9,
      reasoning: 'photo2는 시술과 무관하지만 낮은 확신도로 판단됨',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.photo_results).toEqual([
      { url: 'https://x/1.jpg', decision: 'APPROVED' },
      { url: 'https://x/2.jpg', decision: 'HIDDEN', reason: 'irrelevant' },
    ]);
    expect(result.confidence).toBe(0.3); // hidden photo's low confidence still pulls down the overall result
  });

  it('사진은 승인 가능해도 텍스트가 의미불명(meaningless)이면 AUTO_HOLD_CANDIDATE', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: 'meaningless',
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: '후기 내용이 의미를 알 수 없음',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'APPROVED' }]);
  });
});
