import { describe, it, expect } from 'vitest';
import { containsProfanity } from '../src/rules/containsProfanity';

describe('containsProfanity', () => {
  it('욕설이 포함된 텍스트는 true', () => {
    expect(containsProfanity('시발 개짜증나네')).toBe(true);
  });

  it('욕설 없는 정상 후기는 false', () => {
    expect(containsProfanity('시술 후 붓기도 금방 가라앉고 만족스러웠어요')).toBe(false);
  });

  it('"^^" 이모티콘이 있어도 오탐하지 않는다 (korcen 버그 우회)', () => {
    expect(containsProfanity('추가 결제 했습니다 ^^ 다들 친절하셔요')).toBe(false);
  });

  it("korcen 자체의 근사매칭 오탐 사례: '새로운 지점이'처럼 욕설이 없는 정상 문장도 true를 반환한다", () => {
    // 실측(리뷰 1157066)에서 확인된 오탐. engine.ts는 이 결과를 바로 확정하지 않고
    // AI에게 재확인시켜 최종 판단을 내리므로(2단계 검증), 이 함수 자체의 오탐은
    // 감내하되 우회 처리는 하지 않는다 — 우회를 늘릴수록 유지보수 비용만 커진다.
    expect(containsProfanity('새로운 지점이 생겼다고 해서 방문했습니다')).toBe(true);
  });
});
