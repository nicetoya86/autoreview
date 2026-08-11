import { check } from 'korcen';

/**
 * 후기 내용에 욕설/비속어가 포함됐는지 판별한다.
 * 자체 규칙을 새로 만들지 않고 korcen(Apache-2.0, 이체자/자모 우회 표기까지 정규화해 판별)에 위임한다.
 *
 * korcen이 흔한 "^^" 이모티콘을 비속어로 오판정하는 버그가 있어(예: "친절하셔요 ^^" → true),
 * 판정 전에 캐럿(^)을 걷어낸다. "^" 단독은 원래도 정상 텍스트로 판정되므로 실제 욕설 탐지에는 영향 없다.
 */
export function containsProfanity(text: string): boolean {
  return check(text.replace(/\^/g, ''));
}
