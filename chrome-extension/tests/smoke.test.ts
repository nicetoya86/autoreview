import { describe, it, expect } from 'vitest';
import { PROXY_URL } from '../src/shared/proxyConfig';

describe('smoke', () => {
  it('shared 모듈이 로드된다', () => {
    expect(PROXY_URL).toBeTruthy();
  });
});
