import { describe, it, expect } from 'vitest';
import { summarize } from '../src/popup/summarize';
import type { CacheEntry } from '../src/shared/types';

function entry(overrides: Partial<CacheEntry> & Partial<CacheEntry['result']> = {}): CacheEntry {
  return {
    review_id: overrides.review_id ?? 'r1',
    tier: 'list',
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_hospital_name: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: overrides.review_id ?? 'r1',
      mock_judgment: overrides.mock_judgment ?? 'APPROVE_CANDIDATE',
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [],
      photo_notices: [],
    },
    checked_at: '2026-07-20T00:00:00Z',
    actual_result: overrides.actual_result,
    is_match: overrides.is_match,
  };
}

describe('summarize', () => {
  it('판정 유형별 건수를 집계한다', () => {
    const summary = summarize([
      entry({ review_id: 'r1', mock_judgment: 'APPROVE_CANDIDATE' }),
      entry({ review_id: 'r2', mock_judgment: 'AUTO_HOLD_CANDIDATE' }),
      entry({ review_id: 'r3', mock_judgment: 'NEEDS_REVIEW' }),
    ]);
    expect(summary.distribution).toEqual({ APPROVE_CANDIDATE: 1, AUTO_HOLD_CANDIDATE: 1, NEEDS_REVIEW: 1 });
    expect(summary.total_judged).toBe(3);
  });

  it('is_match true/false로 일치/불일치를 센다', () => {
    const summary = summarize([
      entry({ review_id: 'r1', is_match: true, actual_result: 'APPROVED' }),
      entry({ review_id: 'r2', is_match: false, actual_result: 'PAUSED' }),
    ]);
    expect(summary.matched).toBe(1);
    expect(summary.mismatched).toBe(1);
    expect(summary.match_rate).toBe(0.5);
  });

  it('is_match가 없는(아직 캡처 안 된) 항목은 일치율 계산에서 제외한다', () => {
    const summary = summarize([entry({ review_id: 'r1' })]);
    expect(summary.matched).toBe(0);
    expect(summary.mismatched).toBe(0);
    expect(summary.match_rate).toBeNull();
  });

  it('불일치 사례를 review_id/mock_judgment/actual_result와 함께 담는다', () => {
    const summary = summarize([entry({ review_id: 'r1', is_match: false, actual_result: 'PAUSED', mock_judgment: 'APPROVE_CANDIDATE' })]);
    expect(summary.recent_mismatches).toEqual([{ review_id: 'r1', mock_judgment: 'APPROVE_CANDIDATE', actual_result: 'PAUSED' }]);
  });

  it('최근 불일치 사례는 최대 10건까지만 담는다', () => {
    const entries = Array.from({ length: 15 }, (_, i) => entry({ review_id: `r${i}`, is_match: false, actual_result: 'PAUSED' }));
    const summary = summarize(entries);
    expect(summary.recent_mismatches.length).toBe(10);
  });
});
