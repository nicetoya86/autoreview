import { describe, it, expect } from 'vitest';
import { PROXY_URL } from '../src/shared/proxyConfig';

describe('PROXY_URL', () => {
  it('judge-content 엔드포인트를 가리킨다', () => {
    expect(PROXY_URL).toMatch(/\/api\/judge-content$/);
  });
});
