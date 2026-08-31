import type { AiContentJudgment, JudgmentResult, PhotoResult, ReviewInput } from '../types';

/**
 * PRD 8.6 매핑: AI가 준 텍스트/사진별 세부 판단을 최종 3단계 판정과
 * 사진별 승인/숨김 결과로 합성한다. AI는 세부 항목만 판단하고,
 * 최종 분류 규칙은 여기(코드)에서 결정한다 (스펙 §5.1).
 */
// proxy/src/prompt.ts가 '시술 전/후 → 일반 사진 재분류' 승인 시 이 문구를 reasoning에
// 쓰도록 지시한다 — 여기서 감지해 승인 결과에 고정 문구로 노출한다.
const TYPE_RECLASSIFIED_MARKER = '유형 변경 후 승인 가능';

export function buildResultFromAi(input: ReviewInput, ai: AiContentJudgment): JudgmentResult {
  const photo_results: PhotoResult[] = [];
  const photoConfidences: number[] = [];
  let approvedBeforeCount = 0;
  let approvedAfterCount = 0;

  input.photos.forEach((photo, index) => {
    // AI가 입력 URL 문자열을 그대로 반환한다고 보장할 수 없으므로(Gemini 스모크 테스트에서
    // "image_1.jpg" 같은 자체 라벨을 반환하는 사례 관찰), url 동등 비교 대신 프롬프트가
    // 보장하는 배열 순서(index)로 매칭한다.
    const judged = ai.photos[index];
    // 병원명이 다른 사진(hospital_name_match: false)은 relevant/flag와 무관하게 무조건 보류 —
    // 프롬프트 지시문만으로는 모델이 무시하는 경우가 실측에서 확인됐다.
    const hospitalMismatch = !!input.hospital_name && judged?.hospital_name_match === false;
    const sensitiveFlag = judged?.flag === 'public_order' || judged?.flag === 'personal_info';
    // 신체 일부가 나온 사진은 "시술과 무관해 보인다"는 AI의 종합 판단(relevant/flag)과 무관하게
    // 승인한다 — 프롬프트 지시만으로는 같은 유형의 사진(예: 손이 나온 일상 사진)에서도 판단이
    // 오락가락하는 사례가 실측에서 확인되어, 결정성을 위해 이 규칙만 코드에서 강제한다.
    const bodyPartOverride = judged?.body_part_visible === true && !sensitiveFlag && !hospitalMismatch;
    if (!judged || hospitalMismatch || (!bodyPartOverride && (!judged.relevant || !judged.identifiable || judged.flag))) {
      photo_results.push({
        url: photo.url,
        decision: 'HIDDEN',
        reason: hospitalMismatch ? 'irrelevant' : (judged?.flag ?? 'irrelevant'),
      });
    } else {
      photo_results.push({ url: photo.url, decision: 'APPROVED' });
      if (photo.declared_category === 'BEFORE_AFTER') {
        if (photo.before_after_slot === 'BEFORE') approvedBeforeCount++;
        if (photo.before_after_slot === 'AFTER') approvedAfterCount++;
      }
    }
    // Collect confidence from any matched photo (judged is truthy), regardless of APPROVED/HIDDEN decision
    if (judged) {
      photoConfidences.push(judged.confidence);
    }
  });

  const hasPublicOrderPhoto = photo_results.some((p) => p.decision === 'HIDDEN' && p.reason === 'public_order');
  const contentNeedsReview = ai.content_flag === 'public_order';
  const contentProfanity = ai.content_flag === 'profanity';
  const contentHold = ai.content_flag === 'meaningless' || ai.content_relevant === false;
  const approvedPhotoCount = photo_results.filter((p) => p.decision === 'APPROVED').length;
  // 사진을 아예 제출하지 않은 후기는 보류 대상이 아니다 — 제출한 사진이 전부 거부된 경우만 보류.
  const noApprovedPhotoRemaining = input.photos.length > 0 && approvedPhotoCount === 0;

  // 전/후 양쪽 슬롯이 모두 등록된 진짜 전후 비교 후기(예외 시술 제외)는 두 슬롯 중
  // 어느 한쪽이라도 승인 사진이 남지 않으면(그 슬롯의 유일한 사진이 거부된 경우 등)
  // 남은 사진만으로 승인 처리하지 않고 전체를 보류한다 — 한쪽만 숨기고 승인하면
  // 전후 비교 자체가 성립하지 않기 때문.
  const beforeAfterPhotos = input.photos.filter((p) => p.declared_category === 'BEFORE_AFTER');
  const isBeforeAfterPair =
    !input.procedure?.is_before_after_exempt &&
    beforeAfterPhotos.some((p) => p.before_after_slot === 'BEFORE') &&
    beforeAfterPhotos.some((p) => p.before_after_slot === 'AFTER');
  const beforeAfterPairBroken = isBeforeAfterPair && (approvedBeforeCount === 0 || approvedAfterCount === 0);

  const matched_rules: string[] = [];
  if (contentHold) matched_rules.push('ai-content-irrelevant-or-meaningless');
  if (contentProfanity) matched_rules.push('ai-content-profanity');
  if (contentNeedsReview) matched_rules.push('ai-content-public-order');
  if (hasPublicOrderPhoto) matched_rules.push('ai-photo-public-order');
  if (noApprovedPhotoRemaining) matched_rules.push('no-approved-photo-remaining');
  if (beforeAfterPairBroken) matched_rules.push('before-after-pair-incomplete');

  let mock_judgment: JudgmentResult['mock_judgment'];
  if (contentNeedsReview || hasPublicOrderPhoto) {
    mock_judgment = 'NEEDS_REVIEW';
  } else if (contentHold || contentProfanity || noApprovedPhotoRemaining || beforeAfterPairBroken) {
    mock_judgment = 'AUTO_HOLD_CANDIDATE';
  } else {
    mock_judgment = 'APPROVE_CANDIDATE';
  }

  const confidence = Math.min(ai.confidence, ...(photoConfidences.length ? photoConfidences : [1]));

  // 승인 결과에만 붙이는 부가 안내 — 보류/검토필요는 reasoning으로 이미 사유가 드러난다.
  const photo_notices: string[] = [];
  if (mock_judgment === 'APPROVE_CANDIDATE') {
    const hiddenPositions = photo_results
      .map((p, i) => (p.decision === 'HIDDEN' ? i + 1 : null))
      .filter((n): n is number => n !== null);
    if (hiddenPositions.length > 0) {
      photo_notices.push(`${hiddenPositions.map((n) => `${n}번째`).join(', ')} 사진 숨김 후 승인`);
    }
    if (ai.reasoning.includes(TYPE_RECLASSIFIED_MARKER)) {
      photo_notices.push('사진 유형 변경 후 승인');
    }
  }

  return {
    review_id: input.review_id,
    mock_judgment,
    matched_rules,
    confidence,
    reasoning: ai.reasoning,
    ai_invoked: true,
    photo_results,
    photo_notices,
  };
}
