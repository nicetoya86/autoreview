import { runListPageFlow } from './listPageFlow';
import type { ExtensionMessage, ExtensionResponse } from '../../shared/types';

function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message);
}

function insertTriggerButton(table: HTMLTableElement) {
  if (document.querySelector('.rvw-mock-trigger')) return;

  const button = document.createElement('button');
  button.className = 'rvw-mock-trigger';
  button.textContent = '이 페이지 모의판정 실행';
  // 호스트 페이지의 flex/grid 툴바 레이아웃에 눌려 크기가 0이 되거나 가려지는 것을 방지한다.
  button.style.cssText =
    'display:inline-block;position:relative;z-index:2147483647;margin:8px 0;padding:6px 14px;' +
    'font-size:14px;line-height:1.4;cursor:pointer;border:1px solid #999;border-radius:4px;' +
    'background:#fff;color:#111;visibility:visible;opacity:1;width:auto;height:auto;';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = '모의판정 실행 중...';
    runListPageFlow(table, sendMessage)
      .catch((err) => console.error('[모의검수] 판정 중 오류', err))
      .finally(() => {
        button.disabled = false;
        button.textContent = '이 페이지 모의판정 실행';
      });
  });

  table.parentElement?.insertBefore(button, table);
}

const isDetailPage = /^\/posts\/reviews\/detail\//.test(window.location.pathname);

function tryInsert(): boolean {
  const table = document.querySelector('table');
  if (!table) return false;
  insertTriggerButton(table as HTMLTableElement);
  return true;
}

if (!isDetailPage && !tryInsert()) {
  const observer = new MutationObserver(() => {
    if (tryInsert()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
