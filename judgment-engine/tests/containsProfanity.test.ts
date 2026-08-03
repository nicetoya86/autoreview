import { describe, it, expect } from 'vitest';
import { containsProfanity } from '../src/rules/containsProfanity';

describe('containsProfanity', () => {
  it('욕설이 포함된 텍스트는 true', () => {
    expect(containsProfanity('시발 개짜증나네')).toBe(true);
  });

  it('욕설 없는 정상 후기는 false', () => {
    expect(containsProfanity('시술 후 붓기도 금방 가라앉고 만족스러웠어요')).toBe(false);
  });
});
