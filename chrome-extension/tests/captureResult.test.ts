import { describe, it, expect } from 'vitest';
import { computeIsMatch, captureActualResults } from '../src/background/captureResult';
import { createCacheStore } from '../src/background/cache';
import type { CacheEntry } from '../src/shared/types';

describe('computeIsMatch', () => {
  it('APPROVE_CANDIDATE + 실제 승인 = true', () => {
    expect(computeIsMatch('APPROVE_CANDIDATE', 'APPROVED')).toBe(true);
  });

  it('APPROVE_CANDIDATE + 실제 보류 = false', () => {
    expect(computeIsMatch('APPROVE_CANDIDATE', 'PAUSED')).toBe(false);
  });

  it('AUTO_HOLD_CANDIDATE + 실제 보류/숨김 = true', () => {
    expect(computeIsMatch('AUTO_HOLD_CANDIDATE', 'PAUSED')).toBe(true);
    expect(computeIsMatch('AUTO_HOLD_CANDIDATE', 'HIDDEN')).toBe(true);
  });

  it('AUTO_HOLD_CANDIDATE + 실제 승인 = false', () => {
    expect(computeIsMatch('AUTO_HOLD_CANDIDATE', 'APPROVED')).toBe(false);
  });

  it('NEEDS_REVIEW는 항상 null(판단보류, 집계 제외)', () => {
    expect(computeIsMatch('NEEDS_REVIEW', 'APPROVED')).toBeNull();
    expect(computeIsMatch('NEEDS_REVIEW', 'PAUSED')).toBeNull();
  });
});

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    get: async (keys: string[]) => {
      const r: Record<string, unknown> = {};
      keys.forEach((k) => k in data && (r[k] = data[k]));
      return r;
    },
    set: async (items: Record<string, unknown>) => Object.assign(data, items),
  };
}

function entry(reviewId: string, mock: CacheEntry['result']['mock_judgment']): CacheEntry {
  return {
    review_id: reviewId,
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
    result: { review_id: reviewId, mock_judgment: mock, matched_rules: [], confidence: 1, reasoning: 'ok', ai_invoked: false, photo_results: [], photo_notices: [] },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

describe('captureActualResults', () => {
  it('상태가 대기가 아니게 바뀐 캐시 항목에 actual_result/is_match를 기록한다', async () => {
    const store = createCacheStore(fakeStorage());
    await store.set(entry('r1', 'APPROVE_CANDIDATE'));

    await captureActualResults([{ review_id: 'r1', review_status: '승인' }], store);

    const updated = await store.get('r1');
    expect(updated?.actual_result).toBe('APPROVED');
    expect(updated?.is_match).toBe(true);
  });

  it('아직 대기 상태인 행은 건드리지 않는다', async () => {
    const store = createCacheStore(fakeStorage());
    await store.set(entry('r1', 'APPROVE_CANDIDATE'));

    await captureActualResults([{ review_id: 'r1', review_status: '대기' }], store);

    const updated = await store.get('r1');
    expect(updated?.actual_result).toBeUndefined();
  });

  it('캐시에 판정 결과가 없는 review_id는 건드리지 않는다', async () => {
    const store = createCacheStore(fakeStorage());
    await captureActualResults([{ review_id: 'unknown', review_status: '승인' }], store);
    expect(await store.get('unknown')).toBeUndefined();
  });

  it('이미 actual_result가 기록된 항목은 다시 기록하지 않는다(중복 방지)', async () => {
    const store = createCacheStore(fakeStorage());
    const withResult = { ...entry('r1', 'APPROVE_CANDIDATE'), actual_result: 'APPROVED' as const, is_match: true };
    await store.set(withResult);

    await captureActualResults([{ review_id: 'r1', review_status: '보류' }], store);

    const updated = await store.get('r1');
    expect(updated?.actual_result).toBe('APPROVED'); // 그대로 유지, '보류'로 덮어쓰지 않음
  });
});
