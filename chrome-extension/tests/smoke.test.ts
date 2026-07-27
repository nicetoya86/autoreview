import { describe, it, expect } from 'vitest';
import { BACKGROUND_READY } from '../src/background/index';

describe('smoke', () => {
  it('background 모듈이 로드된다', () => {
    expect(BACKGROUND_READY).toBe(true);
  });
});
