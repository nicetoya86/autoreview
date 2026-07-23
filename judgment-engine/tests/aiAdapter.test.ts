import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeContentWithAi } from '../src/ai/aiAdapter';

const sampleInput = {
  review_type: 'TICKET_USE' as const,
  content_text: '시술 후 만족스러웠어요',
  photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' as const }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('judgeContentWithAi', () => {
  it('프록시가 정상 응답하면 파싱된 결과를 반환', async () => {
    const fakeResponse = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    } as unknown as Response);

    const result = await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });
    expect(result).toEqual(fakeResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://proxy.example/api/judge-content',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('프록시가 실패 상태를 반환하면 에러를 던짐', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' })
    ).rejects.toThrow('proxy responded with status 500');
  });

  it('응답 형태가 이상하면 에러를 던짐', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nonsense: true }) } as unknown as Response);

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' })
    ).rejects.toThrow('invalid AI response shape');
  });
});
