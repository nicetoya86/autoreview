import { describe, it, expect, beforeEach } from 'vitest';
import { renderBadge } from '../src/content/list/renderBadge';
import type { CacheEntry } from '../src/shared/types';

let rowEl: HTMLElement;

function entry(overrides: Partial<CacheEntry['result']> = {}): CacheEntry {
  return {
    review_id: 'r1',
    tier: 'list',
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_hospital_name: false,
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
      ...overrides,
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

beforeEach(() => {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.textContent = '1';
  tr.appendChild(td);
  rowEl = tr;
});

describe('renderBadge', () => {
  it('rvw-mock- 접두사가 붙은 배지 요소를 행에 추가한다', () => {
    renderBadge(rowEl, entry());
    const badge = rowEl.querySelector('.rvw-mock-badge');
    expect(badge).not.toBeNull();
  });

  it('판정별 라벨 텍스트를 표시한다', () => {
    renderBadge(rowEl, entry({ mock_judgment: 'AUTO_HOLD_CANDIDATE' }));
    expect(rowEl.querySelector('.rvw-mock-badge')?.textContent).toContain('자동보류후보');
  });

  it('예비 판정(tier=list)은 라벨을 추가로 표시한다', () => {
    renderBadge(rowEl, entry());
    expect(rowEl.querySelector('.rvw-mock-badge')?.textContent).toContain('예비 판정');
  });

  it('같은 행에 다시 렌더링하면 기존 배지를 교체한다(중복 삽입 방지)', () => {
    renderBadge(rowEl, entry());
    renderBadge(rowEl, entry());
    expect(rowEl.querySelectorAll('.rvw-mock-badge').length).toBe(1);
  });

  it('클릭하면 matched_rules/confidence 툴팁을 보여준다', () => {
    renderBadge(rowEl, entry());
    const badge = rowEl.querySelector('.rvw-mock-badge') as HTMLElement;
    badge.click();
    const tooltip = rowEl.querySelector('.rvw-mock-tooltip');
    expect(tooltip?.textContent).toContain('rule-a');
    expect(tooltip?.textContent).toContain('0.9');
  });

  it('자동보류후보/검토필요면 툴팁에 상세 사유(reasoning)도 보여준다', () => {
    renderBadge(rowEl, entry({ mock_judgment: 'NEEDS_REVIEW', reasoning: '검토필요 상세 사유입니다' }));
    (rowEl.querySelector('.rvw-mock-badge') as HTMLElement).click();
    expect(rowEl.querySelector('.rvw-mock-tooltip')?.textContent).toContain('검토필요 상세 사유입니다');
  });

  it('승인이어도 사진이 일반으로 유형 변경됐으면 상세 사유를 보여준다', () => {
    renderBadge(
      rowEl,
      entry({ mock_judgment: 'APPROVE_CANDIDATE', reasoning: '사진은 일반 사진으로 유형 변경 후 승인 가능합니다' })
    );
    (rowEl.querySelector('.rvw-mock-badge') as HTMLElement).click();
    expect(rowEl.querySelector('.rvw-mock-tooltip')?.textContent).toContain('유형 변경 후 승인 가능');
  });

  it('일반 승인이고 유형 변경도 없으면 상세 사유는 보여주지 않는다', () => {
    renderBadge(rowEl, entry({ mock_judgment: 'APPROVE_CANDIDATE', reasoning: '아주 상세한 근거 텍스트' }));
    (rowEl.querySelector('.rvw-mock-badge') as HTMLElement).click();
    expect(rowEl.querySelector('.rvw-mock-tooltip')?.textContent).not.toContain('아주 상세한 근거 텍스트');
  });
});
