import type { AiContentJudgment, ReviewInput } from '../types';

export interface AiAdapterConfig {
  proxyUrl: string;
  timeoutMs?: number;
}

/**
 * 순수 함수: DOM/chrome API에 의존하지 않고 fetch만 사용하므로
 * 브라우저 확장(background)과 Node.js 양쪽에서 동일하게 동작한다.
 */
export async function judgeContentWithAi(
  input: Pick<ReviewInput, 'review_type' | 'content_text' | 'photos'>,
  config: AiAdapterConfig
): Promise<AiContentJudgment> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);

  try {
    const res = await fetch(config.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        review_type: input.review_type,
        content_text: input.content_text,
        photos: input.photos.map((p) => ({ url: p.url, declared_category: p.declared_category })),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`proxy responded with status ${res.status}`);
    }

    const data = await res.json();
    return validateAiResponse(data);
  } finally {
    clearTimeout(timeout);
  }
}

function validateAiResponse(data: unknown): AiContentJudgment {
  const d = data as Partial<AiContentJudgment> | null;
  if (
    !d ||
    typeof d.content_relevant !== 'boolean' ||
    !Array.isArray(d.photos) ||
    typeof d.confidence !== 'number' ||
    typeof d.reasoning !== 'string'
  ) {
    throw new Error('invalid AI response shape');
  }
  return d as AiContentJudgment;
}
