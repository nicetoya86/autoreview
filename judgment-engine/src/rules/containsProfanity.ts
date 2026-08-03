import { check } from 'korcen';

/**
 * 후기 내용에 욕설/비속어가 포함됐는지 판별한다.
 * 자체 규칙을 새로 만들지 않고 korcen(Apache-2.0, 이체자/자모 우회 표기까지 정규화해 판별)에 위임한다.
 */
export function containsProfanity(text: string): boolean {
  return check(text);
}
