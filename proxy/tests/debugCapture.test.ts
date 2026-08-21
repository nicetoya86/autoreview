import { describe, it, expect, vi, afterEach } from 'vitest';
import { rm, readdir, readFile } from 'node:fs/promises';
import { createHandler } from '../api/debug-capture';

const TEST_CAPTURE_DIR = '.debug-captures-test';

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(TEST_CAPTURE_DIR, { recursive: true, force: true });
});

describe('debug-capture handler', () => {
  it('POST가 아니면 405 반환', async () => {
    const handler = createHandler();
    const req: any = { method: 'GET' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('body가 유효하지 않으면 400 반환', async () => {
    const handler = createHandler();
    const req: any = { method: 'POST', body: { content_text: 123 } };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('DEBUG_CAPTURE_DIR이 없으면 사진 fetch 없이 204 반환', async () => {
    vi.stubEnv('DEBUG_CAPTURE_DIR', '');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const handler = createHandler();
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [], judgment: { mock_judgment: 'APPROVE_CANDIDATE' } },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('유효한 요청이면 사진을 fetch해서 저장하고 204 반환', async () => {
    vi.stubEnv('DEBUG_CAPTURE_DIR', TEST_CAPTURE_DIR);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as any);
    const handler = createHandler();
    const req: any = {
      method: 'POST',
      body: {
        review_id: 'r1',
        review_type: 'TICKET_USE',
        content_text: 'ok',
        photos: [{ url: 'https://x/1.jpg' }],
        judgment: { mock_judgment: 'APPROVE_CANDIDATE', ai_invoked: false },
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith('https://x/1.jpg');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('작성자/병원명/작성일시/이벤트정보/중복플래그를 함께 보내면 review.json에 그대로 저장한다', async () => {
    vi.stubEnv('DEBUG_CAPTURE_DIR', TEST_CAPTURE_DIR);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as any);
    const handler = createHandler();
    const req: any = {
      method: 'POST',
      body: {
        review_id: 'r1',
        review_type: 'TICKET_USE',
        content_text: 'ok',
        photos: [{ url: 'https://x/1.jpg' }],
        judgment: { mock_judgment: 'AUTO_HOLD_CANDIDATE', ai_invoked: false, matched_rules: ['8.4-duplicate'] },
        author: '홍**',
        hospital_name: '루비의원',
        written_at: '2026-07-20 09:55',
        event_info: '이벤트A',
        duplicate_flags: { same_customer: true },
      },
    };
    const res = fakeRes();

    await handler(req, res);

    const [caseDir] = await readdir(TEST_CAPTURE_DIR);
    const saved = JSON.parse(await readFile(`${TEST_CAPTURE_DIR}/${caseDir}/review.json`, 'utf-8'));
    expect(saved.author).toBe('홍**');
    expect(saved.hospital_name).toBe('루비의원');
    expect(saved.written_at).toBe('2026-07-20 09:55');
    expect(saved.event_info).toBe('이벤트A');
    expect(saved.duplicate_flags).toEqual({ same_customer: true });
  });
});
