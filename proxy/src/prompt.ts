import { TEXT_JUDGMENT_EXAMPLES } from './promptExamples';

/**
 * PRD §8.2(후기 내용/사진 기준)를 그대로 지시문으로 포함해,
 * 모델이 정책 문서 기준으로만 판단하게 한다 (스펙 §5.1).
 */
export function buildPrompt(reviewType: string, contentText: string, photoCount: number): string {
  const examplesSection = TEXT_JUDGMENT_EXAMPLES.map(
    (e) => `- "${e.text}" → ${e.label === 'APPROVE' ? '승인' : '보류'} (${e.reason})`
  ).join('\n');

  return `당신은 후기 검수 담당자를 돕는 판정 보조자입니다. 아래 정책 기준으로만 판단하세요.

[승인 기준 - 후기 내용] 시술과 관련된 내용이면 승인. 의미를 알 수 없는 내용(예: ㄱㄴㄷㄹㅁ, 가나다라마바사, ★★★★★★★★★)이거나 사회 공공질서/미풍양속에 위배되면 보류.

[후기 내용 판정 참고 예시]
${examplesSection}

[승인 기준 - 사진] 시술 부위/신체 일부, 시술 관련 장비·약품, 병원 내외부, 앱 결제 화면, 관련 캡쳐 화면은 승인. 식별 불가하거나 미풍양속에 위배되거나 시술과 무관하면 보류.

후기 유형: ${reviewType}
후기 내용: ${contentText}
등록된 사진 수: ${photoCount}장 (아래 이미지 순서와 photos 배열 순서가 동일합니다)

각 사진과 후기 내용을 위 기준으로 개별 판단해 지정된 JSON 스키마 형식으로 결과를 제출하세요.`;
}
