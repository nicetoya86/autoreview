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
    expect(res.json).toHaveBeenCalledWith({
      ...judgment,
      photos: [{ ...judgment.photos[0], low_resolution: false }],
    });

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

  it('Gemini가 세이프티 정책으로 프롬프트를 차단하면(promptFeedback.blockReason) 422와 blocked_by_safety_filter를 반환', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '', promptFeedback: { blockReason: 'OTHER' } });
    const handler = createHandler({ models: { generateContent } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [] },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: 'blocked_by_safety_filter', block_reason: 'OTHER' });
  });

  describe('세이프티 정책 차단 시 Slack 알림', () => {
    const originalWebhook = process.env.SLACK_WEBHOOK_URL;

    afterEach(() => {
      process.env.SLACK_WEBHOOK_URL = originalWebhook;
    });

    it('SLACK_WEBHOOK_URL이 설정돼 있으면 후기번호/병원명/차단사유를 담아 Slack으로 알림을 보낸다', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/xxx';
      const generateContent = vi.fn().mockResolvedValue({ text: '', promptFeedback: { blockReason: 'OTHER' } });
      const handler = createHandler({ models: { generateContent } } as any);
      const req: any = {
        method: 'POST',
        body: {
          review_id: '1158902',
          review_type: 'TICKET_USE',
          content_text: 'ok',
          photos: [],
          hospital_name: '루비의원',
        },
      };
      const res = fakeRes();

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);

      await handler(req, res);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/xxx',
        expect.objectContaining({ method: 'POST' })
      );
      const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(sentBody.text).toContain('1158902');
      expect(sentBody.text).toContain('루비의원');
      expect(sentBody.text).toContain('OTHER');

      fetchMock.mockRestore();
    });

    it('SLACK_WEBHOOK_URL이 없으면 Slack으로 보내지 않고도 정상적으로 422를 반환한다', async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const generateContent = vi.fn().mockResolvedValue({ text: '', promptFeedback: { blockReason: 'OTHER' } });
      const handler = createHandler({ models: { generateContent } } as any);
      const req: any = {
        method: 'POST',
        body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [] },
      };
      const res = fakeRes();

      const fetchMock = vi.spyOn(globalThis, 'fetch');

      await handler(req, res);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(422);

      fetchMock.mockRestore();
    });
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
