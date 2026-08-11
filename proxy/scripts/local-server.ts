import { createServer } from 'node:http';
import judgeContentHandler from '../api/judge-content';
import debugCaptureHandler from '../api/debug-capture';

/**
 * `vercel dev`(로그인 필요) 없이 크롬 확장에서 로컬로 실제 Gemini 호출을 테스트하기 위한 최소 서버.
 * GEMINI_API_KEY, ALLOWED_EXTENSION_ORIGIN 환경변수가 필요하다.
 * 실행: npm run dev:local (proxy 디렉토리에서)
 */
const PORT = Number(process.env.PORT) || 3000;

const ROUTES: Record<string, typeof judgeContentHandler> = {
  '/api/judge-content': judgeContentHandler,
  '/api/debug-capture': debugCaptureHandler,
};

createServer(async (req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} origin=${req.headers.origin ?? '-'}`);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');

  const vercelReq = req as unknown as { method?: string; body?: unknown };
  vercelReq.body = raw ? JSON.parse(raw) : undefined;

  const vercelRes = res as unknown as {
    status: (code: number) => typeof vercelRes;
    json: (body: unknown) => void;
  };
  vercelRes.status = (code: number) => {
    res.statusCode = code;
    return vercelRes;
  };
  vercelRes.json = (body: unknown) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  const route = ROUTES[req.url ?? ''];
  if (!route) {
    res.statusCode = 404;
    res.end();
    return;
  }

  await route(vercelReq as never, vercelRes as never);
}).listen(PORT, () => {
  console.log(`local proxy listening on http://localhost:${PORT}`);
  console.log(`  ${Object.keys(ROUTES).join('\n  ')}`);
});
