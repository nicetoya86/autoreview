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
          confidence: { type: 'number' },
          hospital_name_match: { type: 'boolean', nullable: true },
        },
        required: ['url', 'relevant', 'identifiable', 'flag', 'confidence', 'hospital_name_match'],
      },
    },
    confidence: { type: 'number' },
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

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildPrompt(review_type, content_text, photos, procedure, hospital_name, profanity_candidate) },
            ...imageParts,
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      res.status(502).json({ error: 'AI did not return structured judgment' });
      return;
    }

    await saveDebugCapture(review_id, review_type, content_text, photos, photoBuffers, parsed);
    res.status(200).json(parsed);
  };
}

export default createHandler(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) as unknown as GeminiLike);
