import type { JudgmentResult } from 'judgment-engine';

// prompt.ts가 "시술 전/후 → 일반 사진 재분류" 승인 시 항상 이 문구를 reasoning에 쓰도록 지시한다.
const TYPE_RECLASSIFIED_MARKER = '유형 변경 후 승인 가능';

/**
 * 모의 검수 단계에서 판단 근거를 보고 규칙 정확도를 가늠할 수 있어야 하므로,
 * 자동보류후보/검토필요는 항상, 승인이어도 사진이 시술 전/후에서 일반으로
 * 재분류된 경우엔 상세 사유(reasoning)를 함께 보여준다.
 */
export function shouldShowReasoning(result: JudgmentResult): boolean {
  return result.mock_judgment !== 'APPROVE_CANDIDATE' || result.reasoning.includes(TYPE_RECLASSIFIED_MARKER);
}
