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
});

describe('buildPrompt - few-shot 예시', () => {
  it('참고 예시 섹션과 각 예시 문장을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', 0);
    expect(prompt).toContain('[참고 예시]');
    expect(prompt).toContain('기대했던 것보다 꼼꼼한 느낌은 아니었어요.');
    expect(prompt).toContain('통증 거의 없었고 직원분들도 친절했어요.');
    expect(prompt).toContain('날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다.');
    expect(prompt).toContain('오늘 점심 뭐 먹지 고민되네요.');
    expect(prompt).toContain('ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ');
  });

  it('예시가 [승인 기준 - 사진] 문구보다 뒤에 온다 (사진 기준은 건드리지 않았음을 확인)', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', 0);
    const photoRuleIndex = prompt.indexOf('[승인 기준 - 사진]');
    const exampleIndex = prompt.indexOf('[참고 예시]');
    expect(photoRuleIndex).toBeGreaterThan(-1);
    expect(exampleIndex).toBeGreaterThan(photoRuleIndex);
  });
});
