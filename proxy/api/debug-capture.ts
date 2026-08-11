import type { VercelRequest, VercelResponse } from '@vercel/node';
import { saveDebugCapture } from '../src/debugCapture';

interface CaptureRequestBody {
  review_id?: string;
  review_type: string;
  content_text: string;
  photos: Array<{ url: string }>;
  judgment: unknown;
}

function isValidBody(body: unknown): body is CaptureRequestBody {
  const b = body as Partial<CaptureRequestBody> | null;
  return !!b && typeof b.content_text === 'string' && Array.isArray(b.photos);
}

/**
 * AI 호출 여부와 무관하게(객관 규칙만으로 결정된 건 포함) 모의판정 1건마다 호출되는
 * 캡처 전용 엔드포인트. judge-content와 달리 AI 판정을 하지 않으므로 사진을 직접 fetch한다.
 */
export function createHandler() {
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

    if (!process.env.DEBUG_CAPTURE_DIR) {
      res.status(204).end();
      return;
    }

    const { review_id, review_type, content_text, photos, judgment } = req.body;

    const fetched = await Promise.all(
      photos.map(async (p) => {
        try {
          const imgRes = await fetch(p.url);
          if (!imgRes.ok) return null;
          return { photo: p, buffer: Buffer.from(await imgRes.arrayBuffer()) };
        } catch {
          return null;
        }
      })
    );
    const captured = fetched.filter((f) => f !== null) as Array<{ photo: { url: string }; buffer: Buffer }>;

    await saveDebugCapture(
      review_id,
      review_type,
      content_text,
      captured.map((c) => c.photo),
      captured.map((c) => c.buffer),
      judgment
    );

    res.status(204).end();
  };
}

export default createHandler();
