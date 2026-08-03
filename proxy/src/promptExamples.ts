export interface PromptExample {
  label: 'APPROVE' | 'HOLD';
  text: string;
  reason: string;
}

/**
 * 실제 고객 후기 원문이 아니라, 관리자 화면에서 관찰한 패턴을 각색한 예시다.
 * 명백한 케이스(순수 잡담, ㄱㄴㄷㄹㅁ류)는 buildPrompt()의 기준 문구가 이미 다루므로,
 * 여기서는 애매한 경계 케이스만 다룬다.
 */
export const TEXT_JUDGMENT_EXAMPLES: PromptExample[] = [
  {
    label: 'APPROVE',
    text: '기대했던 것보다 꼼꼼한 느낌은 아니었어요.',
    reason: '불만이어도 시술 경험에 대한 구체적 내용 — 관련성 있음',
  },
  {
    label: 'APPROVE',
    text: '통증 거의 없었고 직원분들도 친절했어요.',
    reason: '짧아도 시술 경험(통증)과 병원 응대를 구체적으로 언급 — 승인',
  },
  {
    label: 'APPROVE',
    text: '날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다.',
    reason: '잡담이 섞여 있어도 시술 관련 내용이 포함되어 있으면 승인',
  },
  {
    label: 'HOLD',
    text: '오늘 점심 뭐 먹지 고민되네요.',
    reason: '시술과 전혀 무관한 잡담만 있음 — 관련없음으로 보류',
  },
  {
    label: 'HOLD',
    text: 'ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ',
    reason: '의미를 알 수 없는 반복 문자 — 보류',
  },
  {
    label: 'HOLD',
    text: 'ㅈ어ㅣㅏㅈ버ㅓ아ㅣㅁㄴㅇ',
    reason: '자모와 음절이 뒤섞인 의미 없는 텍스트 — 식별 불가로 보류',
  },
  {
    label: 'HOLD',
    text: '제 이름은 김민수예요, 여기 병원 자주 갈 것 같아요.',
    reason: '전화번호/이메일이 없어도 실명이 노출되면 개인정보 문제로 보류',
  },
];
