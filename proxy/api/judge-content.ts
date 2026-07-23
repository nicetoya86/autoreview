import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt } from '../src/prompt';

interface AnthropicLike {
  messages: {
    create: (params: Record<string, unknown>) => Promise<{ content: Array<Record<string, unknown>> }>;
  };
}

const JUDGE_TOOL = {
  name: 'submit_judgment',
  description: '후기 텍스트와 사진에 대한 판단 결과를 제출한다',
  input_schema: {
    type: 'object',
    properties: {
      content_relevant: { type: 'boolean' },
      content_flag: { type: ['string', 'null'], enum: ['meaningless', 'public_order', null] },
      photos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            relevant: { type: 'boolean' },
            identifiable: { type: 'boolean' },
            flag: { type: ['string', 'null'], enum: ['unidentifiable', 'public_order', 'irrelevant', null] },
            confidence: { type: 'number' },
          },
          required: ['url', 'relevant', 'identifiable', 'flag', 'confidence'],
        },
      },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['content_relevant', 'content_flag', 'photos', 'confidence', 'reasoning'],
  },
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

export function createHandler(client: AnthropicLike) {
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

    const imageBlocks = photos.map((p) => ({
      type: 'image' as const,
      source: { type: 'url' as const, url: p.url },
    }));

    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      tools: [JUDGE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_judgment' },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildPrompt(review_type, content_text, photos.length) }, ...imageBlocks],
        },
      ],
    });

    const toolUse = message.content.find((block) => block.type === 'tool_use');
    if (!toolUse) {
      res.status(502).json({ error: 'AI did not return structured judgment' });
      return;
    }

    res.status(200).json((toolUse as { input: unknown }).input);
  };
}

export default createHandler(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
