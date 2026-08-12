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
  it("'시술 후기 내용'만 있으면 그것만 content_text로 읽는다 (기본 필드 파싱)", () => {
    const data = parseDetailPage(root, '1001');
    expect(data.review_id).toBe('1001');
    expect(data.review_type).toBe('RECEIPT');
    expect(data.content_text).toBe('시술 후 만족스러웠어요');
    expect(data.modified_at).toBe('2026-07-20 10:00');
  });

  it("'상담 후기 내용' 라벨도 content_text로 읽는다", () => {
    const dom = new JSDOM(
      '<div class="review-detail">' +
        '<div class="col grid"><div><label class="form-label">후기유형</label></div><div><div class="form-control">상담 후기</div></div></div>' +
        '<div class="flex-1"><div><h4>상담 후기 내용</h4></div><textarea readonly>상담 잘 받았어요</textarea></div>' +
        '</div>'
    );
    const consultRoot = dom.window.document.querySelector('.review-detail') as HTMLElement;
    const data = parseDetailPage(consultRoot, '2001');
    expect(data.review_type).toBe('CONSULTATION');
    expect(data.content_text).toBe('상담 잘 받았어요');
  });

  it("'시술 후기 내용'과 '상담 후기 내용'이 둘 다 있으면 합쳐서 판정 대상으로 삼는다", () => {
    const dom = new JSDOM(
      '<div class="review-detail">' +
        '<div class="col grid"><div><label class="form-label">후기유형</label></div><div><div class="form-control">상담 후기</div></div></div>' +
        '<div class="flex-1"><div><h4>시술 후기 내용</h4></div><textarea readonly>시술 만족</textarea></div>' +
        '<div class="flex-1"><div><h4>상담 후기 내용</h4></div><textarea readonly>상담도 만족</textarea></div>' +
        '</div>'
    );
    const bothRoot = dom.window.document.querySelector('.review-detail') as HTMLElement;
    const data = parseDetailPage(bothRoot, '2002');
    expect(data.content_text).toBe('시술 만족\n상담도 만족');
  });

  it('브라질리언 제모는 전/후 촬영 예외 시술로 처리한다', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.procedure).toEqual({ name: '브라질리언 제모', is_before_after_exempt: true });
  });

  it('사진을 파싱한다 (유사도 검사 위젯 사진은 제외)', () => {
    const data = parseDetailPage(root, '1001');
    expect(data.photos).toEqual([{ url: 'https://cdn.example/photo1.jpg', declared_category: 'GENERAL' }]);
  });

  it("'시술 전'/'시술 후' 그룹으로 나뉜 사진은 각각 BEFORE_AFTER slot으로 파싱한다", () => {
    const dom = new JSDOM(
      '<div class="review-detail">' +
        '<div data-value="photo"><div><p class="font-semibold">후기 사진</p></div>' +
        '<div class="flex flex-col gap-2"><p class="text-base font-semibold">시술 전</p><div><img src="https://cdn.example/before.jpg" /></div></div>' +
        '<div class="flex flex-col gap-2"><p class="text-base font-semibold">시술 후</p><div><img src="https://cdn.example/after.jpg" /></div></div>' +
        '</div></div>'
    );
    const beforeAfterRoot = dom.window.document.querySelector('.review-detail') as HTMLElement;
    const data = parseDetailPage(beforeAfterRoot, '3001');
    expect(data.photos).toEqual([
      { url: 'https://cdn.example/before.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' },
      { url: 'https://cdn.example/after.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'AFTER' },
    ]);
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
