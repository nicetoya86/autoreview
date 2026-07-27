import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeListRow, judgeDetail } from '../src/background/judge';
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

import { judgeReview } from 'judgment-engine';

const emptyDuplicateFlags = {
  same_customer: false,
  same_written_at: false,
  same_procedure_event: false,
  same_content: false,
  same_photo: false,
  same_receipt: false,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('judgeListRow', () => {
  it('영수증 유형이면 receipt 필드를 전부 null로 채워 넘긴다', async () => {
    const row: ListRowData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: 'ok',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'RECEIPT' }],
      review_status: '대기',
      modified_at: '2026-07-20',
      author: '홍**',
    };

    await judgeListRow(row, emptyDuplicateFlags, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(judgeReview).toHaveBeenCalledWith(
      expect.objectContaining({
        review_id: 'r1',
        receipt: { amount_matches: null, date_matches: null, hospital_name_matches: null, photo_count: 1, is_app_payment_receipt: false },
        duplicate_flags: emptyDuplicateFlags,
      }),
      { proxyUrl: 'https://proxy.example/api/judge-content' }
    );
  });

  it('영수증이 아닌 유형이면 receipt를 넘기지 않는다', async () => {
    const row: ListRowData = {
      review_id: 'r2',
      review_type: 'TICKET_USE',
      content_text: 'ok',
      photos: [],
      review_status: '대기',
      modified_at: '2026-07-20',
      author: '홍**',
    };

    await judgeListRow(row, emptyDuplicateFlags, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(judgeReview).toHaveBeenCalledWith(expect.objectContaining({ receipt: undefined }), expect.anything());
  });
});

describe('judgeDetail', () => {
  it('상세 데이터의 procedure/receipt/hospital_requested_takedown을 그대로 전달한다', async () => {
    const detail: DetailPageData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: 'ok',
      photos: [],
      procedure: { name: '브라질리언 제모', is_before_after_exempt: true },
      receipt: { amount_matches: true, date_matches: true, hospital_name_matches: true, photo_count: 1, is_app_payment_receipt: false },
      hospital_requested_takedown: false,
      modified_at: '2026-07-20',
    };

    await judgeDetail(detail, emptyDuplicateFlags, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(judgeReview).toHaveBeenCalledWith(
      expect.objectContaining({
        procedure: detail.procedure,
        receipt: detail.receipt,
        hospital_requested_takedown: false,
      }),
      expect.anything()
    );
  });
});
