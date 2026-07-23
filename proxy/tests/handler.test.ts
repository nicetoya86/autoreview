import { describe, it, expect, vi } from 'vitest';
import { createHandler } from '../api/judge-content';

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('judge-content handler', () => {
  it('POST가 아니면 405 반환', async () => {
    const handler = createHandler({ messages: { create: vi.fn() } } as any);
    const req: any = { method: 'GET' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('body가 유효하지 않으면 400 반환', async () => {
    const handler = createHandler({ messages: { create: vi.fn() } } as any);
    const req: any = { method: 'POST', body: { content_text: 123 } };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('Claude 응답의 tool_use.input을 그대로 반환', async () => {
    const toolResult = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', name: 'submit_judgment', input: toolResult }],
    });
    const handler = createHandler({ messages: { create } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }] },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5', tool_choice: { type: 'tool', name: 'submit_judgment' } })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(toolResult);
  });

  it('Claude가 tool_use를 반환하지 않으면 502', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'oops' }] });
    const handler = createHandler({ messages: { create } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [] },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
  });
});
