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

  it('작성 일시는 시간이 달라도 날짜만 같으면 같은 작성일로 보고 중복 처리한다', async () => {
    const earlier = row({ review_id: '1001', written_at: '2026-07-20 09:33' });
    const target = row({ review_id: '1002', written_at: '2026-07-20 23:59' });
    const flags = await computeListDuplicateFlags(target, [earlier]);
    expect(flags.same_written_at).toBe(true);
    expect(flags.same_customer).toBe(true);
  });

  it('작성 일시의 날짜(연월일)가 다르면 나머지가 같아도 중복 아님', async () => {
    const earlier = row({ review_id: '1001', written_at: '2026-07-20 09:33' });
    const target = row({ review_id: '1002', written_at: '2026-07-21 09:33' });
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

  it('3건 이상 연속 재제출 체인 — A-B, B-C가 순서대로 사진이 겹치면(전이적 연결) 셋 다 한 체인으로 보고 가장 이른 건만 승인 유지', async () => {
    mockPhotoContents({
      'https://x/first.jpg': 'shared-ab-bytes',
      'https://x/second-a.jpg': 'shared-ab-bytes',
      'https://x/second-b.jpg': 'shared-bc-bytes',
      'https://x/third.jpg': 'shared-bc-bytes',
    });
    const first = row({ review_id: '1001', photos: [{ url: 'https://x/first.jpg', declared_category: 'GENERAL' }] });
    const second = row({
      review_id: '1002',
      photos: [
        { url: 'https://x/second-a.jpg', declared_category: 'GENERAL' },
        { url: 'https://x/second-b.jpg', declared_category: 'GENERAL' },
      ],
    });
    const third = row({ review_id: '1003', photos: [{ url: 'https://x/third.jpg', declared_category: 'GENERAL' }] });

    const firstFlags = await computeListDuplicateFlags(first, [second, third]);
    const secondFlags = await computeListDuplicateFlags(second, [first, third]);
    const thirdFlags = await computeListDuplicateFlags(third, [first, second]);

    expect(firstFlags.same_customer).toBe(false); // 체인의 최초 건 — 승인 유지
    expect(secondFlags.same_customer).toBe(true); // first와도, third와도 사진이 이어져 같은 체인
    expect(thirdFlags.same_customer).toBe(true);
  });

  it('필드는 그룹 전체가 같아도 사진으로 실제 연결된 쌍끼리만 별도 체인으로 나눈다 — 서로 사진이 안 겹치는 두 쌍이 섞여 있으면 각 쌍에서 이른 건만 승인 유지', async () => {
    mockPhotoContents({
      'https://x/pair-a-1.jpg': 'pair-a-bytes',
      'https://x/pair-a-2.jpg': 'pair-a-bytes',
      'https://x/pair-b-1.jpg': 'pair-b-bytes',
      'https://x/pair-b-2.jpg': 'pair-b-bytes',
    });
    const pairAEarly = row({ review_id: '1001', photos: [{ url: 'https://x/pair-a-1.jpg', declared_category: 'GENERAL' }] });
    const pairALate = row({ review_id: '1002', photos: [{ url: 'https://x/pair-a-2.jpg', declared_category: 'GENERAL' }] });
    const pairBEarly = row({ review_id: '1003', photos: [{ url: 'https://x/pair-b-1.jpg', declared_category: 'GENERAL' }] });
    const pairBLate = row({ review_id: '1004', photos: [{ url: 'https://x/pair-b-2.jpg', declared_category: 'GENERAL' }] });
    const all = [pairAEarly, pairALate, pairBEarly, pairBLate];
    const others = (target: ListRowData) => all.filter((r) => r !== target);

    expect((await computeListDuplicateFlags(pairAEarly, others(pairAEarly))).same_customer).toBe(false); // pair A 원본
    expect((await computeListDuplicateFlags(pairALate, others(pairALate))).same_customer).toBe(true);
    expect((await computeListDuplicateFlags(pairBEarly, others(pairBEarly))).same_customer).toBe(false); // pair B 원본 — pair A와 무관하게 별도로 승인 유지
    expect((await computeListDuplicateFlags(pairBLate, others(pairBLate))).same_customer).toBe(true);
  });

  it('필드는 같아도 그룹 전체에 사진이 겹치는 쌍이 하나도 없으면(별개 방문) 아무도 중복으로 보지 않는다', async () => {
    mockPhotoContents({
      'https://x/visit-a.jpg': 'visit-a-bytes',
      'https://x/visit-b.jpg': 'visit-b-bytes',
    });
    const earlier = row({ review_id: '1001', photos: [{ url: 'https://x/visit-a.jpg', declared_category: 'GENERAL' }] });
    const later = row({ review_id: '1002', photos: [{ url: 'https://x/visit-b.jpg', declared_category: 'GENERAL' }] });

    const laterFlags = await computeListDuplicateFlags(later, [earlier]);
    expect(laterFlags.same_customer).toBe(false);
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
