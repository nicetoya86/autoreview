import type { JudgmentResult, ReviewInput } from './types';
import { runObjectiveRules } from './rules/objectiveRules';
import { buildResultFromAi } from './rules/mapping';
import { judgeContentWithAi, SAFETY_BLOCK_ERROR_MESSAGE, type AiAdapterConfig } from './ai/aiAdapter';
import { containsProfanity } from './rules/containsProfanity';

/**
 * 이 패키지의 대표 함수. 절대 예외를 던지지 않고 항상 JudgmentResult를 반환한다
 * (스펙 §5.2 "안전한 쪽(검토필요)으로 떨어뜨린다").
 */
export async function judgeReview(input: ReviewInput, aiConfig: AiAdapterConfig): Promise<JudgmentResult> {
  let objective: ReturnType<typeof runObjectiveRules>;

  try {
    objective = runObjectiveRules(input);

    if (objective.decided) {
      const decision = objective.mock_judgment === 'APPROVE_CANDIDATE' ? 'APPROVED' : 'HIDDEN';
      return {
        review_id: input.review_id,
        mock_judgment: objective.mock_judgment,
        matched_rules: objective.matched_rules,
        confidence: 1,
        reasoning: objective.reasoning,
        ai_invoked: false,
        photo_results: input.photos.map((p) => ({ url: p.url, decision })),
      };
    }
  } catch {
    // runObjectiveRules 자체 또는 decided:true 분기의 photo-mapping이 실패한 경우.
    // AI는 아직 호출되지 않았으므로 ai_invoked: false와 그에 걸맞은 원인 라벨을 남긴다.
    return {
      review_id: input?.review_id,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: ['objective-rules-error'],
      confidence: 0,
      reasoning: '객관적 규칙 판단/입력값 검증 실패 — 검수자 직접 확인 필요',
      ai_invoked: false,
      photo_results: Array.isArray(input?.photos)
        ? input.photos.map((p) => ({ url: p?.url, decision: 'HIDDEN', reason: 'objective-rules-error' }))
        : [],
    };
  }

  try {
    // korcen(자체 규칙)은 근사매칭 오탐이 있어(예: "새로운 지점이") 여기서 바로 보류를
    // 확정하지 않고, 후보 신호만 AI에게 넘겨 실제 욕설/비속어인지 재확인시킨다 —
    // 최종 판정은 AI의 content_flag('profanity')로만 확정된다.
    const profanityCandidate = containsProfanity(input.content_text);
    const ai = await judgeContentWithAi({ ...input, profanityCandidate }, aiConfig);
    return buildResultFromAi(input, ai);
  } catch (err) {
    console.error(`[judgment-engine] AI 판단 실패 (review_id=${input?.review_id}):`, err);
    // Gemini가 노출/민감 사진 등을 세이프티 정책으로 차단한 경우는 일반 기술적 실패와
    // 원인이 다르므로(재시도해도 항상 같은 결과) 검수자에게 구분되는 사유를 남긴다.
    const blockedBySafety = err instanceof Error && err.message === SAFETY_BLOCK_ERROR_MESSAGE;
    return {
      review_id: input?.review_id,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: [blockedBySafety ? 'ai-safety-block' : 'ai-error'],
      confidence: 0,
      reasoning: blockedBySafety
        ? 'AI가 노출/민감 사진 등을 이유로 판단을 거부함 — 검수자 직접 확인 필요'
        : 'AI 판단 실패 — 검수자 직접 확인 필요',
      ai_invoked: true,
      photo_results: Array.isArray(input?.photos)
        ? input.photos.map((p) => ({ url: p?.url, decision: 'HIDDEN', reason: blockedBySafety ? 'ai_safety_block' : 'ai_error' }))
        : [],
    };
  }
}
