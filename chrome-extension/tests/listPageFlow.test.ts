import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { runListPageFlow } from '../src/content/list/listPageFlow';
import type { ExtensionResponse } from '../src/shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

let table: HTMLTableElement;

// beforeEach로 매 테스트마다 새로 파싱한다 — runListPageFlow가 renderBadge로 테이블을
// 직접 변형하므로(배지 DOM 삽입), beforeAll로 공유하면 테스트 순서에 따라 상태가 오염된다.
beforeEach(() => {
  const html = readFileSync(join(__dirname, './fixtures/list-page.html'), 'utf-8');
  const dom = new JSDOM(html);
  table = dom.window.document.querySelector('table') as HTMLTableElement;
});

function fakeEntry(reviewId: string) {
  return {
    review_id: reviewId,
    tier: 'list' as const,
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
      review_id: reviewId,
      mock_judgment: 'APPROVE_CANDIDATE' as const,
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [],
      photo_notices: [],
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

describe('runListPageFlow', () => {
  it('JUDGE_LIST 메시지를 보내고 응답받은 항목마다 배지를 렌더링한다', async () => {
    const sendMessage = vi.fn(
      async (): Promise<ExtensionResponse> => ({
        type: 'JUDGE_LIST_RESULT',
        entries: [fakeEntry('1001'), fakeEntry('1003')],
      })
    );

    await runListPageFlow(table, sendMessage);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'JUDGE_LIST',
        force: true,
        rows: expect.arrayContaining([expect.objectContaining({ review_id: '1001' })]),
      })
    );
    expect(table.querySelectorAll('.rvw-mock-badge').length).toBe(2);
  });

  it('CAPTURE_STATUS 메시지도 함께 보낸다(현재 페이지 전체 행의 상태)', async () => {
    const sendMessage = vi.fn(async (msg: any): Promise<ExtensionResponse> => {
      if (msg.type === 'JUDGE_LIST') return { type: 'JUDGE_LIST_RESULT', entries: [] };
      return { type: 'CAPTURE_DONE' };
    });

    await runListPageFlow(table, sendMessage);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CAPTURE_STATUS',
        rows: expect.arrayContaining([expect.objectContaining({ review_id: '1002', review_status: '승인' })]),
      })
    );
  });
});
