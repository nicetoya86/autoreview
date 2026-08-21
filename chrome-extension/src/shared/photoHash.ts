// URL 문자열은 같은 사진을 재업로드해도 CDN이 새 파일명을 발급해서 바뀔 수 있다 —
// 실제 바이트를 해시해 내용이 같은 사진인지 비교한다. 같은 URL을 여러 후기 비교에서
// 반복 조회하는 경우가 많아 프로세스 생존 기간 동안 캐시한다.
const hashCache = new Map<string, Promise<string | null>>();

async function fetchAndHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export function hashPhoto(url: string): Promise<string | null> {
  let cached = hashCache.get(url);
  if (!cached) {
    cached = fetchAndHash(url);
    hashCache.set(url, cached);
  }
  return cached;
}
