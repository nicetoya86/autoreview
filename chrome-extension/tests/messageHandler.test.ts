import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleMessage } from '../src/background/messageHandler';
import { createCacheStore } from '../src/background/cache';
import type { ListRowData, DetailPageData } from '../src/shared/types';

vi.mock('judgment-engine', () => ({
  judgeReview: vi.fn(async (input) => ({
    review_id: input.review_id,
    mock_judgment: 'APPROVE_CANDIDATE',
    matched_rules: [],
    confidence: 1,
    reasoning: 'mock',
    ai_invoked: false,
    photo_results: [],
  })),
}));

afterEach(() => vi.clearAllMocks());

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

const aiConfig = { proxyUrl: 'https://proxy.example/api/judge-content' };

describe('handleMessage', () => {
  it('JUDGE_LIST: 캐시 미스인 행만 판정하고 tier=list로 저장한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const rows: ListRowData[] = [
      {
        review_id: 'r1',
        review_type: 'TICKET_USE',
        content_text: 'ok',
        photos: [],
        review_status: '대기',
        modified_at: '2026-07-20',
        author: '홍**',
      },
    ];

    const response = await handleMessage({ type: 'JUDGE_LIST', rows }, { cacheStore, aiConfig });

    expect(response).toMatchObject({ type: 'JUDGE_LIST_RESULT' });
    if (response.type === 'JUDGE_LIST_RESULT') {
      expect(response.entries[0].tier).toBe('list');
      expect(response.entries[0].result.mock_judgment).toBe('APPROVE_CANDIDATE');
    }
  });

  it('JUDGE_LIST: 지문이 같은 캐시가 이미 있으면 재판정하지 않는다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const rows: ListRowData[] = [
      {
        review_id: 'r1',
        review_type: 'TICKET_USE',
        content_text: 'ok',
        photos: [],
        review_status: '대기',
        modified_at: '2026-07-20',
        author: '홍**',
      },
    ];

    await handleMessage({ type: 'JUDGE_LIST', rows }, { cacheStore, aiConfig });
    const { judgeReview } = await import('judgment-engine');
    vi.mocked(judgeReview).mockClear();

    await handleMessage({ type: 'JUDGE_LIST', rows }, { cacheStore, aiConfig });

    expect(judgeReview).not.toHaveBeenCalled();
  });

  it('JUDGE_DETAIL: tier=detail로 저장한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const detail: DetailPageData = {
      review_id: 'r1',
      review_type: 'TICKET_USE',
      content_text: 'ok',
      photos: [],
      procedure: { is_before_after_exempt: false },
      hospital_requested_takedown: false,
      modified_at: '2026-07-20',
    };

    const response = await handleMessage({ type: 'JUDGE_DETAIL', detail }, { cacheStore, aiConfig });

    expect(response).toMatchObject({ type: 'JUDGE_DETAIL_RESULT' });
    if (response.type === 'JUDGE_DETAIL_RESULT') {
      expect(response.entry.tier).toBe('detail');
    }
  });

  it('GET_CACHE: 캐시에 없으면 entry: null을 반환한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const response = await handleMessage({ type: 'GET_CACHE', reviewId: 'missing' }, { cacheStore, aiConfig });
    expect(response).toEqual({ type: 'CACHE_ENTRY', entry: null });
  });

  it('CAPTURE_STATUS: 캡처 완료 후 CAPTURE_DONE을 반환한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const response = await handleMessage(
      { type: 'CAPTURE_STATUS', rows: [{ review_id: 'r1', review_status: '승인' }] },
      { cacheStore, aiConfig }
    );
    expect(response).toEqual({ type: 'CAPTURE_DONE' });
  });

  it('SAVE_FEEDBACK: 캐시 항목에 reviewer_feedback을 기록한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    await handleMessage({ type: 'JUDGE_DETAIL', detail: {
      review_id: 'r1',
      review_type: 'TICKET_USE',
      content_text: 'ok',
      photos: [],
      procedure: { is_before_after_exempt: false },
      hospital_requested_takedown: false,
      modified_at: '2026-07-20',
    } }, { cacheStore, aiConfig });

    const response = await handleMessage({ type: 'SAVE_FEEDBACK', reviewId: 'r1', feedback: 'AGREE' }, { cacheStore, aiConfig });

    expect(response).toMatchObject({ type: 'FEEDBACK_SAVED', entry: { reviewer_feedback: 'AGREE' } });
  });

  it('SAVE_FEEDBACK: 캐시에 없는 review_id면 entry: null을 반환한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const response = await handleMessage({ type: 'SAVE_FEEDBACK', reviewId: 'missing', feedback: 'AGREE' }, { cacheStore, aiConfig });
    expect(response).toEqual({ type: 'FEEDBACK_SAVED', entry: null });
  });
});
