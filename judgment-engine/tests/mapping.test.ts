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
      same_hospital_name: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
  };
}

function inputWithBeforeAfterPhotos(
  photos: Array<{ url: string; slot: 'BEFORE' | 'AFTER' }>,
  isExempt = false
): ReviewInput {
  return {
    ...inputWithPhotos([]),
    photos: photos.map((p) => ({ url: p.url, declared_category: 'BEFORE_AFTER' as const, before_after_slot: p.slot })),
    procedure: { is_before_after_exempt: isExempt },
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

  it('hospital_name_match가 false면 relevant/flag가 승인이어도 HIDDEN 처리', () => {
    const input = { ...inputWithPhotos(['https://x/1.jpg']), hospital_name: '다올림성형외과의원' };
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9, hospital_name_match: false },
      ],
      confidence: 0.9,
      reasoning: '병원 간판이 다름',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'irrelevant' }]);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
  });

  it('hospital_name이 등록되지 않은 후기는 hospital_name_match가 false여도 무시한다', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9, hospital_name_match: false },
      ],
      confidence: 0.9,
      reasoning: 'ok',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'APPROVED' }]);
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

  it('사진에 개인정보(personal_info) 플래그가 있으면 그 사진만 HIDDEN', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: 'personal_info', confidence: 0.8 }],
      confidence: 0.8,
      reasoning: '전화번호가 노출됨',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'personal_info' }]);
  });

  it('사진을 제출하지 않은 후기는 그것만으로 보류하지 않는다 (텍스트만 승인 기준 충족하면 APPROVE_CANDIDATE)', () => {
    const input = inputWithPhotos([]);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [],
      confidence: 0.9,
      reasoning: '사진 없이 텍스트만 승인 기준 충족',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.matched_rules).not.toContain('no-approved-photo-remaining');
    expect(result.photo_results).toEqual([]);
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

  it('AI가 입력 URL과 다른 문자열을 photos[].url로 반환해도 순서 기준으로 매칭한다 (실제 Gemini 관찰 사례)', () => {
    const input = inputWithPhotos(['https://x/1.jpg', 'https://x/2.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'image_1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.95 },
        { url: 'image_2.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.9 },
      ],
      confidence: 0.95,
      reasoning: 'AI가 원본 URL을 그대로 반환하지 않고 자체 라벨을 붙임',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.photo_results).toEqual([
      { url: 'https://x/1.jpg', decision: 'APPROVED' },
      { url: 'https://x/2.jpg', decision: 'HIDDEN', reason: 'irrelevant' },
    ]);
  });

  it('전/후 각 1장씩만 등록된 후기는 한쪽이 거부되면 남은 한쪽만으로 승인하지 않고 AUTO_HOLD_CANDIDATE', () => {
    const input = inputWithBeforeAfterPhotos([
      { url: 'https://x/before.jpg', slot: 'BEFORE' },
      { url: 'https://x/after.jpg', slot: 'AFTER' },
    ]);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/before.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/after.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.8 },
      ],
      confidence: 0.9,
      reasoning: '후 사진이 시술과 무관',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
    expect(result.matched_rules).toContain('before-after-pair-incomplete');
    expect(result.photo_results).toEqual([
      { url: 'https://x/before.jpg', decision: 'APPROVED' },
      { url: 'https://x/after.jpg', decision: 'HIDDEN', reason: 'irrelevant' },
    ]);
  });

  it('전/후 각 1장씩 모두 승인되면 APPROVE_CANDIDATE', () => {
    const input = inputWithBeforeAfterPhotos([
      { url: 'https://x/before.jpg', slot: 'BEFORE' },
      { url: 'https://x/after.jpg', slot: 'AFTER' },
    ]);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/before.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/after.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
      ],
      confidence: 0.9,
      reasoning: '전후 비교 정상',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.matched_rules).not.toContain('before-after-pair-incomplete');
  });

  it('전/후 각 2장씩 등록된 후기는 한쪽에 1장이라도 승인 사진이 남으면 나머지만 숨기고 승인', () => {
    const input = inputWithBeforeAfterPhotos([
      { url: 'https://x/before1.jpg', slot: 'BEFORE' },
      { url: 'https://x/before2.jpg', slot: 'BEFORE' },
      { url: 'https://x/after1.jpg', slot: 'AFTER' },
      { url: 'https://x/after2.jpg', slot: 'AFTER' },
    ]);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/before1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/before2.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/after1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/after2.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.8 },
      ],
      confidence: 0.9,
      reasoning: 'after2만 시술과 무관',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.matched_rules).not.toContain('before-after-pair-incomplete');
    expect(result.photo_results.find((p) => p.url === 'https://x/after2.jpg')).toEqual({
      url: 'https://x/after2.jpg',
      decision: 'HIDDEN',
      reason: 'irrelevant',
    });
  });

  it('예외 시술(전후 촬영 불가)은 전/후 슬롯이 등록돼 있어도 한쪽만 승인되면 그대로 승인', () => {
    const input = inputWithBeforeAfterPhotos(
      [
        { url: 'https://x/before.jpg', slot: 'BEFORE' },
        { url: 'https://x/after.jpg', slot: 'AFTER' },
      ],
      true
    );
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/before.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/after.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.8 },
      ],
      confidence: 0.9,
      reasoning: '예외 시술이라 전후 비교 요건 미적용, after는 시술과 무관해 숨김',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.matched_rules).not.toContain('before-after-pair-incomplete');
  });

  it('텍스트가 욕설/비속어(profanity)로 확인되면 AUTO_HOLD_CANDIDATE', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: 'profanity',
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: '욕설/비속어 확인됨',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
    expect(result.matched_rules).toContain('ai-content-profanity');
  });

  it('body_part_visible이 true면 relevant/flag가 irrelevant여도 승인 (신체 일부 우선 규칙)', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        {
          url: 'https://x/1.jpg',
          relevant: false,
          identifiable: true,
          flag: 'irrelevant',
          confidence: 0.9,
          body_part_visible: true,
        },
      ],
      confidence: 0.9,
      reasoning: '커피잔을 든 손이 나온 일상 사진이지만 신체 일부가 식별됨',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'APPROVED' }]);
  });

  it('body_part_visible이 true여도 public_order 플래그면 보류 (신체 일부 우선 규칙보다 우선)', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        {
          url: 'https://x/1.jpg',
          relevant: true,
          identifiable: true,
          flag: 'public_order',
          confidence: 0.9,
          body_part_visible: true,
        },
      ],
      confidence: 0.9,
      reasoning: '선정적으로 연출된 노출 사진',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'public_order' }]);
  });

  it('low_resolution이 true면 relevant/identifiable이 true여도 보류', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        {
          url: 'https://x/1.jpg',
          relevant: true,
          identifiable: true,
          flag: null,
          confidence: 0.9,
          body_part_visible: true,
          low_resolution: true,
        },
      ],
      confidence: 0.9,
      reasoning: '신체 일부로 보이지만 해상도가 너무 낮음',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'low_resolution' }]);
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
