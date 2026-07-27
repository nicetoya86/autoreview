import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseDetailPage } from '../src/parsing/detailParser';

let root: HTMLElement;

const __dirname = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  const html = readFileSync(join(__dirname, './fixtures/detail-page.html'), 'utf-8');
  const dom = new JSDOM(html);
  root = dom.window.document.querySelector('.review-detail') as HTMLElement;
});

describe('parseDetailPage', () => {
  it('기본 필드를 파싱한다', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.review_id).toBe('1001');
    expect(data.review_type).toBe('RECEIPT');
    expect(data.content_text).toBe('시술 후 만족스러웠어요');
    expect(data.modified_at).toBe('2026-07-20 10:00');
  });

  it('브라질리언 제모는 전/후 촬영 예외 시술로 처리한다', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.procedure).toEqual({ name: '브라질리언 제모', is_before_after_exempt: true });
  });

  it('사진을 파싱한다', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.photos).toEqual([{ url: 'https://cdn.example/photo1.jpg', declared_category: 'GENERAL' }]);
  });

  it('영수증 필드는 입력값/등록값이 둘 다 있으면 일치 여부를 계산한다', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.receipt?.hospital_name_matches).toBe(true);
    expect(data.receipt?.date_matches).toBe(true);
  });

  it('등록값이 비어있으면 null(확인 불가)로 처리한다', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.receipt?.amount_matches).toBeNull();
  });

  it('게시중단 요청은 상세 화면에 표시되지 않으므로 항상 false', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.hospital_requested_takedown).toBe(false);
  });
});
