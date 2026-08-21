import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { computeListDuplicateFlags } from '../src/parsing/duplicateFlags';
import type { ListRowData } from '../src/shared/types';

function row(overrides: Partial<ListRowData>): ListRowData {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '만족스러웠어요',
    photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
    hospital_name: '루비의원',
    event_info: '[즉각 탄력] 온다리프팅 60KJ 1회',
    review_status: '대기',
    written_at: '2026-07-20 09:55',
    modified_at: '2026-07-20 10:00',
    author: '홍**',
    ...overrides,
  };
}

// URL별로 원하는 "사진 내용"을 지정해 fetch를 모킹한다 — 같은 content를 준 URL은
// 같은 해시가 나오고, 다른 content를 준 URL은 다른 해시가 나온다.
function mockPhotoContents(contentByUrl: Record<string, string>) {
  global.fetch = vi.fn(async (url: unknown) => {
    const content = contentByUrl[url as string];
    if (content === undefined) return { ok: false } as Response;
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(content).buffer } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockPhotoContents({ 'https://x/1.jpg': 'same-photo-bytes' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeListDuplicateFlags', () => {
  // review_id '1001'(먼저 등록) / '1002'(나중에 등록) — 나중 것만 보류 대상이 되어야 한다.
  it('작성자+병원명+작성일시+이벤트정보+내용+사진이 모두 같은 더 이른 후기가 있으면(나중에 등록된 쪽) 중복 플래그를 true로 채운다', async () => {
    const earlier = row({ review_id: '1001' });
    const target = row({ review_id: '1002' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_customer).toBe(true);
    expect(flags.same_hospital_name).toBe(true);
    expect(flags.same_written_at).toBe(true);
    expect(flags.same_procedure_event).toBe(true);
    expect(flags.same_content).toBe(true);
    expect(flags.same_photo).toBe(true);
  });

  it('더 먼저 등록된 후기(review_id가 더 작음) 쪽은 나중에 등록된 중복이 있어도 플래그가 false다 (원본은 승인 유지)', async () => {
    const target = row({ review_id: '1001' });
    const later = row({ review_id: '1002' });
    const flags = await computeListDuplicateFlags(target, [later]);
    expect(flags.same_customer).toBe(false);
    expect(flags.same_photo).toBe(false);
  });

  it('사진 URL이 재업로드로 달라도 실제 바이트가 같으면 중복으로 본다', async () => {
    mockPhotoContents({
      'https://x/reupload-a.jpg': 'reupload-bytes',
      'https://x/reupload-b.jpg': 'reupload-bytes',
    });
    const earlier = row({ review_id: '1001', photos: [{ url: 'https://x/reupload-a.jpg', declared_category: 'GENERAL' }] });
    const target = row({ review_id: '1002', photos: [{ url: 'https://x/reupload-b.jpg', declared_category: 'GENERAL' }] });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_photo).toBe(true);
  });

  it('사진 바이트가 실제로 다르면(구도/줌 다른 사진) 중복 아님', async () => {
    mockPhotoContents({
      'https://x/diff-a.jpg': 'photo-a-bytes',
      'https://x/diff-b.jpg': 'photo-b-bytes',
    });
    const earlier = row({ review_id: '1001', photos: [{ url: 'https://x/diff-a.jpg', declared_category: 'GENERAL' }] });
    const target = row({ review_id: '1002', photos: [{ url: 'https://x/diff-b.jpg', declared_category: 'GENERAL' }] });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_photo).toBe(false);
    expect(flags.same_customer).toBe(false);
  });

  it('사진 두 장 중 한 장만 바이트까지 같아도(전 사진 재사용, 후 사진만 다름) 중복으로 본다', async () => {
    mockPhotoContents({
      'https://x/before-shared.jpg': 'before-bytes',
      'https://x/after-1.jpg': 'after-bytes-1',
      'https://x/after-2.jpg': 'after-bytes-2',
    });
    const earlier = row({
      review_id: '1001',
      photos: [
        { url: 'https://x/before-shared.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' },
        { url: 'https://x/after-1.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'AFTER' },
      ],
    });
    const target = row({
      review_id: '1002',
      photos: [
        { url: 'https://x/before-shared.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'BEFORE' },
        { url: 'https://x/after-2.jpg', declared_category: 'BEFORE_AFTER', before_after_slot: 'AFTER' },
      ],
    });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_photo).toBe(true);
  });

  it('사진 fetch가 실패하면 보수적으로 다른 사진으로 취급한다', async () => {
    const earlier = row({ review_id: '1001', photos: [{ url: 'https://x/fail-a.jpg', declared_category: 'GENERAL' }] });
    const target = row({ review_id: '1002', photos: [{ url: 'https://x/fail-b.jpg', declared_category: 'GENERAL' }] });
    global.fetch = vi.fn(async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_photo).toBe(false);
  });

  it('작성 일시가 몇 분 이내로만 다르면(연속 등록 묶음) 같은 시점으로 보고 중복 처리한다', async () => {
    const earlier = row({ review_id: '1001', written_at: '2026-07-20 09:33' });
    const target = row({ review_id: '1002', written_at: '2026-07-20 09:34' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_written_at).toBe(true);
    expect(flags.same_customer).toBe(true);
  });

  it('작성 일시가 허용 범위(5분)를 넘게 다르면 나머지가 같아도 중복 아님', async () => {
    const earlier = row({ review_id: '1001', written_at: '2026-07-20 09:00' });
    const target = row({ review_id: '1002', written_at: '2026-07-20 09:10' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_written_at).toBe(false);
    expect(flags.same_customer).toBe(false);
  });

  it('작성 일시 형식을 못 읽으면 완전일치로 되돌아간다', async () => {
    const earlier = row({ review_id: '1001', written_at: '알수없음' });
    const target = row({ review_id: '1002', written_at: '알수없음' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_written_at).toBe(true);
  });

  it('이벤트 정보가 다르면 나머지가 같아도 중복 아님', async () => {
    const earlier = row({ review_id: '1001', event_info: '이벤트A' });
    const target = row({ review_id: '1002', event_info: '이벤트B' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_procedure_event).toBe(false);
    expect(flags.same_customer).toBe(false);
  });

  it('이벤트 정보가 둘 다 없으면(undefined) 그 조건은 동일하다고 본다', async () => {
    const earlier = row({ review_id: '1001', event_info: undefined });
    const target = row({ review_id: '1002', event_info: undefined });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_procedure_event).toBe(true);
    expect(flags.procedure_event_exists).toBe(false);
  });

  it('작성자가 다르면 중복 아님', async () => {
    const earlier = row({ review_id: '1001', author: '김**' });
    const target = row({ review_id: '1002', author: '홍**' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_customer).toBe(false);
  });

  it('병원명이 다르면 나머지가 같아도 중복 아님', async () => {
    const earlier = row({ review_id: '1001', hospital_name: '여신의원' });
    const target = row({ review_id: '1002', hospital_name: '루비의원' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_hospital_name).toBe(false);
    expect(flags.same_customer).toBe(false);
  });

  it('내용이 다르면 중복 아님', async () => {
    const earlier = row({ review_id: '1001', content_text: 'A' });
    const target = row({ review_id: '1002', content_text: 'B' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_content).toBe(false);
  });

  it('자기 자신은 비교 대상에서 제외한다', async () => {
    const target = row({ review_id: 'r1' });
    const flags = await computeListDuplicateFlags(target, [target]);
    expect(flags.same_customer).toBe(false);
  });

  it('영수증 플래그는 목록 단계에서 항상 false(미확인)', async () => {
    const earlier = row({ review_id: '1001' });
    const target = row({ review_id: '1002' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_receipt).toBe(false);
  });
});
