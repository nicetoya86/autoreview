import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseListPage } from '../src/parsing/listParser';

let table: HTMLTableElement;

beforeAll(() => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(__dirname, './fixtures/list-page.html'), 'utf-8');
  const dom = new JSDOM(html);
  table = dom.window.document.querySelector('table') as HTMLTableElement;
});

describe('parseListPage', () => {
  it('검수 상태와 무관하게 알려진 상태 행을 모두 반환한다', () => {
    const rows = parseListPage(table);
    expect(rows.map((r) => r.review_id)).toEqual(['1001', '1002', '1003']);
  });

  it('전/후 사진은 declared_category BEFORE_AFTER로, 상태가 승인이어도 포함한다', () => {
    const rows = parseListPage(table);
    const row1002 = rows.find((r) => r.review_id === '1002')!;
    expect(row1002.review_status).toBe('승인');
    expect(row1002.review_type).toBe('TICKET_USE');
    expect(row1002.photos).toEqual([
      { url: 'https://cdn.example/photo2-before.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' },
      { url: 'https://cdn.example/photo2-after.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'AFTER' },
    ]);
  });

  it('사진 1장은 GENERAL로 파싱한다', () => {
    const rows = parseListPage(table);
    const row1001 = rows.find((r) => r.review_id === '1001')!;
    expect(row1001.photos).toEqual([{ url: 'https://cdn.example/photo1.jpg', declared_category: 'GENERAL' }]);
  });

  it('후기 유형/상태/작성자/내용을 라벨로 정확히 매핑한다', () => {
    const rows = parseListPage(table);
    const row1001 = rows.find((r) => r.review_id === '1001')!;
    expect(row1001.review_type).toBe('RECEIPT');
    expect(row1001.review_status).toBe('대기');
    expect(row1001.author).toBe('홍**');
    expect(row1001.content_text).toBe('시술 후 만족스러웠어요');
    expect(row1001.written_at).toBe('2026-07-20 09:55');
    expect(row1001.modified_at).toBe('2026-07-20 10:00');
    expect(row1001.hospital_name).toBe('OO병원');
  });

  it('이벤트 정보를 라벨로 매핑하고, 빈 셀은 undefined로 둔다', () => {
    const rows = parseListPage(table);
    expect(rows.find((r) => r.review_id === '1001')!.event_info).toBe('[즉각 탄력] 온다리프팅 60KJ 1회');
    expect(rows.find((r) => r.review_id === '1003')!.event_info).toBeUndefined();
  });

  it('사진이 없는 행도 스킵하지 않고 빈 배열로 파싱한다', () => {
    const rows = parseListPage(table);
    const row1003 = rows.find((r) => r.review_id === '1003')!;
    expect(row1003.photos).toEqual([]);
  });
});
