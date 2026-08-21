import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeContentWithAi, SAFETY_BLOCK_ERROR_MESSAGE } from '../src/ai/aiAdapter';

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

  it('POST 요청 본문에 before_after_slot과 procedure를 포함해서 전송', async () => {
    const inputWithBeforeAfter = {
      review_type: 'TICKET_USE' as const,
      content_text: '시술 후 만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'BEFORE_AFTER' as const, before_after_slot: 'BEFORE' as const }],
      procedure: { is_before_after_exempt: false },
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
      photos: [{ url: 'https://x/1.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' }],
      procedure: { is_before_after_exempt: false },
    });
  });

  it('procedure나 before_after_slot이 없으면 요청 본문에도 포함하지 않는다', async () => {
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

    await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody).toEqual({
      review_type: 'TICKET_USE',
      content_text: '시술 후 만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
    });
    expect(parsedBody).not.toHaveProperty('procedure');
  });

  it('review_id가 있으면 POST 요청 본문에 review_id를 포함해서 전송', async () => {
    const inputWithReviewId = { ...sampleInput, review_id: '1158902' };
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

    await judgeContentWithAi(inputWithReviewId, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(JSON.parse(capturedBody!)).toMatchObject({ review_id: '1158902' });
  });

  it('review_id가 없으면 요청 본문에 review_id를 포함하지 않는다', async () => {
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

    await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(JSON.parse(capturedBody!)).not.toHaveProperty('review_id');
  });

  it('profanityCandidate가 true면 POST 요청 본문에 profanity_candidate를 포함해서 전송', async () => {
    const inputWithProfanityCandidate = { ...sampleInput, profanityCandidate: true };
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

    await judgeContentWithAi(inputWithProfanityCandidate, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(JSON.parse(capturedBody!)).toMatchObject({ profanity_candidate: true });
  });

  it('profanityCandidate가 없으면 요청 본문에 profanity_candidate를 포함하지 않는다', async () => {
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

    await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(JSON.parse(capturedBody!)).not.toHaveProperty('profanity_candidate');
  });

  it("content_flag이 'profanity'면 정상 응답으로 파싱", async () => {
    const fakeResponse = {
      content_relevant: true,
      content_flag: 'profanity',
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: '욕설 확인됨',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    } as unknown as Response);

    const result = await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });
    expect(result).toEqual(fakeResponse);
  });

  it('POST 요청 본문에 hospital_name을 포함해서 전송', async () => {
    const inputWithHospital = { ...sampleInput, hospital_name: '다올림성형외과의원' };
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

    await judgeContentWithAi(inputWithHospital, { proxyUrl: 'https://proxy.example/api/judge-content' });

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.hospital_name).toBe('다올림성형외과의원');
  });

  it('타임아웃이 발생하면 fetch가 중단되고 에러를 던짐 (재시도 후에도 타임아웃되면 최종 실패)', async () => {
    let abortCount = 0;
    global.fetch = vi.fn((url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal;
      // Return a promise that rejects when abort fires
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          abortCount++;
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
        // Never resolve on its own
      });
    });

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content', timeoutMs: 20 })
    ).rejects.toThrow();
    expect(abortCount).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('프록시가 세이프티 정책 차단(blocked_by_safety_filter)을 반환하면 재시도 없이 즉시 에러를 던짐', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'blocked_by_safety_filter', block_reason: 'OTHER' }),
    } as unknown as Response);

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' })
    ).rejects.toThrow(SAFETY_BLOCK_ERROR_MESSAGE);
    expect(global.fetch).toHaveBeenCalledTimes(1); // 결정적 차단이므로 재시도하지 않는다
  });

  it('첫 시도가 실패해도 재시도가 성공하면 정상 결과를 반환', async () => {
    const fakeResponse = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('network blip');
      }
      return { ok: true, json: async () => fakeResponse } as unknown as Response;
    });

    const result = await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });
    expect(result).toEqual(fakeResponse);
    expect(callCount).toBe(2);
  });
});
