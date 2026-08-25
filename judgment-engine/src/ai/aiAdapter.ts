import type { AiContentJudgment, ReviewInput } from '../types';

export interface AiAdapterConfig {
  proxyUrl: string;
  timeoutMs?: number;
}

/**
 * 순수 함수: DOM/chrome API에 의존하지 않고 fetch만 사용하므로
 * 브라우저 확장(background)과 Node.js 양쪽에서 동일하게 동작한다.
 */
const MAX_ATTEMPTS = 2;

// Gemini가 프롬프트를 세이프티 정책으로 차단한 경우(노출 사진 등) 붙는 에러 메시지 —
// 재시도해도 항상 같은 결과이므로 이 값으로 판별해 재시도를 건너뛴다.
export const SAFETY_BLOCK_ERROR_MESSAGE = 'blocked_by_safety_filter';

export async function judgeContentWithAi(
  input: Pick<ReviewInput, 'review_type' | 'content_text' | 'photos' | 'hospital_name'> & {
    review_id?: ReviewInput['review_id'];
    procedure?: ReviewInput['procedure'];
    profanityCandidate?: boolean;
  },
  config: AiAdapterConfig
): Promise<AiContentJudgment> {
  let lastError: unknown;
  // 네트워크 오류/타임아웃/모델의 일회성 스키마 위반 등 일과성 실패로 검수자에게
  // NEEDS_REVIEW(ai-error)가 넘어가는 경우가 실측에서 잦아, 포기 전 한 번 더 시도한다.
  // 다만 세이프티 정책 차단은 결정적(항상 같은 결과)이므로 재시도하지 않는다.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptJudgeContentWithAi(input, config);
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message === SAFETY_BLOCK_ERROR_MESSAGE) break;
    }
  }
  throw lastError;
}

async function attemptJudgeContentWithAi(
  input: Pick<ReviewInput, 'review_type' | 'content_text' | 'photos' | 'hospital_name'> & {
    review_id?: ReviewInput['review_id'];
    procedure?: ReviewInput['procedure'];
    profanityCandidate?: boolean;
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
        ...(input.review_id ? { review_id: input.review_id } : {}),
        review_type: input.review_type,
        content_text: input.content_text,
        photos: input.photos.map((p) => ({
          url: p.url,
          declared_category: p.declared_category,
          ...(p.before_after_slot ? { before_after_slot: p.before_after_slot } : {}),
        })),
        ...(input.procedure ? { procedure: input.procedure } : {}),
        ...(input.hospital_name ? { hospital_name: input.hospital_name } : {}),
        ...(input.profanityCandidate ? { profanity_candidate: true } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      if ((errorBody as { error?: string } | null)?.error === SAFETY_BLOCK_ERROR_MESSAGE) {
        throw new Error(SAFETY_BLOCK_ERROR_MESSAGE);
      }
      throw new Error(`proxy responded with status ${res.status}`);
    }

    const data = await res.json();
    return validateAiResponse(data);
  } finally {
    clearTimeout(timeout);
  }
}

// confidence는 "얼마나 확신하는지"를 나타내는 0~1 사이 값이어야 하는데,
// 모델이 이 범위를 벗어난 값(예: 5)을 반환하는 사례가 실측에서 확인됐다.
function isValidConfidence(n: number): boolean {
  return n >= 0 && n <= 1;
}

function validateAiResponse(data: unknown): AiContentJudgment {
  const d = data as Partial<AiContentJudgment> | null;
  if (
    !d ||
    typeof d.content_relevant !== 'boolean' ||
    !Array.isArray(d.photos) ||
    typeof d.confidence !== 'number' ||
    !isValidConfidence(d.confidence) ||
    typeof d.reasoning !== 'string'
  ) {
    throw new Error('invalid AI response shape');
  }

  // Validate content_flag: must be explicitly 'meaningless', 'public_order', 'profanity', or null
  if (
    d.content_flag !== 'meaningless' &&
    d.content_flag !== 'public_order' &&
    d.content_flag !== 'profanity' &&
    d.content_flag !== null
  ) {
    throw new Error('invalid AI response shape');
  }

  // Validate photos array: each element must have required fields with correct types
  for (const photo of d.photos) {
    if (
      typeof photo.url !== 'string' ||
      typeof photo.relevant !== 'boolean' ||
      typeof photo.identifiable !== 'boolean' ||
      typeof photo.confidence !== 'number' ||
      !isValidConfidence(photo.confidence) ||
      (photo.flag !== 'unidentifiable' &&
        photo.flag !== 'public_order' &&
        photo.flag !== 'irrelevant' &&
        photo.flag !== 'personal_info' &&
        photo.flag !== null) ||
      (photo.hospital_name_match !== undefined &&
        photo.hospital_name_match !== null &&
        typeof photo.hospital_name_match !== 'boolean') ||
      (photo.body_part_visible !== undefined && typeof photo.body_part_visible !== 'boolean') ||
      (photo.low_resolution !== undefined && typeof photo.low_resolution !== 'boolean')
    ) {
      throw new Error('invalid AI response shape');
    }
  }

  return d as AiContentJudgment;
}
