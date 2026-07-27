import { describe, it, expect } from 'vitest';
import { createCacheStore } from '../src/background/cache';
import type { CacheEntry } from '../src/shared/types';

function fakeEntry(reviewId: string): CacheEntry {
  return {
    review_id: reviewId,
    tier: 'list',
    fingerprint: 'fp1',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: reviewId,
      mock_judgment: 'APPROVE_CANDIDATE',
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [],
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys: string[]) => {
      const result: Record<string, unknown> = {};
      keys.forEach((k) => {
        if (k in data) result[k] = data[k];
      });
      return result;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
  };
}

describe('createCacheStore', () => {
  it('저장한 항목을 review_id로 조회할 수 있다', async () => {
    const storage = fakeStorage();
    const store = createCacheStore(storage);

    await store.set(fakeEntry('r1'));
    const found = await store.get('r1');

    expect(found?.review_id).toBe('r1');
  });

  it('없는 review_id는 undefined를 반환한다', async () => {
    const store = createCacheStore(fakeStorage());
    expect(await store.get('missing')).toBeUndefined();
  });

  it('getAll은 저장된 모든 항목을 반환한다', async () => {
    const storage = fakeStorage();
    const store = createCacheStore(storage);

    await store.set(fakeEntry('r1'));
    await store.set(fakeEntry('r2'));

    const all = await store.getAll();
    expect(all.map((e) => e.review_id).sort()).toEqual(['r1', 'r2']);
  });

  it('같은 review_id로 다시 set하면 덮어쓴다', async () => {
    const storage = fakeStorage();
    const store = createCacheStore(storage);

    await store.set(fakeEntry('r1'));
    const updated = { ...fakeEntry('r1'), tier: 'detail' as const };
    await store.set(updated);

    const found = await store.get('r1');
    expect(found?.tier).toBe('detail');
  });
});
