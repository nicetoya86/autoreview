import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/prompt';

const GENERAL = { declared_category: 'GENERAL' };
const BEFORE_AFTER = { declared_category: 'BEFORE_AFTER' };

describe('buildPrompt', () => {
  it('후기 유형, 내용, 사진 목록을 프롬프트에 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '시술 후 만족스러웠어요', [GENERAL, GENERAL]);
    expect(prompt).toContain('TICKET_USE');
    expect(prompt).toContain('시술 후 만족스러웠어요');
    expect(prompt).toContain('1번: 일반 사진');
    expect(prompt).toContain('2번: 일반 사진');
  });

  it('사진이 없으면 목록에 등록된 사진 없음이라고 표시한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', []);
    expect(prompt).toContain('(등록된 사진 없음)');
  });

  it('시술 전/후 사진은 목록에 그렇게 표시한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [BEFORE_AFTER, GENERAL]);
    expect(prompt).toContain('1번: 시술 전/후 사진');
    expect(prompt).toContain('2번: 일반 사진');
  });

  it('시술 전/후 사진 유형 변경 안내 문구를 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [BEFORE_AFTER]);
    expect(prompt).toContain('유형 변경 후 승인 가능');
    expect(prompt).toContain('격상 판단하지 마세요');
  });

  it('승인/보류 기준 문구를 포함한다', () => {
    const prompt = buildPrompt('RECEIPT', 'text', [GENERAL]);
    expect(prompt).toContain('미풍양속');
    expect(prompt).toContain('식별');
  });

  it('개인정보/욕설·선정적 표현 보류 기준 문구를 포함한다', () => {
    const prompt = buildPrompt('RECEIPT', 'text', [GENERAL]);
    expect(prompt).toContain('개인정보');
    expect(prompt).toContain('전화번호');
    expect(prompt).toContain('욕설');
  });

  it('사진 승인 기준에 개인정보·민감정보 노출 시 보류 문구를 포함한다', () => {
    const prompt = buildPrompt('RECEIPT', 'text', [GENERAL]);
    const photoRuleIndex = prompt.indexOf('[승인 기준 - 사진]');
    const photoRuleLine = prompt.slice(photoRuleIndex, prompt.indexOf('\n', photoRuleIndex));
    expect(photoRuleLine).toContain('이름·휴대전화번호·이메일 주소 등 개인정보·민감정보가 노출되면 보류');
  });
});

describe('buildPrompt - few-shot 예시', () => {
  it('참고 예시 섹션과 각 예시 문장을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', []);
    expect(prompt).toContain('[후기 내용 판정 참고 예시]');
    expect(prompt).toContain('기대했던 것보다 꼼꼼한 느낌은 아니었어요.');
    expect(prompt).toContain('통증 거의 없었고 직원분들도 친절했어요.');
    expect(prompt).toContain('날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다.');
    expect(prompt).toContain('오늘 점심 뭐 먹지 고민되네요.');
    expect(prompt).toContain('ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ');
    expect(prompt).toContain('ㅈ어ㅣㅏㅈ버ㅓ아ㅣㅁㄴㅇ');
    expect(prompt).toContain('제 이름은 김민수예요, 여기 병원 자주 갈 것 같아요.');
    expect(prompt).toContain(
      '피부 고민에 도움되셨나요? 상담은 충분했는지, 시술 후 통증, 시술시간, 다운타임, 병원의 인상 등 도움되는 생생한 후기를 들려주세요.'
    );
    expect(prompt).toContain('여신티켓은 고객님의 개인정보를 안전하게 취급하는데 최선을 다합니다.');
  });

  it('각 예시가 올바른 승인/보류 라벨과 짝지어 렌더링된다 (라벨 스왑 회귀 방지)', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', []);
    expect(prompt).toContain('- "기대했던 것보다 꼼꼼한 느낌은 아니었어요." → 승인');
    expect(prompt).toContain('- "통증 거의 없었고 직원분들도 친절했어요." → 승인');
    expect(prompt).toContain('- "날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다." → 승인');
    expect(prompt).toContain('- "오늘 점심 뭐 먹지 고민되네요." → 보류');
    expect(prompt).toContain('- "ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ" → 보류');
    expect(prompt).toContain('- "ㅈ어ㅣㅏㅈ버ㅓ아ㅣㅁㄴㅇ" → 보류');
    expect(prompt).toContain('- "제 이름은 김민수예요, 여기 병원 자주 갈 것 같아요." → 보류');
    expect(prompt).toContain(
      '- "피부 고민에 도움되셨나요? 상담은 충분했는지, 시술 후 통증, 시술시간, 다운타임, 병원의 인상 등 도움되는 생생한 후기를 들려주세요." → 보류'
    );
    expect(prompt).toContain(
      '- "여신티켓은 고객님의 개인정보를 안전하게 취급하는데 최선을 다합니다. 예약 및 상담 관리를 위해 아래 업체에 개인정보가 제공됩니다." → 보류'
    );
  });

  it('예시 섹션이 [승인 기준 - 후기 내용] 바로 다음, [승인 기준 - 사진]보다 앞에 온다 (사진 판정에 텍스트 예시가 섞이지 않도록)', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', []);
    const contentRuleIndex = prompt.indexOf('[승인 기준 - 후기 내용]');
    const exampleIndex = prompt.indexOf('[후기 내용 판정 참고 예시]');
    const photoRuleIndex = prompt.indexOf('[승인 기준 - 사진]');
    expect(contentRuleIndex).toBeGreaterThan(-1);
    expect(exampleIndex).toBeGreaterThan(contentRuleIndex);
    expect(photoRuleIndex).toBeGreaterThan(exampleIndex);
    expect(prompt).toContain('시술 부위/신체 일부, 시술 관련 장비·약품, 병원 내외부, 앱 결제 화면, 관련 캡쳐 화면은 승인');
  });

  it('"병원 내외부" 승인은 배너/병원명/의료기기/약품/파우더룸/팜플렛/의료진 중 하나 이상 필요하다는 기준을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', []);
    expect(prompt).toContain('시술 배너, 병원명(간판/로고), 의료기기, 약품, 파우더룸, 시술 관련 팜플렛/안내문, 의료진(의사·간호사 등)');
    expect(prompt).toContain('병원인지 특정할 수 없는 공간만 나온 사진은 시술과 무관한 것으로 보고 보류');
  });

  it('리셉션/데스크만으로는 승인되지 않는다는 기준을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', []);
    expect(prompt).toContain('리셉션 데스크나 대기실 소파처럼 그 자체만으로는 병원 여부를 특정할 수 없는 공간도 위 요소가 함께 나오지 않으면 보류');
  });
});
