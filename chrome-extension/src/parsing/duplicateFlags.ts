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

// "작성 일시"는 연월일만 같으면 같은 작성 시점으로 본다 — 시간은 조건에서 제외한다
// (실측에서 같은 무더기로 연속 등록된 후기끼리도 분 단위 시각이 갈리는 경우가 있었음).
// 형식을 못 읽으면(예상 못한 포맷) 안전하게 완전일치로 되돌린다.
const WRITTEN_AT_DATE_PATTERN = /^(\d{4})[.\-](\d{2})[.\-](\d{2})/;

function writtenAtDateKey(writtenAt: string): string | null {
  const m = writtenAt.trim().match(WRITTEN_AT_DATE_PATTERN);
  if (!m) return null;
  const [, year, month, day] = m;
  return `${year}-${month}-${day}`;
}

function sameWrittenAt(a: string, b: string): boolean {
  const dateA = writtenAtDateKey(a);
  const dateB = writtenAtDateKey(b);
  if (dateA === null || dateB === null) return a === b;
  return dateA === dateB;
}

function nonPhotoFieldsMatch(a: ListRowData, b: ListRowData): boolean {
  return (
    a.author === b.author &&
    b.author !== '' &&
    a.hospital_name === b.hospital_name &&
    !!b.hospital_name &&
    b.written_at !== '' &&
    sameWrittenAt(a.written_at, b.written_at) &&
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
 *
 * 동일 고객/병원/작성일/이벤트/내용(nonPhotoFieldsMatch)이 일치하는 후기는 3건 이상
 * 연속 재제출될 수 있다(실측: 1분 간격 3연속). target과 "그보다 이른 후보" 사이의
 * 직접 pairwise 매칭만 보던 이전 방식은, 재제출 체인 중간 항목이 그룹의 맨 처음
 * 항목과는 사진이 달라 매칭에서 빠지는 사례를 놓쳤다.
 *
 * 반대로 "필드가 일치하는 그룹 안에 사진 겹치는 쌍이 어디든 하나라도 있으면 그룹
 * 전체를 하나의 체인으로 본다"는 방식은 과했다 — 실측(854091/094 페어와 854095/097
 * 페어)에서 필드는 4건 모두 완전히 같지만 사진은 두 페어로 완전히 갈리는 사례가
 * 나왔다(페어 간 공유 사진 없음). 이걸 하나의 체인으로 묶으면 각 페어의 원본까지
 * 통째로 보류돼버린다.
 *
 * 그래서 사진이 겹치는 쌍끼리를 간선으로 그래프를 만들고, target이 속한 연결
 * 요소(다른 항목과 사진으로 사슬처럼 이어진 범위)만 하나의 재제출 체인으로 본다 —
 * A-B가 겹치고 B-C가 겹치면 A-C가 직접 안 겹쳐도 셋 다 한 체인(전이적 연결),
 * 하지만 사진으로 전혀 연결되지 않은 별개 쌍은 서로 다른 체인으로 분리된다.
 * 연결 요소 안에서 가장 이른(review_id가 가장 작은) 후기만 승인 유지, 나머지는
 * 중복으로 본다. target이 아무와도 사진이 안 겹치면(연결 요소 크기 1) 중복 아님.
 */
export async function computeListDuplicateFlags(target: ListRowData, others: ListRowData[]): Promise<DuplicateFlags> {
  const fieldMatches = others.filter((o) => o.review_id !== target.review_id && nonPhotoFieldsMatch(o, target));
  const group = [target, ...fieldMatches];

  const edges: boolean[][] = group.map(() => group.map(() => false));
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (await hasSharedPhoto(group[i], group[j])) edges[i][j] = edges[j][i] = true;
    }
  }

  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift() as number;
    for (let k = 0; k < group.length; k++) {
      if (edges[cur][k] && !visited.has(k)) {
        visited.add(k);
        queue.push(k);
      }
    }
  }
  const component = [...visited].map((i) => group[i]);

  const hasPhotoEvidence = component.length > 1;
  const earliestId = component.reduce((min, r) => (isEarlier(r.review_id, min) ? r.review_id : min), component[0].review_id);
  const isDuplicate = hasPhotoEvidence && earliestId !== target.review_id;

  return {
    same_customer: isDuplicate,
    same_hospital_name: isDuplicate,
    same_written_at: isDuplicate,
    same_procedure_event: isDuplicate,
    procedure_event_exists: !!target.event_info,
    same_content: isDuplicate,
    same_photo: isDuplicate,
    same_receipt: false,
  };
}
