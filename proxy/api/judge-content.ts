import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { buildPrompt } from '../src/prompt';
import { guessMimeType } from '../src/mime';
import { saveDebugCapture } from '../src/debugCapture';

interface GeminiLike {
  models: {
    generateContent: (params: Record<string, unknown>) => Promise<{ text?: string }>;
  };
}

const JUDGMENT_SCHEMA = {
  type: 'object',
  properties: {
    content_relevant: { type: 'boolean' },
    content_flag: { type: 'string', enum: ['meaningless', 'public_order'], nullable: true },
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
        },
        required: ['url', 'relevant', 'identifiable', 'flag', 'confidence'],
      },
    },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['content_relevant', 'content_flag', 'photos', 'confidence', 'reasoning'],
} as const;

interface JudgeRequestBody {
  review_type: string;
  content_text: string;
  photos: Array<{ url: string; declared_category: string }>;
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

    const { review_type, content_text, photos } = req.body;

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
          parts: [{ text: buildPrompt(review_type, content_text, photos) }, ...imageParts],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: JUDGMENT_SCHEMA,
      },
    });

    if (!response.text) {
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

    await saveDebugCapture(undefined, review_type, content_text, photos, photoBuffers, parsed);
    res.status(200).json(parsed);
  };
}

export default createHandler(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) as unknown as GeminiLike);
