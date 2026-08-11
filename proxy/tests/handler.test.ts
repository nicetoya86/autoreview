import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHandler } from '../api/judge-content';

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
}

describe('judge-content handler', () => {
  it('POST가 아니면 405 반환', async () => {
    const handler = createHandler({ models: { generateContent: vi.fn() } } as any);
    const req: any = { method: 'GET' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('body가 유효하지 않으면 400 반환', async () => {
    const handler = createHandler({ models: { generateContent: vi.fn() } } as any);
    const req: any = { method: 'POST', body: { content_text: 123 } };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('Gemini 응답의 JSON 텍스트를 파싱해 그대로 반환', async () => {
    const judgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(judgment) });
    const handler = createHandler({ models: { generateContent } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }] },
    };
    const res = fakeRes();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as any);

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith('https://x/1.jpg');
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        config: expect.objectContaining({ responseMimeType: 'application/json' }),
        contents: [
          expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({ inlineData: expect.objectContaining({ mimeType: 'image/jpeg' }) }),
            ]),
          }),
        ],
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(judgment);

    fetchMock.mockRestore();
  });

  it('후기 사진 fetch가 실패하면 502 반환', async () => {
    const generateContent = vi.fn();
    const handler = createHandler({ models: { generateContent } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }] },
    };
    const res = fakeRes();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as any);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(generateContent).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('Gemini가 빈 응답을 반환하면 502', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '' });
    const handler = createHandler({ models: { generateContent } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [] },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('Gemini 응답이 JSON으로 파싱되지 않으면 502', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: 'not json at all' });
    const handler = createHandler({ models: { generateContent } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [] },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe('judge-content handler CORS', () => {
  const originalEnv = process.env.ALLOWED_EXTENSION_ORIGIN;

  afterEach(() => {
    process.env.ALLOWED_EXTENSION_ORIGIN = originalEnv;
  });

  it('ALLOWED_EXTENSION_ORIGIN이 설정되어 있으면 Access-Control-Allow-Origin을 반환한다', async () => {
    process.env.ALLOWED_EXTENSION_ORIGIN = 'chrome-extension://abc123';
    const handler = createHandler({ models: { generateContent: vi.fn() } } as any);
    const req: any = { method: 'OPTIONS' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'chrome-extension://abc123');
  });

  it('OPTIONS 프리플라이트는 204로 즉시 응답한다', async () => {
    process.env.ALLOWED_EXTENSION_ORIGIN = 'chrome-extension://abc123';
    const handler = createHandler({ models: { generateContent: vi.fn() } } as any);
    const req: any = { method: 'OPTIONS' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(204);
  });
});
