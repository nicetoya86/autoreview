import type { JudgmentResult, ReviewInput } from './types';
import { runObjectiveRules } from './rules/objectiveRules';
import { buildResultFromAi } from './rules/mapping';
import { judgeContentWithAi, type AiAdapterConfig } from './ai/aiAdapter';

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
    const ai = await judgeContentWithAi(input, aiConfig);
    return buildResultFromAi(input, ai);
  } catch {
    return {
      review_id: input?.review_id,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: ['ai-error'],
      confidence: 0,
      reasoning: 'AI 판단 실패 — 검수자 직접 확인 필요',
      ai_invoked: true,
      photo_results: Array.isArray(input?.photos)
        ? input.photos.map((p) => ({ url: p?.url, decision: 'HIDDEN', reason: 'ai_error' }))
        : [],
    };
  }
}
