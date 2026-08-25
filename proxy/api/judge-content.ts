import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { buildPrompt } from '../src/prompt';
import { guessMimeType } from '../src/mime';
import { saveDebugCapture } from '../src/debugCapture';
import { sendSlackAlert } from '../src/slackAlert';

interface GeminiLike {
  models: {
    generateContent: (
      params: Record<string, unknown>
    ) => Promise<{ text?: string; promptFeedback?: { blockReason?: string } }>;
  };
}

const JUDGMENT_SCHEMA = {
  type: 'object',
  properties: {
    content_relevant: { type: 'boolean' },
    content_flag: { type: 'string', enum: ['meaningless', 'public_order', 'profanity'], nullable: true },
    photos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          relevant: { type: 'boolean' },
          identifiable: { type: 'boolean' },
          flag: { type: 'string', enum: ['unidentifiable', 'public_order', 'irrelevant', 'personal_info'], nullable: true },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          hospital_name_match: { type: 'boolean', nullable: true },
          body_part_visible: { type: 'boolean' },
        },
        required: ['url', 'relevant', 'identifiable', 'flag', 'confidence', 'hospital_name_match', 'body_part_visible'],
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
  },
  required: ['content_relevant', 'content_flag', 'photos', 'confidence', 'reasoning'],
} as const;

interface JudgeRequestBody {
  review_id?: string;
  review_type: string;
  content_text: string;
  photos: Array<{ url: string; declared_category: string; before_after_slot?: 'BEFORE' | 'AFTER' }>;
  procedure?: { is_before_after_exempt: boolean };
  hospital_name?: string;
  profanity_candidate?: boolean;
}

function isValidBody(body: unknown): body is JudgeRequestBody {
  const b = body as Partial<JudgeRequestBody> | null;
  return !!b && typeof b.content_text === 'string' && Array.isArray(b.photos);
}

interface TaskJudgment {
  content_relevant: boolean;
  content_flag: 'meaningless' | 'public_order' | 'profanity' | null;
  photos: unknown[];
  confidence: number;
  reasoning: string;
}

// 한 후기에 사진이 최대 15장(일반 5 + 전/후 각 5)까지 붙을 수 있어, 전부 한 번에
// Gemini에 넣으면 요청이 커져 응답 실패/시간초과 위험이 커진다. 그래서 사진을 작은
// 단위로 나눠 순차적으로 여러 번 호출한다. 시술 전/후 사진은 같은 부위인지·동일
// 이미지인지 비교 판단이 필요해 등록 순서로 짝(전[i]+후[i])을 지어 함께 보내고,
// 짝이 없는 사진과 일반 사진은 한 장씩 보낸다.
function buildPhotoTasks(photos: JudgeRequestBody['photos']): number[][] {
  const beforeIdx: number[] = [];
  const afterIdx: number[] = [];
  const otherIdx: number[] = [];
  photos.forEach((p, i) => {
    if (p.declared_category === 'BEFORE_AFTER' && p.before_after_slot === 'BEFORE') beforeIdx.push(i);
    else if (p.declared_category === 'BEFORE_AFTER' && p.before_after_slot === 'AFTER') afterIdx.push(i);
    else otherIdx.push(i);
  });

  const tasks: number[][] = [];
  const pairCount = Math.max(beforeIdx.length, afterIdx.length);
  for (let i = 0; i < pairCount; i++) {
    tasks.push([beforeIdx[i], afterIdx[i]].filter((idx): idx is number => idx !== undefined));
  }
  for (const idx of otherIdx) tasks.push([idx]);

  return tasks.length > 0 ? tasks : [[]];
}

const CONTENT_FLAG_SEVERITY: Record<string, number> = { public_order: 3, profanity: 2, meaningless: 1 };

// 후기 내용은 사진과 무관하게 매 호출마다 동일하게 판단되어야 하므로, 호출 간에
// 갈리면 더 심각한 쪽(검토필요로 이어지는 public_order 등)으로 안전하게 합친다.
function pickWorseContentFlag(
  a: TaskJudgment['content_flag'],
  b: TaskJudgment['content_flag']
): TaskJudgment['content_flag'] {
  const sa = a ? CONTENT_FLAG_SEVERITY[a] ?? 0 : 0;
  const sb = b ? CONTENT_FLAG_SEVERITY[b] ?? 0 : 0;
  return sb > sa ? b : a;
}

