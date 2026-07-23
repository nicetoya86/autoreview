import { describe, it, expect } from 'vitest';
import { isMeaninglessText } from '../src/rules/meaninglessText';

describe('isMeaninglessText', () => {
  it('자모만 나열된 경우 true', () => {
    expect(isMeaninglessText('ㄱㄴㄷㄹㅁ')).toBe(true);
  });

  it('같은 특수문자 반복 true', () => {
    expect(isMeaninglessText('★★★★★★★★★')).toBe(true);
  });

  it('가나다라 순서 나열 true', () => {
    expect(isMeaninglessText('가나다라마바사')).toBe(true);
  });

  it('너무 짧은 텍스트(공백만) true', () => {
    expect(isMeaninglessText('   ')).toBe(true);
  });

  it('시술 관련 정상 후기는 false', () => {
    expect(isMeaninglessText('시술 후 붓기도 금방 가라앉고 만족스러웠어요')).toBe(false);
  });
});
