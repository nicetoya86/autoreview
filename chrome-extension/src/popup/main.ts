import { createCacheStore } from '../background/cache';
import { summarize } from './summarize';

async function render() {
  const cacheStore = createCacheStore(chrome.storage.local);
  const entries = await cacheStore.getAll();
  const summary = summarize(entries);

  const app = document.getElementById('app')!;
  app.innerHTML = `
    <p>오늘까지 판정: ${summary.total_judged}건</p>
    <ul>
      <li>승인후보: ${summary.distribution.APPROVE_CANDIDATE}</li>
      <li>자동보류후보: ${summary.distribution.AUTO_HOLD_CANDIDATE}</li>
      <li>검토필요: ${summary.distribution.NEEDS_REVIEW}</li>
    </ul>
    <p>일치율(검토필요 제외): ${summary.match_rate === null ? '아직 데이터 없음' : `${Math.round(summary.match_rate * 100)}% (${summary.matched}/${summary.matched + summary.mismatched})`}</p>
    <p>최근 불일치: ${summary.recent_mismatches.length}건</p>
  `;
}

render();
