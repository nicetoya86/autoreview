import type { MockJudgment } from 'judgment-engine';
import type { ActualResult, CacheEntry } from '../shared/types';

export interface AccuracySummary {
  total_judged: number;
  distribution: Record<MockJudgment, number>;
  matched: number;
  mismatched: number;
  match_rate: number | null;
  recent_mismatches: Array<{ review_id: string; mock_judgment: MockJudgment; actual_result: ActualResult }>;
}

export function summarize(entries: CacheEntry[]): AccuracySummary {
  const distribution: Record<MockJudgment, number> = {
    AUTO_HOLD_CANDIDATE: 0,
    APPROVE_CANDIDATE: 0,
    NEEDS_REVIEW: 0,
  };
  let matched = 0;
  let mismatched = 0;
  const recentMismatches: AccuracySummary['recent_mismatches'] = [];

  for (const entry of entries) {
    distribution[entry.result.mock_judgment]++;

    if (entry.is_match === true) {
      matched++;
    } else if (entry.is_match === false) {
      mismatched++;
      recentMismatches.push({
        review_id: entry.review_id,
        mock_judgment: entry.result.mock_judgment,
        actual_result: entry.actual_result!,
      });
    }
  }

  const capturable = matched + mismatched;

  return {
    total_judged: entries.length,
    distribution,
    matched,
    mismatched,
    match_rate: capturable > 0 ? matched / capturable : null,
    recent_mismatches: recentMismatches.slice(-10),
  };
}
