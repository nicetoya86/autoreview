import type { CacheEntry } from '../../shared/types';
import type { MockJudgment } from 'judgment-engine';
import { shouldShowReasoning } from '../../shared/judgmentDisplay';

const LABELS: Record<MockJudgment, string> = {
  AUTO_HOLD_CANDIDATE: '🟡 자동보류후보',
  APPROVE_CANDIDATE: '🟢 승인후보',
  NEEDS_REVIEW: '⚪ 검토필요',
};

export function renderBadge(rowEl: HTMLElement, entry: CacheEntry): void {
  rowEl.querySelector('.rvw-mock-badge')?.remove();
  rowEl.querySelector('.rvw-mock-tooltip')?.remove();

  const badge = rowEl.ownerDocument.createElement('span');
  badge.className = 'rvw-mock-badge';
  const tierLabel = entry.tier === 'list' ? ' (예비 판정)' : '';
  badge.textContent = `${LABELS[entry.result.mock_judgment]}${tierLabel}`;

  badge.addEventListener('click', () => {
    rowEl.querySelector('.rvw-mock-tooltip')?.remove();
    const tooltip = rowEl.ownerDocument.createElement('div');
    tooltip.className = 'rvw-mock-tooltip';
    const reasoningPart = shouldShowReasoning(entry.result) ? ` / 상세 사유: ${entry.result.reasoning}` : '';
    tooltip.textContent = `근거: ${entry.result.matched_rules.join(', ') || '없음'} / 신뢰도: ${entry.result.confidence}${reasoningPart}`;
    rowEl.appendChild(tooltip);
  });

  rowEl.appendChild(badge);
}