export function createHandler(client: GeminiLike) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const allowedOrigin = process.env.ALLOWED_EXTENSION_ORIGIN;
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }

    if (!isValidBody(req.body)) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }

    const { review_id, review_type, content_text, photos, procedure, hospital_name, profanity_candidate } = req.body;

    let photoBuffers: Buffer[];
    let imageParts: Array<{ inlineData: { data: string; mimeType: string } }>;
    try {
      photoBuffers = await Promise.all(
        photos.map(async (p) => {
          const imgRes = await fetch(p.url);
          if (!imgRes.ok) throw new Error(`image fetch failed: ${imgRes.status}`);
          return Buffer.from(await imgRes.arrayBuffer());
        })
      );
      imageParts = photoBuffers.map((buf, i) => ({
        inlineData: { data: buf.toString('base64'), mimeType: guessMimeType(photos[i].url) },
      }));
    } catch {
      res.status(502).json({ error: 'failed to fetch review photo' });
      return;
    }

    const tasks = buildPhotoTasks(photos);
    const finalPhotos: unknown[] = new Array(photos.length);
    let contentRelevant = true;
    let contentFlag: TaskJudgment['content_flag'] = null;
    let confidence = 1;
    const reasonings: string[] = [];

    for (const taskIndices of tasks) {
      const taskPhotos = taskIndices.map((i) => photos[i]);
      const taskImageParts = taskIndices.map((i) => imageParts[i]);

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt(review_type, content_text, taskPhotos, procedure, hospital_name, profanity_candidate) },
              ...taskImageParts,
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: JUDGMENT_SCHEMA,
        },
      });

      if (!response.text) {
        // Gemini가 프롬프트 자체를 세이프티 정책으로 차단한 경우(예: 노출/신체 사진) —
        // 재시도해도 항상 같은 결과이므로 일반 실패와 구분되는 코드를 반환해
        // 클라이언트가 쓸모없는 재시도를 하지 않고 명확한 사유를 검수자에게 남기게 한다.
        if (response.promptFeedback?.blockReason) {
          await sendSlackAlert(
            process.env.SLACK_WEBHOOK_URL,
            [
              ':rotating_light: 후기 검수 AI가 사진을 세이프티 정책으로 차단해 판단하지 못했습니다 — 수기 검수가 필요합니다.',
              `후기번호: ${review_id ?? '알수없음'}`,
              `병원명: ${hospital_name ?? '-'}`,
              `차단 사유: ${response.promptFeedback.blockReason}`,
            ].join('\n')
          );
          res.status(422).json({ error: 'blocked_by_safety_filter', block_reason: response.promptFeedback.blockReason });
          return;
        }
        res.status(502).json({ error: 'AI did not return structured judgment' });
        return;
      }

      let taskParsed: TaskJudgment;
      try {
        taskParsed = JSON.parse(response.text);
      } catch {
        res.status(502).json({ error: 'AI did not return structured judgment' });
        return;
      }

      taskIndices.forEach((originalIndex, i) => {
        finalPhotos[originalIndex] = taskParsed.photos[i];
      });
      contentRelevant = contentRelevant && taskParsed.content_relevant;
      contentFlag = pickWorseContentFlag(contentFlag, taskParsed.content_flag);
      confidence = Math.min(confidence, taskParsed.confidence);
      reasonings.push(taskParsed.reasoning);
    }

    const parsed = {
      content_relevant: contentRelevant,
      content_flag: contentFlag,
      photos: finalPhotos,
      confidence,
      reasoning: reasonings.length > 1 ? reasonings.map((r, i) => `[${i + 1}] ${r}`).join('\n') : reasonings[0],
    };

    await saveDebugCapture(review_id, review_type, content_text, photos, photoBuffers, parsed);
    res.status(200).json(parsed);
  };
}

export default createHandler(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) as unknown as GeminiLike);
