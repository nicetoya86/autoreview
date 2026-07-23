const JAMO_ONLY = /^[ㄱ-ㅎㅏ-ㅣ\s]+$/; // 자음/모음만
const REPEATED_CHAR = /(.)\1{4,}/; // 같은 문자 5회 이상 반복
const KNOWN_FILLER_PHRASES = ['가나다라마바사'];

/**
 * PRD 8.2 "의미를 알 수 없는 내용" 1차 규칙 판별.
 * 오탐이 많다고 판단되면(§8 열린 질문) 이 함수를 AI 판단 경로로 옮기는 방향을 검토한다.
 */
export function isMeaninglessText(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 2) return true;
  if (JAMO_ONLY.test(trimmed)) return true;
  if (REPEATED_CHAR.test(trimmed)) return true;
  if (KNOWN_FILLER_PHRASES.includes(trimmed)) return true;

  return false;
}
