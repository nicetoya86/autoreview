import type { MockJudgment, ReviewInput } from '../types';
import { isDuplicate } from './duplicate';
import { checkReceiptObjective } from './receipt';
import { isMeaninglessText } from './meaninglessText';
import { containsPii } from './containsPii';

export type ObjectiveResult =
  | { decided: true; mock_judgment: MockJudgment; matched_rules: string[]; reasoning: string }
  | { decided: false };

export function runObjectiveRules(input: ReviewInput): ObjectiveResult {
  if (input.hospital_requested_takedown) {
    return {
      decided: true,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: ['hospital-takedown-request'],
      reasoning: '병원이 게시중단을 요청한 후기 — 별도 프로세스로 처리 필요',
    };
  }

  if (isDuplicate(input)) {
    return {
      decided: true,
      mock_judgment: 'AUTO_HOLD_CANDIDATE',
      matched_rules: ['8.4-duplicate'],
      reasoning: '동일 고객의 중복 후기로 판단됨 (PRD 8.4 기준 충족)',
    };
  }

  const receiptCheck = checkReceiptObjective(input);
  if (receiptCheck.holdReason) {
    return {
      decided: true,
      mock_judgment: 'AUTO_HOLD_CANDIDATE',
      matched_rules: [receiptCheck.holdReason],
      reasoning: `영수증 조건 미충족: ${receiptCheck.holdReason}`,
    };
  }

  if (isMeaninglessText(input.content_text)) {
    return {
      decided: true,
      mock_judgment: 'AUTO_HOLD_CANDIDATE',
      matched_rules: ['meaningless-text'],
      reasoning: '후기 내용이 의미를 알 수 없는 텍스트로 판단됨',
    };
  }

  if (containsPii(input.content_text)) {
    return {
      decided: true,
      mock_judgment: 'AUTO_HOLD_CANDIDATE',
      matched_rules: ['contains-pii'],
      reasoning: '후기 내용에 전화번호/이메일 등 개인정보가 포함된 것으로 판단됨',
    };
  }

  if (receiptCheck.unconfirmed) {
    return {
      decided: true,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: ['receipt-fields-unconfirmed'],
      reasoning: '영수증 금액/일자/병원명 자동 대사가 불가능해 사람 확인이 필요함',
    };
  }

  return { decided: false };
}
