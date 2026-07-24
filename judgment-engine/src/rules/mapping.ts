import type { AiContentJudgment, JudgmentResult, PhotoResult, ReviewInput } from '../types';

/**
 * PRD 8.6 매핑: AI가 준 텍스트/사진별 세부 판단을 최종 3단계 판정과
 * 사진별 승인/숨김 결과로 합성한다. AI는 세부 항목만 판단하고,
 * 최종 분류 규칙은 여기(코드)에서 결정한다 (스펙 §5.1).
 */
export function buildResultFromAi(input: ReviewInput, ai: AiContentJudgment): JudgmentResult {
  const photo_results: PhotoResult[] = [];
  const photoConfidences: number[] = [];

  input.photos.forEach((photo, index) => {
    // AI가 입력 URL 문자열을 그대로 반환한다고 보장할 수 없으므로(Gemini 스모크 테스트에서
    // "image_1.jpg" 같은 자체 라벨을 반환하는 사례 관찰), url 동등 비교 대신 프롬프트가
    // 보장하는 배열 순서(index)로 매칭한다.
    const judged = ai.photos[index];
    if (!judged || !judged.relevant || !judged.identifiable || judged.flag) {
      photo_results.push({
        url: photo.url,
        decision: 'HIDDEN',
        reason: judged?.flag ?? 'irrelevant',
      });
    } else {
      photo_results.push({ url: photo.url, decision: 'APPROVED' });
    }
    // Collect confidence from any matched photo (judged is truthy), regardless of APPROVED/HIDDEN decision
    if (judged) {
      photoConfidences.push(judged.confidence);
    }
  });

  const hasPublicOrderPhoto = photo_results.some((p) => p.decision === 'HIDDEN' && p.reason === 'public_order');
  const contentNeedsReview = ai.content_flag === 'public_order';
  const contentHold = ai.content_flag === 'meaningless' || ai.content_relevant === false;
  const approvedPhotoCount = photo_results.filter((p) => p.decision === 'APPROVED').length;

  const matched_rules: string[] = [];
  if (contentHold) matched_rules.push('ai-content-irrelevant-or-meaningless');
  if (contentNeedsReview) matched_rules.push('ai-content-public-order');
  if (hasPublicOrderPhoto) matched_rules.push('ai-photo-public-order');
  if (approvedPhotoCount === 0) matched_rules.push('no-approved-photo-remaining');

  let mock_judgment: JudgmentResult['mock_judgment'];
  if (contentNeedsReview || hasPublicOrderPhoto) {
    mock_judgment = 'NEEDS_REVIEW';
  } else if (contentHold || approvedPhotoCount === 0) {
    mock_judgment = 'AUTO_HOLD_CANDIDATE';
  } else {
    mock_judgment = 'APPROVE_CANDIDATE';
  }

  const confidence = Math.min(ai.confidence, ...(photoConfidences.length ? photoConfidences : [1]));

  return {
    review_id: input.review_id,
    mock_judgment,
    matched_rules,
    confidence,
    reasoning: ai.reasoning,
    ai_invoked: true,
    photo_results,
  };
}
