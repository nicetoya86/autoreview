import type { DuplicateFlags } from 'judgment-engine';
import type { ListRowData } from '../shared/types';
import { hashPhoto } from '../shared/photoHash';

// 중복 그룹 내에서 어느 후기를 "원본(승인 유지)"으로 볼지 정해야 한다 — PRD 8.4는
// 중복이면 1건만 승인, 나머지는 보류라고 규정한다. written_at은 중복 판정 조건에
// 이미 포함돼 그룹 내에서 전부 같으므로 순서를 가릴 수 없어, review_id가 작을수록
// 먼저 등록된 후기라고 보고 그 후기만 남기고 review_id가 더 큰(나중에 등록된) 후기만
// 보류 대상으로 삼는다.
function isEarlier(reviewIdA: string, reviewIdB: string): boolean {
  const a = Number(reviewIdA);
  const b = Number(reviewIdB);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return a < b;
  return reviewIdA < reviewIdB;
}

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
 * 이런 재업로드 중복을 잡지 못했다.
 *
 * 사진 전체 집합이 완전히 같아야만 중복으로 보던 이전 방식은, 실측에서 확인된
 * "시술 전 사진은 그대로 재사용하고 시술 후 사진만 매번 다르게 바꿔 여러 건 등록"
 * 하는 패턴을 놓쳤다(전 사진은 4건 모두 바이트까지 동일, 후 사진만 매번 다름).
 * 그래서 두 후기의 사진 중 단 한 장이라도 바이트가 완전히 같으면 중복 사진으로
 * 본다 — 구도/줌만 다른 별개 사진은 애초에 해시가 달라 여기 걸리지 않는다.
 * 해시를 못 구한 사진(fetch 실패 등)은 비교에서 제외한다.
 */
async function hasSharedPhoto(a: ListRowData, b: ListRowData): Promise<boolean> {
  if (a.photos.length === 0 || b.photos.length === 0) return false;
  const [aHashes, bHashes] = await Promise.all([
    Promise.all(a.photos.map((p) => hashPhoto(p.url))),
    Promise.all(b.photos.map((p) => hashPhoto(p.url))),
  ]);
  const bHashSet = new Set(bHashes.filter((h): h is string => h !== null));
  return aHashes.some((h) => h !== null && bHashSet.has(h));
}

/**
 * 현재 페이지에 로드된 행끼리만 비교하는 best-effort 중복 판정 (스펙 §3.1).
 * 영수증 일치 여부는 목록 화면만으로 신뢰성 있게 확인할 수 없어 항상 false(미확인)로
 * 둔다 — 전체 데이터셋 대조는 2차(서버) 범위(스펙 §7).
 */
export async function computeListDuplicateFlags(target: ListRowData, others: ListRowData[]): Promise<DuplicateFlags> {
  // 사진 해시 비교는 fetch가 필요해 비싸므로, 다른 필드가 전부 같은 후보로 먼저 좁힌 뒤에만 수행한다.
  // 나(target)보다 나중에 등록된 후보는 "원본" 자격이 없어 여기서는 볼 필요가 없다 —
  // 그 후보 자신이 판정될 때 나를 원본으로 찾아 스스로 보류 처리된다.
  const earlierFieldCandidates = others.filter(
    (o) => o.review_id !== target.review_id && nonPhotoFieldsMatch(o, target) && isEarlier(o.review_id, target.review_id)
  );

  let duplicate: ListRowData | undefined;
  for (const candidate of earlierFieldCandidates) {
    if (await hasSharedPhoto(candidate, target)) {
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
