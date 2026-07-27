/**
 * 캐시 무효화용 지문(FNV-1a). 암호학적 안전성은 필요 없고,
 * 동기(sync) 순수 함수여야 background/UI 양쪽에서 간단히 쓸 수 있어
 * crypto.subtle.digest(비동기) 대신 이 방식을 쓴다 (스펙 §3.4).
 */
export function computeFingerprint(input: {
  content_text: string;
  photos: Array<{ url: string }>;
  modified_at: string;
}): string {
  const raw = `${input.content_text}|${input.photos.map((p) => p.url).join(',')}|${input.modified_at}`;

  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
