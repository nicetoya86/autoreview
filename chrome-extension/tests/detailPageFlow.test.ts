import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { runDetailPageFlow } from '../src/content/detail/detailPageFlow';
import type { ExtensionResponse } from '../src/shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

let root: HTMLElement;
let panelContainer: HTMLElement;

beforeEach(() => {
  const html = readFileSync(join(__dirname, './fixtures/detail-page.html'), 'utf-8');
  const dom = new JSDOM(`<div id="panel-container"></div>${html}`);
  root = dom.window.document.querySelector('.review-detail') as HTMLElement;
  panelContainer = dom.window.document.getElementById('panel-container') as HTMLElement;
});

describe('runDetailPageFlow', () => {
  it('진입 시 GET_CACHE로 조회해 패널을 렌더링한다', async () => {
    const sendMessage = vi.fn(async (): Promise<ExtensionResponse> => ({ type: 'CACHE_ENTRY', entry: null }));

    await runDetailPageFlow(root, panelContainer, '1001', sendMessage);

    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_CACHE', reviewId: '1001' });
    expect(panelContainer.querySelector('.rvw-mock-judge-button')).not.toBeNull();
  });

  it('정밀 판정하기 클릭 시 상세 데이터를 파싱해 JUDGE_DETAIL을 보낸다', async () => {
    const sendMessage = vi.fn(async (msg: any): Promise<ExtensionResponse> => {
      if (msg.type === 'GET_CACHE') return { type: 'CACHE_ENTRY', entry: null };
      return {
        type: 'JUDGE_DETAIL_RESULT',
        entry: {
          review_id: '1001',
          tier: 'detail',
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
          result: { review_id: '1001', mock_judgment: 'APPROVE_CANDIDATE', matched_rules: [], confidence: 1, reasoning: 'ok', ai_invoked: true, photo_results: [], photo_notices: [] },
          checked_at: '2026-07-20T00:00:00Z',
        },
      };
    });

    await runDetailPageFlow(root, panelContainer, '1001', sendMessage);
    (panelContainer.querySelector('.rvw-mock-judge-button') as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'JUDGE_DETAIL', detail: expect.objectContaining({ review_id: '1001' }) }));
  });

  it('동의 버튼 클릭 시 SAVE_FEEDBACK을 보낸다', async () => {
    const detailEntry = {
      review_id: '1001',
      tier: 'detail' as const,
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
      result: { review_id: '1001', mock_judgment: 'APPROVE_CANDIDATE' as const, matched_rules: [], confidence: 1, reasoning: 'ok', ai_invoked: true, photo_results: [], photo_notices: [] },
      checked_at: '2026-07-20T00:00:00Z',
    };
    const sendMessage = vi.fn(async (msg: any): Promise<ExtensionResponse> => {
      if (msg.type === 'GET_CACHE') return { type: 'CACHE_ENTRY', entry: detailEntry };
      if (msg.type === 'SAVE_FEEDBACK') return { type: 'FEEDBACK_SAVED', entry: { ...detailEntry, reviewer_feedback: msg.feedback } };
      throw new Error('unexpected message');
    });

    await runDetailPageFlow(root, panelContainer, '1001', sendMessage);
    (panelContainer.querySelector('.rvw-mock-feedback-agree') as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_FEEDBACK', reviewId: '1001', feedback: 'AGREE' });
  });
});
