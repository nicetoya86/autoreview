import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderPanel } from '../src/content/detail/renderPanel';
import type { CacheEntry } from '../src/shared/types';

let container: HTMLElement;

function entry(tier: CacheEntry['tier'], resultOverrides: Partial<CacheEntry['result']> = {}): CacheEntry {
  return {
    review_id: 'r1',
    tier,
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: 'r1',
      mock_judgment: 'APPROVE_CANDIDATE',
      matched_rules: ['rule-a'],
      confidence: 0.9,
      reasoning: '근거 요약',
      ai_invoked: true,
      photo_results: [],
      ...resultOverrides,
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

beforeEach(() => {
  const dom = new JSDOM('<div id="panel"></div>');
  container = dom.window.document.getElementById('panel') as HTMLElement;
});

describe('renderPanel', () => {
  it('캐시가 없으면 정밀 판정하기 버튼을 보여준다', () => {
    const onJudge = vi.fn();
    renderPanel(container, null, { onJudge, onFeedback: vi.fn() });

    const button = container.querySelector('.rvw-mock-judge-button') as HTMLElement;
    expect(button?.textContent).toContain('정밀 판정하기');
    button.click();
    expect(onJudge).toHaveBeenCalled();
  });

  it('tier=list 캐시만 있으면 예비 판정 표시와 함께 정밀 판정하기 버튼도 보여준다', () => {
    renderPanel(container, entry('list'), { onJudge: vi.fn(), onFeedback: vi.fn() });
    expect(container.textContent).toContain('예비 판정');
    expect(container.querySelector('.rvw-mock-judge-button')).not.toBeNull();
  });

  it('tier=detail 캐시가 있으면 결과와 함께 "다시 판정하기" 버튼도 보여준다(수동 강제 재호출)', () => {
    const onJudge = vi.fn();
    renderPanel(container, entry('detail'), { onJudge, onFeedback: vi.fn() });
    const button = container.querySelector('.rvw-mock-judge-button') as HTMLElement;
    expect(button?.textContent).toContain('다시 판정하기');
    expect(container.textContent).toContain('rule-a');
    button.click();
    expect(onJudge).toHaveBeenCalled();
  });

  it('자동보류후보/검토필요면 상세 사유(reasoning)를 함께 보여준다', () => {
    renderPanel(container, entry('detail', { mock_judgment: 'AUTO_HOLD_CANDIDATE', reasoning: '보류 상세 사유입니다' }), {
      onJudge: vi.fn(),
      onFeedback: vi.fn(),
    });
    expect(container.textContent).toContain('보류 상세 사유입니다');
  });

  it('승인이어도 사진이 일반으로 유형 변경됐으면 상세 사유를 보여준다', () => {
    renderPanel(
      container,
      entry('detail', { mock_judgment: 'APPROVE_CANDIDATE', reasoning: '사진은 일반 사진으로 유형 변경 후 승인 가능합니다' }),
      { onJudge: vi.fn(), onFeedback: vi.fn() }
    );
    expect(container.textContent).toContain('유형 변경 후 승인 가능');
  });

  it('일반 승인이고 유형 변경도 없으면 상세 사유는 보여주지 않는다', () => {
    renderPanel(container, entry('detail', { mock_judgment: 'APPROVE_CANDIDATE', reasoning: '아주 상세한 근거 텍스트' }), {
      onJudge: vi.fn(),
      onFeedback: vi.fn(),
    });
    expect(container.textContent).not.toContain('아주 상세한 근거 텍스트');
  });

  it('동의/비동의 버튼 클릭 시 onFeedback을 호출한다', () => {
    const onFeedback = vi.fn();
    renderPanel(container, entry('detail'), { onJudge: vi.fn(), onFeedback });

    (container.querySelector('.rvw-mock-feedback-agree') as HTMLElement).click();
    expect(onFeedback).toHaveBeenCalledWith('AGREE');

    (container.querySelector('.rvw-mock-feedback-disagree') as HTMLElement).click();
    expect(onFeedback).toHaveBeenCalledWith('DISAGREE');
  });

  it('다시 렌더링하면 이전 내용을 교체한다', () => {
    renderPanel(container, null, { onJudge: vi.fn(), onFeedback: vi.fn() });
    renderPanel(container, entry('detail'), { onJudge: vi.fn(), onFeedback: vi.fn() });
    expect(container.querySelectorAll('.rvw-mock-panel').length).toBe(1);
  });
});
