import type { MockJudgment } from 'judgment-engine';
import type { CacheStore } from './cache';
import type { ActualResult, ReviewStatusLabel } from '../shared/types';

const STATUS_TO_ACTUAL: Partial<Record<ReviewStatusLabel, ActualResult>> = {
  승인: 'APPROVED',
  보류: 'PAUSED',
  숨김: 'HIDDEN',
};

/**
 * NEEDS_REVIEW는 검수자 재량 판단이 필요했던 케이스라 "정답"이 정해져 있지 않으므로
 * 항상 null(판단보류)을 반환하고, 팝업 집계(§4)에서 match/mismatch 계산에서 제외한다.
 */
export function computeIsMatch(mock: MockJudgment, actual: ActualResult): boolean | null {
  if (mock === 'NEEDS_REVIEW') return null;
  if (mock === 'APPROVE_CANDIDATE') return actual === 'APPROVED';
  return actual === 'PAUSED' || actual === 'HIDDEN';
}

export async function captureActualResults(
  rows: Array<{ review_id: string; review_status: ReviewStatusLabel }>,
  cacheStore: CacheStore
): Promise<void> {
  for (const row of rows) {
    const actual = STATUS_TO_ACTUAL[row.review_status];
    if (!actual) continue; // 여전히 '대기'거나 알 수 없는 라벨

    const cached = await cacheStore.get(row.review_id);
    if (!cached || cached.actual_result) continue; // 판정 없음, 또는 이미 캡처됨(중복 방지)

    const isMatch = computeIsMatch(cached.result.mock_judgment, actual);
    await cacheStore.set({
      ...cached,
      actual_result: actual,
      is_match: isMatch ?? undefined,
    });
  }
}
