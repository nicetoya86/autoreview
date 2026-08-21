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

  it('전/후 사진 목록에 각 사진의 전후 구분을 표시한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [
      { declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' },
      { declared_category: 'BEFORE_AFTER', before_after_slot: 'AFTER' },
    ]);
    expect(prompt).toContain('1번: 시술 전/후 사진 (전)');
    expect(prompt).toContain('2번: 시술 전/후 사진 (후)');
  });

  it('전 또는 후 중 한쪽 사진만 등록되면 일반 사진으로 유형 변경해서 판정하라는 문구를 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [{ declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' }]);
    expect(prompt).toContain('전/후 중 한쪽 사진만 첨부');
    expect(prompt).toContain('무조건 일반 사진으로 유형 변경');
  });

  it('전/후 사진이 모두 등록되면 한쪽만 등록됐을 때의 안내 문구를 포함하지 않는다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [
      { declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' },
      { declared_category: 'BEFORE_AFTER', before_after_slot: 'AFTER' },
    ]);
    expect(prompt).not.toContain('전/후 중 한쪽 사진만 첨부');
  });

  it('시술 전/후 촬영이 불가능한 예외 시술이면 예외 안내 문구를 포함하고, 한쪽 사진만 등록됐다는 문구는 포함하지 않는다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [{ declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' }], {
      is_before_after_exempt: true,
    });
    expect(prompt).toContain('시술 전/후 촬영이 불가능한 예외 시술');
    expect(prompt).not.toContain('전/후 중 한쪽 사진만 첨부');
  });

  it('예외 시술이 아니면 예외 안내 문구를 포함하지 않는다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [BEFORE_AFTER], { is_before_after_exempt: false });
    expect(prompt).not.toContain('예외 시술로 등록되어 있습니다');
  });

  it('병원명이 주어지면 후기 등록 병원명과 병원 사진 대조 안내를 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL], undefined, '다올림성형외과의원');
    expect(prompt).toContain('후기 등록 병원명: 다올림성형외과의원');
    expect(prompt).toContain('hospital_name_match');
    expect(prompt).toContain('무관한 건물/타병원 사진');
  });

  it('병원명이 없으면 병원 사진 대조 안내를 포함하지 않는다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL]);
    expect(prompt).not.toContain('후기 등록 병원명');
    expect(prompt).not.toContain('hospital_name_match');
  });

  it('병원명 대조 시 병원 유형 접미사 차이는 무시하고 핵심 브랜드명으로 판단하라는 기준을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL], undefined, '루비의원');
    expect(prompt).toContain('"루비의원"과 "루비클리닉"은 일치');
    expect(prompt).toContain('"루비의원"과 "여신의원"은 불일치');
  });

  it('연예인/유명인 사진은 신체 일부가 나와도 보류하라는 기준을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL]);
    expect(prompt).toContain('연예인·인플루언서 등 널리 알려진 제3자 유명인');
  });

  it('사진 품질이 높다는 이유만으로는 보류하지 말라는 기준을 포함한다 (스튜디오컷도 실제 고객 사진일 수 있음)', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL]);
    expect(prompt).toContain('촬영 품질이 높거나 스튜디오 촬영처럼 보인다는 이유만으로는 보류하지 마세요');
  });

  it('시술 부위 확인 목적의 노출은 승인하되 선정적으로 연출되거나 노출 수위가 과도하면 public_order로 보류하라는 기준을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL]);
    expect(prompt).toContain('시술 부위를 보여주기 위한 목적의 노출');
    expect(prompt).toContain('그 자체만으로 미풍양속 위배가 아니며');
    expect(prompt).toContain('성적으로 자극적인 포즈');
    expect(prompt).toContain("flag를 'public_order'로 설정해 보류");
  });

  it('SNS 캡처/일상 사진이라도 신체 일부가 나오면 시술과 무관을 이유로 보류하지 말라는 기준을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL]);
    expect(prompt).toContain('SNS 게시물 캡처');
    expect(prompt).toContain('신체 일부(손, 팔, 얼굴, 몸 등)가 하나라도 식별 가능하게 나온다면');
    expect(prompt).toContain('보류하지 말고 신체 일부 사진으로 승인');
  });

  it('살구색이라는 이유만으로 피부로 단정하지 말고, 질감 없는 흐릿한 단색 면은 identifiable: false로 판단하라는 기준을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL]);
    expect(prompt).toContain('살구색/피부색 톤이라는 이유만으로 곧바로 "피부"라고 단정하지 마세요');
    expect(prompt).toContain('identifiable: false로 판단하세요');
  });

  it('profanityCandidate가 true면 자동 필터 오탐 가능성을 알리고 재확인을 지시하는 문구를 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL], undefined, undefined, true);
    expect(prompt).toContain('자동 필터가 이 후기 내용에 욕설/비속어로 의심되는 패턴이 있다고 표시했습니다');
    expect(prompt).toContain('content_flag를 "profanity"로 설정');
  });

  it('profanityCandidate가 없으면 자동 필터 안내 문구를 포함하지 않는다', () => {
    const prompt = buildPrompt('TICKET_USE', 'text', [GENERAL]);
    expect(prompt).not.toContain('자동 필터가 이 후기 내용에');
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
