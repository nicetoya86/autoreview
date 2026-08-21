import type { DuplicateFlags } from 'judgment-engine';
import type { ListRowData } from '../shared/types';
import { hashPhoto } from '../shared/photoHash';

function nonPhotoFieldsMatch(a: ListRowData, b: ListRowData): boolean {
  return (
    a.author === b.author &&
    b.author !== '' &&
    a.hospital_name === b.hospital_name &&
    !!b.hospital_name &&
    a.written_at === b.written_at &&
    b.written_at !== '' &&
    (a.event_info ?? '') === (b.event_info ?? '') &&
    a.content_text.trim() === b.content_text.trim() &&
    b.content_text.trim() !== ''
  );
}

/**
 * URL이 아니라 실제 이미지 바이트를 해시해 비교한다 — 같은 사진을 재업로드해도
 * CDN 파일명(URL)이 바뀌는 경우가 실측에서 확인돼(같은 사진, 다른 URL) URL 비교로는
 * 이런 재업로드 중복을 잡지 못했다. 해시를 못 구한 사진(fetch 실패 등)이 있으면
 * 보수적으로 다른 사진으로 취급한다.
 */
async function samePhotoSet(a: ListRowData, b: ListRowData): Promise<boolean> {
  if (a.photos.length === 0 || b.photos.length === 0 || a.photos.length !== b.photos.length) return false;
  const [aHashes, bHashes] = await Promise.all([
    Promise.all(a.photos.map((p) => hashPhoto(p.url))),
    Promise.all(b.photos.map((p) => hashPhoto(p.url))),
  ]);
  if (aHashes.some((h) => h === null) || bHashes.some((h) => h === null)) return false;
  return aHashes.slice().sort().join(',') === bHashes.slice().sort().join(',');
}

/**
 * 현재 페이지에 로드된 행끼리만 비교하는 best-effort 중복 판정 (스펙 §3.1).
 * 영수증 일치 여부는 목록 화면만으로 신뢰성 있게 확인할 수 없어 항상 false(미확인)로
 * 둔다 — 전체 데이터셋 대조는 2차(서버) 범위(스펙 §7).
 */
export async function computeListDuplicateFlags(target: ListRowData, others: ListRowData[]): Promise<DuplicateFlags> {
  // 사진 해시 비교는 fetch가 필요해 비싸므로, 다른 필드가 전부 같은 후보로 먼저 좁힌 뒤에만 수행한다.
  const fieldCandidates = others.filter((o) => o.review_id !== target.review_id && nonPhotoFieldsMatch(o, target));

  let duplicate: ListRowData | undefined;
  for (const candidate of fieldCandidates) {
    if (await samePhotoSet(candidate, target)) {
      duplicate = candidate;
      break;
    }
  }

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
