import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/prompt';

describe('buildPrompt', () => {
  it('후기 유형, 내용, 사진 수를 프롬프트에 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '시술 후 만족스러웠어요', 2);
    expect(prompt).toContain('TICKET_USE');
    expect(prompt).toContain('시술 후 만족스러웠어요');
    expect(prompt).toContain('2장');
  });

  it('승인/보류 기준 문구를 포함한다', () => {
    const prompt = buildPrompt('RECEIPT', 'text', 1);
    expect(prompt).toContain('미풍양속');
    expect(prompt).toContain('식별');
  });

  it('개인정보/욕설·선정적 표현 보류 기준 문구를 포함한다', () => {
    const prompt = buildPrompt('RECEIPT', 'text', 1);
    expect(prompt).toContain('개인정보');
    expect(prompt).toContain('전화번호');
    expect(prompt).toContain('욕설');
  });
});

describe('buildPrompt - few-shot 예시', () => {
  it('참고 예시 섹션과 각 예시 문장을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', 0);
    expect(prompt).toContain('[후기 내용 판정 참고 예시]');
    expect(prompt).toContain('기대했던 것보다 꼼꼼한 느낌은 아니었어요.');
    expect(prompt).toContain('통증 거의 없었고 직원분들도 친절했어요.');
    expect(prompt).toContain('날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다.');
    expect(prompt).toContain('오늘 점심 뭐 먹지 고민되네요.');
    expect(prompt).toContain('ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ');
    expect(prompt).toContain('ㅈ어ㅣㅏㅈ버ㅓ아ㅣㅁㄴㅇ');
    expect(prompt).toContain('제 이름은 김민수예요, 여기 병원 자주 갈 것 같아요.');
  });

  it('각 예시가 올바른 승인/보류 라벨과 짝지어 렌더링된다 (라벨 스왑 회귀 방지)', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', 0);
    expect(prompt).toContain('- "기대했던 것보다 꼼꼼한 느낌은 아니었어요." → 승인');
    expect(prompt).toContain('- "통증 거의 없었고 직원분들도 친절했어요." → 승인');
    expect(prompt).toContain('- "날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다." → 승인');
    expect(prompt).toContain('- "오늘 점심 뭐 먹지 고민되네요." → 보류');
    expect(prompt).toContain('- "ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ" → 보류');
    expect(prompt).toContain('- "ㅈ어ㅣㅏㅈ버ㅓ아ㅣㅁㄴㅇ" → 보류');
    expect(prompt).toContain('- "제 이름은 김민수예요, 여기 병원 자주 갈 것 같아요." → 보류');
  });

  it('예시 섹션이 [승인 기준 - 후기 내용] 바로 다음, [승인 기준 - 사진]보다 앞에 온다 (사진 판정에 텍스트 예시가 섞이지 않도록)', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', 0);
    const contentRuleIndex = prompt.indexOf('[승인 기준 - 후기 내용]');
    const exampleIndex = prompt.indexOf('[후기 내용 판정 참고 예시]');
    const photoRuleIndex = prompt.indexOf('[승인 기준 - 사진]');
    expect(contentRuleIndex).toBeGreaterThan(-1);
    expect(exampleIndex).toBeGreaterThan(contentRuleIndex);
    expect(photoRuleIndex).toBeGreaterThan(exampleIndex);
    expect(prompt).toContain('시술 부위/신체 일부, 시술 관련 장비·약품, 병원 내외부, 앱 결제 화면, 관련 캡쳐 화면은 승인');
  });
});
