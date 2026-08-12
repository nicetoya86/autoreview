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
  input: Pick<ReviewInput, 'review_type' | 'content_text' | 'photos'> & {
    procedure?: ReviewInput['procedure'];
  },
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
        photos: input.photos.map((p) => ({
          url: p.url,
          declared_category: p.declared_category,
          ...(p.before_after_slot ? { before_after_slot: p.before_after_slot } : {}),
        })),
        ...(input.procedure ? { procedure: input.procedure } : {}),
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

  // Validate content_flag: must be explicitly 'meaningless', 'public_order', or null
  if (d.content_flag !== 'meaningless' && d.content_flag !== 'public_order' && d.content_flag !== null) {
    throw new Error('invalid AI response shape');
  }

  // Validate photos array: each element must have required fields with correct types
  for (const photo of d.photos) {
    if (
      typeof photo.url !== 'string' ||
      typeof photo.relevant !== 'boolean' ||
      typeof photo.identifiable !== 'boolean' ||
      typeof photo.confidence !== 'number' ||
      (photo.flag !== 'unidentifiable' &&
        photo.flag !== 'public_order' &&
        photo.flag !== 'irrelevant' &&
        photo.flag !== 'personal_info' &&
        photo.flag !== null)
    ) {
      throw new Error('invalid AI response shape');
    }
  }

  return d as AiContentJudgment;
}
