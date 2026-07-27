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
  button.addEventListener('click', () => {
    button.disabled = true;
    runListPageFlow(table, sendMessage).finally(() => {
      button.disabled = false;
    });
  });

  table.parentElement?.insertBefore(button, table);
}

const table = document.querySelector('table');
if (table) insertTriggerButton(table as HTMLTableElement);
