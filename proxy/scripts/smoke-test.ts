import { GoogleGenAI } from '@google/genai';
import { createHandler } from '../api/judge-content';

/**
 * 수동 실행 전용 스크립트. GEMINI_API_KEY 환경변수가 필요하다.
 * 실행: npm run smoke-test -- (proxy 디렉토리에서)
 * 자동 CI 테스트에는 포함하지 않는다 — 실제 과금이 발생하고 결과가 비결정적이기 때문.
 */
const SAMPLE_CASES = [
  {
    review_type: 'TICKET_USE',
    content_text: '시술 후 붓기도 금방 가라앉고 만족스러웠어요',
    photos: [{ url: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c', declared_category: 'GENERAL' }],
  },
  {
    review_type: 'TICKET_USE',
    content_text: 'ㄱㄴㄷㄹㅁ',
    photos: [{ url: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c', declared_category: 'GENERAL' }],
  },
];

async function main() {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const handler = createHandler(client);

  for (const testCase of SAMPLE_CASES) {
    const res = {
      status: (_code: number) => res,
      json: (body: unknown) => {
        console.log(`\n입력: ${testCase.content_text}`);
        console.log('응답:', JSON.stringify(body, null, 2));
        return res;
      },
    };
    await handler({ method: 'POST', body: testCase } as any, res as any);
  }
}

main().catch((err) => {
  console.error('스모크 테스트 실패:', err);
  process.exit(1);
});
