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

  it('content_flag이 유효하지 않으면 에러를 던짐', async () => {
    const fakeResponse = {
      content_relevant: true,
      content_flag: 'spam', // invalid: must be 'meaningless', 'public_order', or null
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    } as unknown as Response);

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' })
    ).rejects.toThrow('invalid AI response shape');
  });

  it("photo flag가 'personal_info'면 정상 응답으로 파싱", async () => {
    const fakeResponse = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: 'personal_info', confidence: 0.8 }],
      confidence: 0.8,
      reasoning: '전화번호 노출',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    } as unknown as Response);

    const result = await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });
    expect(result).toEqual(fakeResponse);
  });

  it('photos 배열에 malformed 요소가 있으면 에러를 던짐', async () => {
    const fakeResponse = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/2.jpg', relevant: false, flag: 'invalid-flag', confidence: 0.5 }, // missing 'identifiable' and invalid 'flag'
      ],
      confidence: 0.9,
      reasoning: 'ok',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    } as unknown as Response);

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' })
    ).rejects.toThrow('invalid AI response shape');
  });

  it('POST 요청 본문에서 before_after_slot을 제거하고 전송', async () => {
    const inputWithBeforeAfter = {
      review_type: 'TICKET_USE' as const,
      content_text: '시술 후 만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'BEFORE_AFTER' as const, before_after_slot: 'BEFORE' as const }],
    };
    const fakeResponse = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    let capturedBody: string | undefined;
    global.fetch = vi.fn(async (url: string, options: RequestInit) => {
      capturedBody = options.body as string;
      return { ok: true, json: async () => fakeResponse } as unknown as Response;
    });

    await judgeContentWithAi(inputWithBeforeAfter, { proxyUrl: 'https://proxy.example/api/judge-content' });

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody).toEqual({
      review_type: 'TICKET_USE',
      content_text: '시술 후 만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'BEFORE_AFTER' }],
    });
    expect(parsedBody.photos[0]).not.toHaveProperty('before_after_slot');
  });

  it('타임아웃이 발생하면 fetch가 중단되고 에러를 던짐', async () => {
    vi.useFakeTimers();
    try {
      let abortWasCalled = false;
      global.fetch = vi.fn((url: string, options: RequestInit) => {
        const signal = options.signal as AbortSignal;
        // Return a promise that rejects when abort fires
        return new Promise((resolve, reject) => {
          const abortHandler = () => {
            abortWasCalled = true;
            reject(new DOMException('The operation was aborted', 'AbortError'));
          };
          signal.addEventListener('abort', abortHandler);
          // Never resolve on its own
        });
      });

      const promise = judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content', timeoutMs: 100 });

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow();
      expect(abortWasCalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
