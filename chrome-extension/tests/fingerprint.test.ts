import { describe, it, expect } from 'vitest';
import { computeFingerprint } from '../src/shared/fingerprint';

describe('computeFingerprint', () => {
  it('같은 입력이면 항상 같은 지문을 반환한다', () => {
    const input = { content_text: 'hello', photos: [{ url: 'https://x/1.jpg' }], modified_at: '2026-07-20' };
    expect(computeFingerprint(input)).toBe(computeFingerprint({ ...input }));
  });

  it('내용이 바뀌면 지문도 바뀐다', () => {
    const a = computeFingerprint({ content_text: 'hello', photos: [], modified_at: '2026-07-20' });
    const b = computeFingerprint({ content_text: 'world', photos: [], modified_at: '2026-07-20' });
    expect(a).not.toBe(b);
  });

  it('사진 URL이 바뀌면 지문도 바뀐다', () => {
    const a = computeFingerprint({ content_text: 'hello', photos: [{ url: 'https://x/1.jpg' }], modified_at: '2026-07-20' });
    const b = computeFingerprint({ content_text: 'hello', photos: [{ url: 'https://x/2.jpg' }], modified_at: '2026-07-20' });
    expect(a).not.toBe(b);
  });

  it('수정일시가 바뀌면 지문도 바뀐다', () => {
    const a = computeFingerprint({ content_text: 'hello', photos: [], modified_at: '2026-07-20' });
    const b = computeFingerprint({ content_text: 'hello', photos: [], modified_at: '2026-07-21' });
    expect(a).not.toBe(b);
  });
});
