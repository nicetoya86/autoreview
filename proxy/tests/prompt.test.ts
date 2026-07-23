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
