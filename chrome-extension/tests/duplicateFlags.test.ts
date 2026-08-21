import { describe, it, expect } from 'vitest';
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

describe('computeListDuplicateFlags', () => {
  it('작성자+병원명+작성일시+이벤트정보+내용+사진이 모두 같은 다른 행이 있으면 중복 플래그를 true로 채운다', () => {
    const target = row({ review_id: 'r1' });
    const other = row({ review_id: 'r2' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_customer).toBe(true);
    expect(flags.same_hospital_name).toBe(true);
    expect(flags.same_written_at).toBe(true);
    expect(flags.same_procedure_event).toBe(true);
    expect(flags.same_content).toBe(true);
    expect(flags.same_photo).toBe(true);
  });

  it('작성 일시가 다르면 나머지가 같아도 중복 아님', () => {
    const target = row({ review_id: 'r1', written_at: '2026-07-20 09:55' });
    const other = row({ review_id: 'r2', written_at: '2026-07-20 09:56' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_written_at).toBe(false);
    expect(flags.same_customer).toBe(false);
  });

  it('이벤트 정보가 다르면 나머지가 같아도 중복 아님', () => {
    const target = row({ review_id: 'r1', event_info: '이벤트A' });
    const other = row({ review_id: 'r2', event_info: '이벤트B' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_procedure_event).toBe(false);
    expect(flags.same_customer).toBe(false);
  });

  it('이벤트 정보가 둘 다 없으면(undefined) 그 조건은 동일하다고 본다', () => {
    const target = row({ review_id: 'r1', event_info: undefined });
    const other = row({ review_id: 'r2', event_info: undefined });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_procedure_event).toBe(true);
    expect(flags.procedure_event_exists).toBe(false);
  });

  it('작성자가 다르면 중복 아님', () => {
    const target = row({ review_id: 'r1', author: '홍**' });
    const other = row({ review_id: 'r2', author: '김**' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_customer).toBe(false);
  });

  it('병원명이 다르면 나머지가 같아도 중복 아님', () => {
    const target = row({ review_id: 'r1', hospital_name: '루비의원' });
    const other = row({ review_id: 'r2', hospital_name: '여신의원' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_hospital_name).toBe(false);
    expect(flags.same_customer).toBe(false);
  });

  it('내용이 다르면 중복 아님', () => {
    const target = row({ review_id: 'r1', content_text: 'A' });
    const other = row({ review_id: 'r2', content_text: 'B' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_content).toBe(false);
  });

  it('자기 자신은 비교 대상에서 제외한다', () => {
    const target = row({ review_id: 'r1' });
    const flags = computeListDuplicateFlags(target, [target]);
    expect(flags.same_customer).toBe(false);
  });

  it('영수증 플래그는 목록 단계에서 항상 false(미확인)', () => {
    const target = row({ review_id: 'r1' });
    const other = row({ review_id: 'r2' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_receipt).toBe(false);
  });
});
