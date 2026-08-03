const PHONE_PATTERN = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * 후기 내용에 전화번호/이메일 같은 식별 가능한 개인정보가 포함됐는지 판별한다.
 * 이름 언급은 정규식으로 신뢰성 있게 판별할 수 없어 AI 판단(few-shot 예시)에 맡긴다.
 */
export function containsPii(text: string): boolean {
  return PHONE_PATTERN.test(text) || EMAIL_PATTERN.test(text);
}
