import type { DuplicateFlags } from 'judgment-engine';
import type { ListRowData } from '../shared/types';

function samePhotoSet(a: ListRowData, b: ListRowData): boolean {
  if (a.photos.length === 0 || b.photos.length === 0) return false;
  const aUrls = a.photos.map((p) => p.url).sort().join(',');
  const bUrls = b.photos.map((p) => p.url).sort().join(',');
  return aUrls === bUrls;
}

/**
 * 현재 페이지에 로드된 행끼리만 비교하는 best-effort 중복 판정 (스펙 §3.1).
 * 영수증 일치 여부는 목록 화면만으로 신뢰성 있게 확인할 수 없어 항상 false(미확인)로
 * 둔다 — 전체 데이터셋 대조는 2차(서버) 범위(스펙 §7).
 */
export function computeListDuplicateFlags(target: ListRowData, others: ListRowData[]): DuplicateFlags {
  const candidates = others.filter((o) => o.review_id !== target.review_id);
  const duplicate = candidates.find(
    (o) =>
      o.author === target.author &&
      target.author !== '' &&
      o.hospital_name === target.hospital_name &&
      !!target.hospital_name &&
      o.written_at === target.written_at &&
      target.written_at !== '' &&
      (o.event_info ?? '') === (target.event_info ?? '') &&
      o.content_text.trim() === target.content_text.trim() &&
      target.content_text.trim() !== '' &&
      samePhotoSet(o, target)
  );

  return {
    same_customer: !!duplicate,
    same_hospital_name: !!duplicate,
    same_written_at: !!duplicate,
    same_procedure_event: !!duplicate,
    procedure_event_exists: !!target.event_info,
    same_content: !!duplicate,
    same_photo: !!duplicate,
    same_receipt: false,
  };
}
