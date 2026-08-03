import { describe, it, expect } from 'vitest';
import { containsPii } from '../src/rules/containsPii';

describe('containsPii', () => {
  it('하이픈 포함 휴대전화번호 true', () => {
    expect(containsPii('연락처는 010-1234-5678 입니다')).toBe(true);
  });

  it('하이픈 없는 휴대전화번호 true', () => {
    expect(containsPii('01012345678로 연락주세요')).toBe(true);
  });

  it('이메일 주소 true', () => {
    expect(containsPii('문의는 hello@example.com 으로 주세요')).toBe(true);
  });

  it('개인정보 없는 정상 후기는 false', () => {
    expect(containsPii('시술 후 붓기도 금방 가라앉고 만족스러웠어요')).toBe(false);
  });
});
