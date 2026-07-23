import { describe, it, expect } from 'vitest';
import { judgeReview } from '../src/index';

describe('smoke', () => {
  it('exposes the package public entry point', () => {
    expect(typeof judgeReview).toBe('function');
  });
});
