import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { buildPrompt } from '../src/prompt';

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
          flag: { type: 'string', enum: ['unidentifiable', 'public_order', 'irrelevant'], nullable: true },
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

function guessMimeType(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

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
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }

    if (!isValidBody(req.body)) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }

    const { review_type, content_text, photos } = req.body;

    const imageParts = photos.map((p) => ({
      fileData: { fileUri: p.url, mimeType: guessMimeType(p.url) },
    }));

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: buildPrompt(review_type, content_text, photos.length) }, ...imageParts],
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

    res.status(200).json(parsed);
  };
}

export default createHandler(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) as unknown as GeminiLike);
