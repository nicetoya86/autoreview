import type { CacheEntry } from '../../shared/types';
import type { MockJudgment } from 'judgment-engine';
import { shouldShowReasoning } from '../../shared/judgmentDisplay';

const LABELS: Record<MockJudgment, string> = {
  AUTO_HOLD_CANDIDATE: '🟡 자동보류후보',
  APPROVE_CANDIDATE: '🟢 승인후보',
  NEEDS_REVIEW: '⚪ 검토필요',
};

export interface PanelHandlers {
  onJudge: () => void;
  onFeedback: (feedback: 'AGREE' | 'DISAGREE') => void;
}

export function renderPanel(container: HTMLElement, entry: CacheEntry | null, handlers: PanelHandlers): void {
  container.querySelector('.rvw-mock-panel')?.remove();

  const panel = container.ownerDocument.createElement('div');
  panel.className = 'rvw-mock-panel';

  if (entry) {
    const tierNote = entry.tier === 'list' ? ' (예비 판정 — 목록 기준)' : '';
    const reasoningPart = shouldShowReasoning(entry.result) ? ` / 상세 사유: ${entry.result.reasoning}` : '';
    const summary = container.ownerDocument.createElement('p');
    summary.textContent = `${LABELS[entry.result.mock_judgment]}${tierNote} / 근거: ${entry.result.matched_rules.join(', ') || '없음'} / 신뢰도: ${entry.result.confidence}${reasoningPart}`;
    panel.appendChild(summary);

    const agree = container.ownerDocument.createElement('button');
    agree.className = 'rvw-mock-feedback-agree';
    agree.textContent = '동의';
    agree.addEventListener('click', () => handlers.onFeedback('AGREE'));
    panel.appendChild(agree);

    const disagree = container.ownerDocument.createElement('button');
    disagree.className = 'rvw-mock-feedback-disagree';
    disagree.textContent = '비동의';
    disagree.addEventListener('click', () => handlers.onFeedback('DISAGREE'));
    panel.appendChild(disagree);
  }

  // 재판정 버튼은 항상 보여준다 — tier=detail이어도 사라지면 안 됨(§3.4 "지문이 같아도 강제 재호출" 요구사항).
  const judgeButton = container.ownerDocument.createElement('button');
  judgeButton.className = 'rvw-mock-judge-button';
  judgeButton.textContent = entry?.tier === 'detail' ? '다시 판정하기' : '정밀 판정하기';
  judgeButton.addEventListener('click', handlers.onJudge);
  panel.appendChild(judgeButton);

  container.appendChild(panel);
}
