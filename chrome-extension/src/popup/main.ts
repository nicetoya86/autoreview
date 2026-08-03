import { createCacheStore } from '../background/cache';
import { summarize } from './summarize';
import './style.css';

async function render() {
  const cacheStore = createCacheStore(chrome.storage.local);
  const entries = await cacheStore.getAll();
  const summary = summarize(entries);

  const content = document.getElementById('content')!;
  content.innerHTML = `
    <p class="total">오늘까지 판정: <strong>${summary.total_judged}건</strong></p>
    <ul class="distribution">
      <li><span>승인후보</span><span class="value">${summary.distribution.APPROVE_CANDIDATE}</span></li>
      <li><span>자동보류후보</span><span class="value">${summary.distribution.AUTO_HOLD_CANDIDATE}</span></li>
      <li><span>검토필요</span><span class="value">${summary.distribution.NEEDS_REVIEW}</span></li>
    </ul>
    <p class="match-rate">일치율(검토필요 제외): ${summary.match_rate === null ? '아직 데이터 없음' : `${Math.round(summary.match_rate * 100)}% (${summary.matched}/${summary.matched + summary.mismatched})`}</p>
    <p class="mismatches">최근 불일치: ${summary.recent_mismatches.length}건</p>
  `;
}

document.getElementById('close-btn')!.addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) chrome.windows.remove(win.id);
});

render();
