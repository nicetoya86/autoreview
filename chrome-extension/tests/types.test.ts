import { describe, it, expect } from 'vitest';
import type { CacheEntry, ListRowData, DetailPageData } from '../src/shared/types';

describe('shared types', () => {
  it('CacheEntry/ListRowData/DetailPageData를 구성할 수 있다', () => {
    const row: ListRowData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: '만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
      review_status: '대기',
      written_at: '2026-07-20T00:00:00Z',
      modified_at: '2026-07-20T00:00:00Z',
      author: '홍**',
    };

    const detail: DetailPageData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: '만족스러웠어요',
      photos: row.photos,
      procedure: { is_before_after_exempt: false },
      hospital_requested_takedown: false,
      modified_at: row.modified_at,
    };

    const entry: CacheEntry = {
      review_id: 'r1',
      tier: 'list',
      fingerprint: 'abc',
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
        review_id: 'r1',
        mock_judgment: 'NEEDS_REVIEW',
        matched_rules: [],
        confidence: 0,
        reasoning: 'ok',
        ai_invoked: false,
        photo_results: [],
      },
      checked_at: '2026-07-20T00:00:00Z',
    };

    expect(row.review_id).toBe('r1');
    expect(detail.review_id).toBe('r1');
    expect(entry.tier).toBe('list');
  });
});
