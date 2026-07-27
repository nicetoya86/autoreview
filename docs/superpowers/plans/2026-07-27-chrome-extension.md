# 크롬 확장 프로그램 골격 (chrome-extension) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `admin.fastlane.kr/posts/reviews` 목록/상세 화면 위에 모의 판정 배지·패널을 오버레이로 표시하고, 검수자의 실제 처리 결과를 (admin-api 호출 없이) DOM 재스캔으로 감지해 정확도(`is_match`)를 팝업에서 확인할 수 있는 크롬 확장 프로그램을 만든다.

**Architecture:** `chrome-extension/` 패키지는 완성된 `judgment-engine`을 코드 변경 없이 `file:` 의존성으로 가져다 쓴다. Content script(목록/상세 각각)는 DOM 파싱과 렌더링만 담당하고, `fetch`/`chrome.storage` 같은 비동기 작업은 background service worker로 위임한다(`chrome.runtime.sendMessage`). 판정은 페이지 로드 시 자동 실행되지 않고 버튼 클릭으로만 트리거된다. 캐시는 `review_id` + 콘텐츠 지문(내용+사진 URL+수정일시 해시) 기준이며 TTL은 없다. 모든 로직은 `chrome.*`/DOM에 의존하지 않는 순수 함수로 먼저 만들고, 각 진입점(`content/*/index.ts`, `background/index.ts`, `popup/main.ts`)은 그 순수 함수를 호출하는 얇은 글루 코드로만 구성한다.

**Tech Stack:** TypeScript, Vite + `@crxjs/vite-plugin`(Manifest V3 빌드), Vitest + jsdom(테스트), `judgment-engine`(기존 패키지, 그대로 재사용)

## Global Constraints

- `chrome-extension/src/**`의 파싱/캐싱/판정 매핑/집계 로직은 `chrome.*`, `window`, `document`에 의존하지 않는 순수 함수로 작성한다 — `chrome.*`/DOM 접근은 각 `index.ts` 진입점에서만 한다 (스펙 §2, §6).
- `admin-api.yeoshin.co.kr`를 비롯한 어떤 API도 직접 호출하지 않는다 — 수집은 DOM 파싱만 사용한다 (스펙 §1, §4).
- 판정(엔진 호출)은 사용자의 명시적 버튼 클릭으로만 트리거된다 — 페이지 로드 시 자동 실행 금지 (스펙 §3.1, §3.2).
- 캐시 키는 `review_id` + 콘텐츠 지문(`content_text` + 사진 URL 목록 + 수정일시 해시)이다. TTL은 두지 않는다 (스펙 §3.4).
- `mock_judgment`이 `NEEDS_REVIEW`인 항목은 `is_match`/일치율 계산에서 제외한다 (스펙 §4).
- 확장 프로그램이 삽입하는 모든 DOM 요소/클래스는 `rvw-mock-` 접두사를 사용해 기존 `yrg-` 확장과 충돌하지 않게 한다 (스펙 §5).
- `judgment-engine` 패키지 자체는 수정하지 않는다 — `chrome-extension`은 이를 `"judgment-engine": "file:../judgment-engine"`로만 의존한다 (스펙 §2).

---

## File Structure

```
(프로젝트 루트)/
├── judgment-engine/                  ← 기존, 수정 없음 (빌드만 미리 필요)
├── proxy/
│   ├── api/judge-content.ts          ← Task 18에서 CORS 헤더 추가
│   └── tests/handler.test.ts         ← Task 18에서 CORS 테스트 추가
└── chrome-extension/                 ← 이번 계획에서 새로 생성
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── manifest.config.ts
    ├── vitest.config.ts
    ├── src/
    │   ├── shared/
    │   │   ├── types.ts              # CacheEntry, ListRowData, DetailPageData, ExtensionMessage 등
    │   │   ├── fingerprint.ts        # computeFingerprint()
    │   │   └── proxyConfig.ts        # PROXY_URL 상수
    │   ├── parsing/
    │   │   ├── listParser.ts         # parseListPage/parseListRow
    │   │   ├── detailParser.ts       # parseDetailPage, extractLabeledFields, parseReceiptFields
    │   │   └── duplicateFlags.ts     # computeListDuplicateFlags
    │   ├── background/
    │   │   ├── cache.ts              # CacheStore
    │   │   ├── judge.ts              # judgeListRow / judgeDetail
    │   │   ├── captureResult.ts      # computeIsMatch / captureActualResults
    │   │   ├── messageHandler.ts     # handleMessage() — 순수 라우팅 로직
    │   │   └── index.ts              # chrome.runtime.onMessage 글루
    │   ├── content/
    │   │   ├── list/
    │   │   │   ├── renderBadge.ts
    │   │   │   ├── listPageFlow.ts   # runListPageFlow() — 순수 오케스트레이션
    │   │   │   └── index.ts          # DOM 이벤트 글루
    │   │   └── detail/
    │   │       ├── renderPanel.ts
    │   │       ├── detailPageFlow.ts # runDetailPageFlow()
    │   │       └── index.ts
    │   └── popup/
    │       ├── summarize.ts          # summarize()
    │       ├── main.ts
    │       └── index.html
    └── tests/
        ├── fixtures/
        │   ├── list-page.html
        │   └── detail-page.html
        ├── fingerprint.test.ts
        ├── listParser.test.ts
        ├── detailParser.test.ts
        ├── duplicateFlags.test.ts
        ├── cache.test.ts
        ├── judge.test.ts
        ├── captureResult.test.ts
        ├── messageHandler.test.ts
        ├── renderBadge.test.ts
        ├── listPageFlow.test.ts
        ├── renderPanel.test.ts
        ├── detailPageFlow.test.ts
        └── summarize.test.ts
```

---

### Task 1: 저장소/빌드 도구 스캐폴드

**무엇을 완료하는가 (쉬운 설명):** 크롬 확장 코드를 담을 `chrome-extension/` 패키지를 만들고, Vite+CRXJS 빌드와 Vitest(jsdom) 테스트가 동작하는 것까지만 확인합니다. 아직 실제 파싱/판정 로직은 없습니다.

**Files:**
- Create: `chrome-extension/package.json`
- Create: `chrome-extension/tsconfig.json`
- Create: `chrome-extension/vite.config.ts`
- Create: `chrome-extension/manifest.config.ts`
- Create: `chrome-extension/vitest.config.ts`
- Create: `chrome-extension/src/background/index.ts`
- Create: `chrome-extension/src/popup/index.html`
- Create: `chrome-extension/src/popup/main.ts`
- Create: `chrome-extension/tests/smoke.test.ts`

**Interfaces:**
- Produces: `chrome-extension` 패키지 루트, `npm run build`로 MV3 번들 생성, `npm test`로 Vitest 실행 가능.

- [ ] **Step 1: judgment-engine을 먼저 빌드해 dist/ 생성 (file: 의존성이 참조할 대상)**

```bash
cd judgment-engine && npm run build
```

Expected: `dist/index.js`, `dist/index.d.ts` 등이 생성됨 (에러 없이 종료)

- [ ] **Step 2: chrome-extension/package.json 생성**

`chrome-extension/package.json`:
```json
{
  "name": "chrome-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "judgment-engine": "file:../judgment-engine"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.31",
    "@types/chrome": "^0.0.270",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 3: tsconfig.json 생성**

`chrome-extension/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["chrome"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: manifest.config.ts 생성**

`chrome-extension/manifest.config.ts`:
```ts
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '후기 모의 검수',
  version: '0.1.0',
  action: { default_popup: 'src/popup/index.html' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    {
      matches: [
        'https://admin.fastlane.kr/posts/reviews',
        'https://admin.fastlane.kr/posts/reviews?*',
      ],
      js: ['src/content/list/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://admin.fastlane.kr/posts/reviews/detail/*'],
      js: ['src/content/detail/index.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage'],
});
```

- [ ] **Step 5: vite.config.ts 생성**

`chrome-extension/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
});
```

- [ ] **Step 6: vitest.config.ts 생성**

`chrome-extension/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
```

- [ ] **Step 7: 임시 background/popup 파일 생성 (매니페스트가 참조하는 파일이 없으면 빌드 실패)**

`chrome-extension/src/background/index.ts`:
```ts
export const BACKGROUND_READY = true;
```

`chrome-extension/src/popup/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>후기 모의 검수</title>
  </head>
  <body>
    <div id="app">로딩 중...</div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`chrome-extension/src/popup/main.ts`:
```ts
export const POPUP_READY = true;
```

- [ ] **Step 8: 실패하는(아직 없는) 스모크 테스트 작성**

`chrome-extension/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BACKGROUND_READY } from '../src/background/index';

describe('smoke', () => {
  it('background 모듈이 로드된다', () => {
    expect(BACKGROUND_READY).toBe(true);
  });
});
```

- [ ] **Step 9: 의존성 설치, 테스트, 빌드 실행**

```bash
cd chrome-extension && npm install && npm test && npm run build
```

Expected: `npm test` PASS (1 test), `npm run build`가 `chrome-extension/dist/`에 매니페스트+번들을 생성하며 에러 없이 종료

- [ ] **Step 10: 커밋**

```bash
git add chrome-extension
git commit -m "chore: scaffold chrome-extension package with vite/crxjs/vitest"
```

---

### Task 2: 공용 타입 정의

**무엇을 완료하는가 (쉬운 설명):** 확장 프로그램 전체(파서, 캐시, background, UI)가 공유할 데이터 모양(타입)을 정의합니다.

**Files:**
- Create: `chrome-extension/src/shared/types.ts`
- Test: `chrome-extension/tests/types.test.ts`

**Interfaces:**
- Consumes: `judgment-engine`의 `ReviewInput`, `JudgmentResult`, `MockJudgment`
- Produces: `JudgmentTier`, `CacheEntry`, `ListRowData`, `DetailPageData`, `ActualResult`, `ExtensionMessage`, `ExtensionResponse` — 이후 모든 태스크가 이 타입들을 사용한다.

- [ ] **Step 1: 타입을 사용하는 실패 테스트 작성**

`chrome-extension/tests/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { CacheEntry, ListRowData, DetailPageData } from '../src/shared/types';

describe('shared types', () => {
  it('CacheEntry/ListRowData/DetailPageData를 구성할 수 있다', () => {
    const row: ListRowData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: '만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
      review_status: '대기',
      modified_at: '2026-07-20T00:00:00Z',
      author: '홍**',
    };

    const detail: DetailPageData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: '만족스러웠어요',
      photos: row.photos,
      procedure: { is_before_after_exempt: false },
      hospital_requested_takedown: false,
      modified_at: row.modified_at,
    };

    const entry: CacheEntry = {
      review_id: 'r1',
      tier: 'list',
      fingerprint: 'abc',
      duplicate_flags: {
        same_customer: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: false,
      },
      result: {
        review_id: 'r1',
        mock_judgment: 'NEEDS_REVIEW',
        matched_rules: [],
        confidence: 0,
        reasoning: 'ok',
        ai_invoked: false,
        photo_results: [],
      },
      checked_at: '2026-07-20T00:00:00Z',
    };

    expect(row.review_id).toBe('r1');
    expect(detail.review_id).toBe('r1');
    expect(entry.tier).toBe('list');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- types
```

Expected: FAIL — `Cannot find module '../src/shared/types'`

- [ ] **Step 3: types.ts 작성**

`chrome-extension/src/shared/types.ts`:
```ts
import type { DuplicateFlags, JudgmentResult, ReviewInput, ReviewType } from 'judgment-engine';

export type JudgmentTier = 'list' | 'detail';
export type ActualResult = 'APPROVED' | 'PAUSED' | 'HIDDEN';
export type ReviewStatusLabel = '대기' | '승인' | '보류' | '숨김';

export interface ListRowData {
  review_id: string;
  review_type: ReviewType;
  content_text: string;
  photos: ReviewInput['photos'];
  review_status: ReviewStatusLabel;
  modified_at: string;
  author: string;
}

export interface DetailPageData {
  review_id: string;
  review_type: ReviewType;
  content_text: string;
  photos: ReviewInput['photos'];
  procedure: ReviewInput['procedure'];
  receipt?: ReviewInput['receipt'];
  hospital_requested_takedown: boolean;
  modified_at: string;
}

export interface CacheEntry {
  review_id: string;
  tier: JudgmentTier;
  fingerprint: string;
  duplicate_flags: DuplicateFlags;
  result: JudgmentResult;
  checked_at: string;
  actual_result?: ActualResult;
  is_match?: boolean;
  reviewer_feedback?: 'AGREE' | 'DISAGREE';
}

export type ExtensionMessage =
  | { type: 'JUDGE_LIST'; rows: ListRowData[] }
  | { type: 'JUDGE_DETAIL'; detail: DetailPageData }
  | { type: 'GET_CACHE'; reviewId: string }
  | { type: 'CAPTURE_STATUS'; rows: Array<{ review_id: string; review_status: ReviewStatusLabel }> }
  | { type: 'SAVE_FEEDBACK'; reviewId: string; feedback: 'AGREE' | 'DISAGREE' };

export type ExtensionResponse =
  | { type: 'JUDGE_LIST_RESULT'; entries: CacheEntry[] }
  | { type: 'JUDGE_DETAIL_RESULT'; entry: CacheEntry }
  | { type: 'CACHE_ENTRY'; entry: CacheEntry | null }
  | { type: 'CAPTURE_DONE' }
  | { type: 'FEEDBACK_SAVED'; entry: CacheEntry | null };
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- types
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/shared/types.ts chrome-extension/tests/types.test.ts
git commit -m "feat: define shared cache/message types for chrome-extension"
```

---

### Task 3: 콘텐츠 지문 함수

**무엇을 완료하는가 (쉬운 설명):** 후기 내용/사진/수정일시를 하나의 짧은 문자열(지문)로 바꾸는 함수를 만듭니다. 이 지문이 캐시 키의 일부가 되어, 내용이 바뀌면 자동으로 캐시가 무효화됩니다.

**Files:**
- Create: `chrome-extension/src/shared/fingerprint.ts`
- Test: `chrome-extension/tests/fingerprint.test.ts`

**Interfaces:**
- Produces: `computeFingerprint(input: { content_text: string; photos: Array<{ url: string }>; modified_at: string }): string` — Task 9(judge), Task 13/15(orchestration)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/fingerprint.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeFingerprint } from '../src/shared/fingerprint';

describe('computeFingerprint', () => {
  it('같은 입력이면 항상 같은 지문을 반환한다', () => {
    const input = { content_text: 'hello', photos: [{ url: 'https://x/1.jpg' }], modified_at: '2026-07-20' };
    expect(computeFingerprint(input)).toBe(computeFingerprint({ ...input }));
  });

  it('내용이 바뀌면 지문도 바뀐다', () => {
    const a = computeFingerprint({ content_text: 'hello', photos: [], modified_at: '2026-07-20' });
    const b = computeFingerprint({ content_text: 'world', photos: [], modified_at: '2026-07-20' });
    expect(a).not.toBe(b);
  });

  it('사진 URL이 바뀌면 지문도 바뀐다', () => {
    const a = computeFingerprint({ content_text: 'hello', photos: [{ url: 'https://x/1.jpg' }], modified_at: '2026-07-20' });
    const b = computeFingerprint({ content_text: 'hello', photos: [{ url: 'https://x/2.jpg' }], modified_at: '2026-07-20' });
    expect(a).not.toBe(b);
  });

  it('수정일시가 바뀌면 지문도 바뀐다', () => {
    const a = computeFingerprint({ content_text: 'hello', photos: [], modified_at: '2026-07-20' });
    const b = computeFingerprint({ content_text: 'hello', photos: [], modified_at: '2026-07-21' });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- fingerprint
```

Expected: FAIL — `Cannot find module '../src/shared/fingerprint'`

- [ ] **Step 3: fingerprint.ts 구현**

`chrome-extension/src/shared/fingerprint.ts`:
```ts
/**
 * 캐시 무효화용 지문(FNV-1a). 암호학적 안전성은 필요 없고,
 * 동기(sync) 순수 함수여야 background/UI 양쪽에서 간단히 쓸 수 있어
 * crypto.subtle.digest(비동기) 대신 이 방식을 쓴다 (스펙 §3.4).
 */
export function computeFingerprint(input: {
  content_text: string;
  photos: Array<{ url: string }>;
  modified_at: string;
}): string {
  const raw = `${input.content_text}|${input.photos.map((p) => p.url).join(',')}|${input.modified_at}`;

  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- fingerprint
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/shared/fingerprint.ts chrome-extension/tests/fingerprint.test.ts
git commit -m "feat: add content fingerprint for cache invalidation"
```

---

### Task 4: 목록 화면 DOM 파서

**무엇을 완료하는가 (쉬운 설명):** 목록 화면의 표(table)에서 각 후기 행의 데이터(유형, 내용, 사진, 상태 등)를 읽어오는 함수를 만듭니다.

**중요한 가정(주의):** 실제 `admin.fastlane.kr` 화면의 정확한 CSS 클래스는 아직 확인되지 않았다(민감 데이터라 캡처하지 않음). 이 파서는 이전 세션에서 문서화한 **컬럼 라벨 텍스트**(병원명/후기 유형/검수 상태/사진/후기 내용/수정 일시/작성자/관리)와, "상세 보기" 링크가 `/posts/reviews/detail/{id}` 형태라는 것만 신뢰하고, `<thead>`의 헤더 텍스트로 컬럼 위치를 찾는 방식으로 만든다. Task 19(실사용 스모크 테스트)에서 실제 화면과 대조해 선택자를 조정한다.

**Files:**
- Create: `chrome-extension/src/parsing/listParser.ts`
- Create: `chrome-extension/tests/fixtures/list-page.html`
- Test: `chrome-extension/tests/listParser.test.ts`

**Interfaces:**
- Consumes: `ListRowData` (Task 2)
- Produces: `parseListPage(table: HTMLTableElement): ListRowData[]`, `buildHeaderIndex(table: HTMLTableElement): Record<string, number>` — Task 13(list orchestration)에서 둘 다 사용(헤더 위치 탐색 로직 중복 방지).

- [ ] **Step 1: 픽스처 HTML 작성**

`chrome-extension/tests/fixtures/list-page.html`:
```html
<table id="review-list">
  <thead>
    <tr>
      <th>NO.</th>
      <th>병원명</th>
      <th>후기 유형</th>
      <th>검수 상태</th>
      <th>사진</th>
      <th>후기 내용</th>
      <th>수정 일시</th>
      <th>작성자</th>
      <th>관리</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td>OO병원</td>
      <td>영수증 후기</td>
      <td>대기</td>
      <td><img src="https://cdn.example/photo1.jpg" alt="" /></td>
      <td>시술 후 만족스러웠어요</td>
      <td>2026-07-20 10:00</td>
      <td>홍**</td>
      <td><a href="/posts/reviews/detail/1001">상세 보기</a></td>
    </tr>
    <tr>
      <td>2</td>
      <td>XX의원</td>
      <td>티켓 사용 후기</td>
      <td>승인</td>
      <td>
        <img src="https://cdn.example/photo2-before.jpg" alt="전" />
        <img src="https://cdn.example/photo2-after.jpg" alt="후" />
      </td>
      <td>붓기가 금방 빠졌어요</td>
      <td>2026-07-19 09:00</td>
      <td>김**</td>
      <td><a href="/posts/reviews/detail/1002">상세 보기</a></td>
    </tr>
    <tr>
      <td>3</td>
      <td>OO병원</td>
      <td>상담 후기</td>
      <td>대기</td>
      <td></td>
      <td>ㄱㄴㄷㄹㅁ</td>
      <td>2026-07-18 09:00</td>
      <td>이**</td>
      <td><a href="/posts/reviews/detail/1003">상세 보기</a></td>
    </tr>
  </tbody>
</table>
```

- [ ] **Step 2: 실패하는 테스트 작성**

`chrome-extension/tests/listParser.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseListPage } from '../src/parsing/listParser';

let table: HTMLTableElement;

beforeAll(() => {
  const html = readFileSync(new URL('./fixtures/list-page.html', import.meta.url), 'utf-8');
  const dom = new JSDOM(html);
  table = dom.window.document.querySelector('table') as HTMLTableElement;
});

describe('parseListPage', () => {
  it('대기 상태 행만 반환한다', () => {
    const rows = parseListPage(table);
    expect(rows.map((r) => r.review_id)).toEqual(['1001', '1003']);
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
    expect(row1001.modified_at).toBe('2026-07-20 10:00');
  });

  it('사진이 없는 행도 스킵하지 않고 빈 배열로 파싱한다', () => {
    const rows = parseListPage(table);
    const row1003 = rows.find((r) => r.review_id === '1003')!;
    expect(row1003.photos).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
cd chrome-extension && npm install -D jsdom && npm test -- listParser
```

Expected: FAIL — `Cannot find module '../src/parsing/listParser'`

- [ ] **Step 4: listParser.ts 구현**

`chrome-extension/src/parsing/listParser.ts`:
```ts
import type { ListRowData, ReviewStatusLabel } from '../shared/types';
import type { ReviewType } from 'judgment-engine';

const REVIEW_TYPE_LABELS: Record<string, ReviewType> = {
  '티켓 사용 후기': 'TICKET_USE',
  '상담 후기': 'CONSULTATION',
  '현장 앱결제 후기': 'ONSITE_APP_PAYMENT',
  '영수증 후기': 'RECEIPT',
};

const KNOWN_STATUS_LABELS: ReviewStatusLabel[] = ['대기', '승인', '보류', '숨김'];

const DETAIL_LINK_PATTERN = /\/posts\/reviews\/detail\/(\d+)/;

export function buildHeaderIndex(table: HTMLTableElement): Record<string, number> {
  const headerCells = Array.from(table.querySelectorAll('thead th'));
  const index: Record<string, number> = {};
  headerCells.forEach((cell, i) => {
    const label = cell.textContent?.trim() ?? '';
    if (label) index[label] = i;
  });
  return index;
}

function cellText(cells: HTMLCollectionOf<HTMLTableCellElement>, index: number | undefined): string {
  if (index === undefined) return '';
  return cells[index]?.textContent?.trim() ?? '';
}

/**
 * 목록 화면 실제 CSS 클래스는 미확인 상태 — 컬럼 헤더 텍스트로 위치를 찾는다.
 * 실사용 스모크 테스트(Task 19)에서 실제 마크업과 어긋나면 이 함수만 조정한다.
 */
export function parseListPage(table: HTMLTableElement): ListRowData[] {
  const headerIndex = buildHeaderIndex(table);
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const result: ListRowData[] = [];

  for (const row of rows) {
    const cells = row.cells;
    const statusText = cellText(cells, headerIndex['검수 상태']) as ReviewStatusLabel;
    if (!KNOWN_STATUS_LABELS.includes(statusText) || statusText !== '대기') continue;

    const link = row.querySelector('a[href*="/posts/reviews/detail/"]');
    const match = link?.getAttribute('href')?.match(DETAIL_LINK_PATTERN);
    if (!match) continue;

    const typeText = cellText(cells, headerIndex['후기 유형']);
    const review_type = REVIEW_TYPE_LABELS[typeText];
    if (!review_type) continue;

    const photoCellIndex = headerIndex['사진'];
    const imgs = photoCellIndex !== undefined ? Array.from(cells[photoCellIndex]?.querySelectorAll('img') ?? []) : [];
    const photos = imgs.map((img) => {
      const alt = img.getAttribute('alt')?.trim();
      if (alt === '전') return { url: img.src, declared_category: 'BEFORE_AFTER' as const, before_after_slot: 'BEFORE' as const };
      if (alt === '후') return { url: img.src, declared_category: 'BEFORE_AFTER' as const, before_after_slot: 'AFTER' as const };
      return { url: img.src, declared_category: 'GENERAL' as const };
    });

    result.push({
      review_id: match[1],
      review_type,
      content_text: cellText(cells, headerIndex['후기 내용']),
      photos,
      review_status: statusText,
      modified_at: cellText(cells, headerIndex['수정 일시']),
      author: cellText(cells, headerIndex['작성자']),
    });
  }

  return result;
}
```

- [ ] **Step 5: 테스트 재실행**

```bash
cd chrome-extension && npm test -- listParser
```

Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```bash
git add chrome-extension/src/parsing/listParser.ts chrome-extension/tests/listParser.test.ts chrome-extension/tests/fixtures/list-page.html
git commit -m "feat: parse pending review rows from the admin list table"
```

---

### Task 5: 상세 화면 DOM 파서

**무엇을 완료하는가 (쉬운 설명):** 상세 화면에서 후기 내용/사진/시술명/영수증 정보(영수증 후기인 경우)를 읽어오는 함수를 만듭니다.

**중요한 가정(주의):** Task 4와 마찬가지로 실제 클래스명은 미확인. 라벨(`후기유형`, `후기 내용`, `수정 일시`, `받은 시술`, `병원명`, `결제일`, `결제금액`) 텍스트가 `dt`/라벨 요소 다음에 값이 온다고 가정한다. 영수증 항목은 "입력값"과 "등록값" 두 값을 나란히 보여준다고 가정하고 문자열을 직접 비교해 일치 여부를 계산한다(관리자 화면이 계산해주지 않는다는 PRD §4의 한계를 파서가 최대한 보완).

**Files:**
- Create: `chrome-extension/src/parsing/detailParser.ts`
- Create: `chrome-extension/tests/fixtures/detail-page.html`
- Test: `chrome-extension/tests/detailParser.test.ts`

**Interfaces:**
- Consumes: `DetailPageData` (Task 2)
- Produces: `parseDetailPage(root: ParentNode): DetailPageData` — Task 15(detail orchestration)에서 사용.

- [ ] **Step 1: 픽스처 HTML 작성**

`chrome-extension/tests/fixtures/detail-page.html`:
```html
<div class="review-detail">
  <dl>
    <dt>후기유형</dt>
    <dd>영수증 후기</dd>
    <dt>후기 내용</dt>
    <dd>시술 후 만족스러웠어요</dd>
    <dt>수정 일시</dt>
    <dd>2026-07-20 10:00</dd>
    <dt>받은 시술</dt>
    <dd>브라질리언 제모</dd>
  </dl>
  <div class="photos">
    <img src="https://cdn.example/photo1.jpg" alt="" />
  </div>
  <div class="receipt-info">
    <div class="receipt-field">
      <dt>병원명</dt>
      <dd class="input-value">OO병원</dd>
      <dd class="registered-value">OO병원</dd>
    </div>
    <div class="receipt-field">
      <dt>결제일</dt>
      <dd class="input-value">2026-07-19</dd>
      <dd class="registered-value">2026-07-19</dd>
    </div>
    <div class="receipt-field">
      <dt>결제금액</dt>
      <dd class="input-value">50000</dd>
      <dd class="registered-value"></dd>
    </div>
  </div>
</div>
```

- [ ] **Step 2: 실패하는 테스트 작성**

`chrome-extension/tests/detailParser.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseDetailPage } from '../src/parsing/detailParser';

let root: HTMLElement;

beforeAll(() => {
  const html = readFileSync(new URL('./fixtures/detail-page.html', import.meta.url), 'utf-8');
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
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- detailParser
```

Expected: FAIL — `Cannot find module '../src/parsing/detailParser'`

- [ ] **Step 4: detailParser.ts 구현**

`chrome-extension/src/parsing/detailParser.ts`:
```ts
import type { DetailPageData } from '../shared/types';
import type { ReviewType } from 'judgment-engine';

const REVIEW_TYPE_LABELS: Record<string, ReviewType> = {
  '티켓 사용 후기': 'TICKET_USE',
  '상담 후기': 'CONSULTATION',
  '현장 앱결제 후기': 'ONSITE_APP_PAYMENT',
  '영수증 후기': 'RECEIPT',
};

// PRD §8.0 예외 규칙 중 문서에 명시된 예시만 반영 (브라질리언 제모).
// 그 외 시술의 전/후 촬영 예외 여부는 실사용 검증 후 목록을 넓힌다.
const BEFORE_AFTER_EXEMPT_PROCEDURES = ['브라질리언 제모'];

function extractLabeledFields(root: ParentNode, labels: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const dts = root.querySelectorAll('dt');
  dts.forEach((dt) => {
    const label = dt.textContent?.trim() ?? '';
    if (!labels.includes(label)) return;
    const value = dt.nextElementSibling;
    if (value) result[label] = value.textContent?.trim() ?? '';
  });
  return result;
}

function compareReceiptValue(input?: string, registered?: string): boolean | null {
  if (!input || !registered) return null;
  return input === registered;
}

function parseReceiptFields(root: ParentNode): DetailPageData['receipt'] {
  const fieldRows = Array.from(root.querySelectorAll('.receipt-field'));
  if (fieldRows.length === 0) return undefined;

  const values: Record<string, { input?: string; registered?: string }> = {};
  fieldRows.forEach((row) => {
    const label = row.querySelector('dt')?.textContent?.trim() ?? '';
    const input = row.querySelector('.input-value')?.textContent?.trim() || undefined;
    const registered = row.querySelector('.registered-value')?.textContent?.trim() || undefined;
    values[label] = { input, registered };
  });

  return {
    amount_matches: compareReceiptValue(values['결제금액']?.input, values['결제금액']?.registered),
    date_matches: compareReceiptValue(values['결제일']?.input, values['결제일']?.registered),
    hospital_name_matches: compareReceiptValue(values['병원명']?.input, values['병원명']?.registered),
    photo_count: root.querySelectorAll('.photos img').length,
    // 실제 화면에서 여신티켓 앱 결제 영수증을 구분하는 표시가 아직 확인되지 않음 — 확인 전까지 false로 보수적으로 처리하고, Task 19 스모크 테스트에서 실제 신호를 확인해 이 함수만 조정한다.
    is_app_payment_receipt: false,
  };
}

export function parseDetailPage(root: ParentNode, reviewId: string): DetailPageData {
  const fields = extractLabeledFields(root, ['후기유형', '후기 내용', '수정 일시', '받은 시술']);
  const review_type = REVIEW_TYPE_LABELS[fields['후기유형']] ?? 'TICKET_USE';

  const photos = Array.from(root.querySelectorAll('.photos img')).map((img) => ({
    url: (img as HTMLImageElement).src,
    declared_category: 'GENERAL' as const,
  }));

  const procedureName = fields['받은 시술'] || undefined;

  return {
    review_id: reviewId,
    review_type,
    content_text: fields['후기 내용'] ?? '',
    photos,
    procedure: {
      name: procedureName,
      is_before_after_exempt: procedureName ? BEFORE_AFTER_EXEMPT_PROCEDURES.includes(procedureName) : false,
    },
    receipt: review_type === 'RECEIPT' ? parseReceiptFields(root) : undefined,
    // 병원 게시중단 요청은 이미 승인된 후기에만 발생하는 별도 프로세스이며,
    // 이 파서는 '대기' 상태 후기만 다루므로 항상 false (스펙 §5 에러 처리 참고).
    hospital_requested_takedown: false,
    modified_at: fields['수정 일시'] ?? '',
  };
}
```

- [ ] **Step 5: 테스트 재실행**

```bash
cd chrome-extension && npm test -- detailParser
```

Expected: PASS (6 tests)

- [ ] **Step 6: 커밋**

```bash
git add chrome-extension/src/parsing/detailParser.ts chrome-extension/tests/detailParser.test.ts chrome-extension/tests/fixtures/detail-page.html
git commit -m "feat: parse detail-page fields including best-effort receipt matching"
```

---

### Task 6: 목록 단계 중복 판정 (best-effort)

**무엇을 완료하는가 (쉬운 설명):** 목록 화면에 지금 보이는 다른 행들과 비교해서, "같은 작성자 + 같은 내용 + 같은 사진"인 후기가 있는지 찾아 `duplicate_flags`를 만듭니다. 전체 데이터셋이 아니라 현재 페이지 범위 내에서만 확인하는 best-effort입니다(스펙 §3.1, §7).

**Files:**
- Create: `chrome-extension/src/parsing/duplicateFlags.ts`
- Test: `chrome-extension/tests/duplicateFlags.test.ts`

**Interfaces:**
- Consumes: `ListRowData` (Task 2)
- Produces: `computeListDuplicateFlags(target: ListRowData, others: ListRowData[]): DuplicateFlags` — Task 9(judge), Task 13(list orchestration)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/duplicateFlags.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeListDuplicateFlags } from '../src/parsing/duplicateFlags';
import type { ListRowData } from '../src/shared/types';

function row(overrides: Partial<ListRowData>): ListRowData {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '만족스러웠어요',
    photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
    review_status: '대기',
    modified_at: '2026-07-20',
    author: '홍**',
    ...overrides,
  };
}

describe('computeListDuplicateFlags', () => {
  it('작성자+내용+사진이 모두 같은 다른 행이 있으면 중복 플래그를 true로 채운다', () => {
    const target = row({ review_id: 'r1' });
    const other = row({ review_id: 'r2' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_customer).toBe(true);
    expect(flags.same_content).toBe(true);
    expect(flags.same_photo).toBe(true);
  });

  it('작성자가 다르면 중복 아님', () => {
    const target = row({ review_id: 'r1', author: '홍**' });
    const other = row({ review_id: 'r2', author: '김**' });
    const flags = computeListDuplicateFlags(target, [other]);
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

  it('작성일시/시술이벤트/영수증 플래그는 목록 단계에서 항상 false(미확인)', () => {
    const target = row({ review_id: 'r1' });
    const other = row({ review_id: 'r2' });
    const flags = computeListDuplicateFlags(target, [other]);
    expect(flags.same_written_at).toBe(false);
    expect(flags.same_procedure_event).toBe(false);
    expect(flags.same_receipt).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- duplicateFlags
```

Expected: FAIL — `Cannot find module '../src/parsing/duplicateFlags'`

- [ ] **Step 3: duplicateFlags.ts 구현**

`chrome-extension/src/parsing/duplicateFlags.ts`:
```ts
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
 * 작성일시/시술이벤트/영수증 일치 여부는 목록 화면만으로 신뢰성 있게 확인할 수 없어
 * 항상 false(미확인)로 둔다 — 전체 데이터셋 대조는 2차(서버) 범위(스펙 §7).
 */
export function computeListDuplicateFlags(target: ListRowData, others: ListRowData[]): DuplicateFlags {
  const candidates = others.filter((o) => o.review_id !== target.review_id);
  const duplicate = candidates.find(
    (o) =>
      o.author === target.author &&
      target.author !== '' &&
      o.content_text.trim() === target.content_text.trim() &&
      target.content_text.trim() !== '' &&
      samePhotoSet(o, target)
  );

  return {
    same_customer: !!duplicate,
    same_written_at: false,
    same_procedure_event: false,
    same_content: !!duplicate,
    same_photo: !!duplicate,
    same_receipt: false,
  };
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- duplicateFlags
```

Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/parsing/duplicateFlags.ts chrome-extension/tests/duplicateFlags.test.ts
git commit -m "feat: add page-scope best-effort duplicate detection"
```

---

### Task 7: 캐시 저장소 (`cache.ts`)

**무엇을 완료하는가 (쉬운 설명):** 판정 결과를 `chrome.storage.local`에 저장/조회하는 코드를 만듭니다. 실제 `chrome.storage` 없이도 테스트할 수 있도록, 저장소를 함수 인자로 주입받는 형태로 만듭니다.

**Files:**
- Create: `chrome-extension/src/background/cache.ts`
- Test: `chrome-extension/tests/cache.test.ts`

**Interfaces:**
- Consumes: `CacheEntry` (Task 2)
- Produces:
  ```ts
  interface StorageArea {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  }
  interface CacheStore {
    get(reviewId: string): Promise<CacheEntry | undefined>;
    set(entry: CacheEntry): Promise<void>;
    getAll(): Promise<CacheEntry[]>;
  }
  function createCacheStore(storage: StorageArea): CacheStore;
  ```
  Task 9(judge), Task 10(captureResult), Task 11(messageHandler), Task 16(popup)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/cache.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createCacheStore } from '../src/background/cache';
import type { CacheEntry } from '../src/shared/types';

function fakeEntry(reviewId: string): CacheEntry {
  return {
    review_id: reviewId,
    tier: 'list',
    fingerprint: 'fp1',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: reviewId,
      mock_judgment: 'APPROVE_CANDIDATE',
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [],
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys: string[]) => {
      const result: Record<string, unknown> = {};
      keys.forEach((k) => {
        if (k in data) result[k] = data[k];
      });
      return result;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
  };
}

describe('createCacheStore', () => {
  it('저장한 항목을 review_id로 조회할 수 있다', async () => {
    const storage = fakeStorage();
    const store = createCacheStore(storage);

    await store.set(fakeEntry('r1'));
    const found = await store.get('r1');

    expect(found?.review_id).toBe('r1');
  });

  it('없는 review_id는 undefined를 반환한다', async () => {
    const store = createCacheStore(fakeStorage());
    expect(await store.get('missing')).toBeUndefined();
  });

  it('getAll은 저장된 모든 항목을 반환한다', async () => {
    const storage = fakeStorage();
    const store = createCacheStore(storage);

    await store.set(fakeEntry('r1'));
    await store.set(fakeEntry('r2'));

    const all = await store.getAll();
    expect(all.map((e) => e.review_id).sort()).toEqual(['r1', 'r2']);
  });

  it('같은 review_id로 다시 set하면 덮어쓴다', async () => {
    const storage = fakeStorage();
    const store = createCacheStore(storage);

    await store.set(fakeEntry('r1'));
    const updated = { ...fakeEntry('r1'), tier: 'detail' as const };
    await store.set(updated);

    const found = await store.get('r1');
    expect(found?.tier).toBe('detail');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- cache
```

Expected: FAIL — `Cannot find module '../src/background/cache'`

- [ ] **Step 3: cache.ts 구현**

`chrome-extension/src/background/cache.ts`:
```ts
import type { CacheEntry } from '../shared/types';

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface CacheStore {
  get(reviewId: string): Promise<CacheEntry | undefined>;
  set(entry: CacheEntry): Promise<void>;
  getAll(): Promise<CacheEntry[]>;
}

const KEY_PREFIX = 'rvw-mock-review:';
const INDEX_KEY = 'rvw-mock-review-index';

/**
 * chrome.storage.local(또는 테스트용 fake storage)을 review_id 기준으로 감싼다.
 * getAll()을 위해 review_id 목록을 별도 인덱스 키에 유지한다.
 */
export function createCacheStore(storage: StorageArea): CacheStore {
  return {
    async get(reviewId) {
      const result = await storage.get([KEY_PREFIX + reviewId]);
      return result[KEY_PREFIX + reviewId] as CacheEntry | undefined;
    },

    async set(entry) {
      const indexResult = await storage.get([INDEX_KEY]);
      const index = (indexResult[INDEX_KEY] as string[] | undefined) ?? [];
      const nextIndex = index.includes(entry.review_id) ? index : [...index, entry.review_id];

      await storage.set({
        [KEY_PREFIX + entry.review_id]: entry,
        [INDEX_KEY]: nextIndex,
      });
    },

    async getAll() {
      const indexResult = await storage.get([INDEX_KEY]);
      const index = (indexResult[INDEX_KEY] as string[] | undefined) ?? [];
      if (index.length === 0) return [];

      const keys = index.map((id) => KEY_PREFIX + id);
      const result = await storage.get(keys);
      return keys.map((k) => result[k] as CacheEntry).filter(Boolean);
    },
  };
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- cache
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/background/cache.ts chrome-extension/tests/cache.test.ts
git commit -m "feat: add review_id-keyed cache store over injectable storage"
```

---

### Task 8: `judgment-engine` 연동 (`judge.ts`)

**무엇을 완료하는가 (쉬운 설명):** 목록/상세에서 파싱한 데이터를 `judgment-engine`이 이해하는 `ReviewInput` 모양으로 바꾸고 `judgeReview()`를 호출하는 함수를 만듭니다.

**Files:**
- Create: `chrome-extension/src/background/judge.ts`
- Test: `chrome-extension/tests/judge.test.ts`

**Interfaces:**
- Consumes: `ListRowData`, `DetailPageData` (Task 2), `judgeReview` (`judgment-engine`, 기존)
- Produces:
  ```ts
  function judgeListRow(row: ListRowData, duplicateFlags: DuplicateFlags, aiConfig: AiAdapterConfig): Promise<JudgmentResult>;
  function judgeDetail(detail: DetailPageData, duplicateFlags: DuplicateFlags, aiConfig: AiAdapterConfig): Promise<JudgmentResult>;
  ```
  Task 11(messageHandler)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성 (judgeReview는 mock으로 대체)**

`chrome-extension/tests/judge.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeListRow, judgeDetail } from '../src/background/judge';
import type { ListRowData, DetailPageData } from '../src/shared/types';

vi.mock('judgment-engine', () => ({
  judgeReview: vi.fn(async (input) => ({
    review_id: input.review_id,
    mock_judgment: 'APPROVE_CANDIDATE',
    matched_rules: [],
    confidence: 1,
    reasoning: 'mock',
    ai_invoked: false,
    photo_results: [],
  })),
}));

import { judgeReview } from 'judgment-engine';

const emptyDuplicateFlags = {
  same_customer: false,
  same_written_at: false,
  same_procedure_event: false,
  same_content: false,
  same_photo: false,
  same_receipt: false,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('judgeListRow', () => {
  it('영수증 유형이면 receipt 필드를 전부 null로 채워 넘긴다', async () => {
    const row: ListRowData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: 'ok',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'RECEIPT' }],
      review_status: '대기',
      modified_at: '2026-07-20',
      author: '홍**',
    };

    await judgeListRow(row, emptyDuplicateFlags, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(judgeReview).toHaveBeenCalledWith(
      expect.objectContaining({
        review_id: 'r1',
        receipt: { amount_matches: null, date_matches: null, hospital_name_matches: null, photo_count: 1, is_app_payment_receipt: false },
        duplicate_flags: emptyDuplicateFlags,
      }),
      { proxyUrl: 'https://proxy.example/api/judge-content' }
    );
  });

  it('영수증이 아닌 유형이면 receipt를 넘기지 않는다', async () => {
    const row: ListRowData = {
      review_id: 'r2',
      review_type: 'TICKET_USE',
      content_text: 'ok',
      photos: [],
      review_status: '대기',
      modified_at: '2026-07-20',
      author: '홍**',
    };

    await judgeListRow(row, emptyDuplicateFlags, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(judgeReview).toHaveBeenCalledWith(expect.objectContaining({ receipt: undefined }), expect.anything());
  });
});

describe('judgeDetail', () => {
  it('상세 데이터의 procedure/receipt/hospital_requested_takedown을 그대로 전달한다', async () => {
    const detail: DetailPageData = {
      review_id: 'r1',
      review_type: 'RECEIPT',
      content_text: 'ok',
      photos: [],
      procedure: { name: '브라질리언 제모', is_before_after_exempt: true },
      receipt: { amount_matches: true, date_matches: true, hospital_name_matches: true, photo_count: 1, is_app_payment_receipt: false },
      hospital_requested_takedown: false,
      modified_at: '2026-07-20',
    };

    await judgeDetail(detail, emptyDuplicateFlags, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(judgeReview).toHaveBeenCalledWith(
      expect.objectContaining({
        procedure: detail.procedure,
        receipt: detail.receipt,
        hospital_requested_takedown: false,
      }),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- judge
```

Expected: FAIL — `Cannot find module '../src/background/judge'`

- [ ] **Step 3: judge.ts 구현**

`chrome-extension/src/background/judge.ts`:
```ts
import type { AiAdapterConfig, DuplicateFlags, JudgmentResult, ReviewInput } from 'judgment-engine';
import { judgeReview } from 'judgment-engine';
import type { DetailPageData, ListRowData } from '../shared/types';

export async function judgeListRow(
  row: ListRowData,
  duplicateFlags: DuplicateFlags,
  aiConfig: AiAdapterConfig
): Promise<JudgmentResult> {
  const input: ReviewInput = {
    review_id: row.review_id,
    review_type: row.review_type,
    content_text: row.content_text,
    photos: row.photos,
    // 목록 단계에서는 '받은 시술' 텍스트를 신뢰성 있게 파싱할 수 없어 예외 없음으로 보수 처리한다.
    procedure: { is_before_after_exempt: false },
    receipt:
      row.review_type === 'RECEIPT'
        ? {
            amount_matches: null,
            date_matches: null,
            hospital_name_matches: null,
            photo_count: row.photos.filter((p) => p.declared_category === 'RECEIPT').length,
            is_app_payment_receipt: false,
          }
        : undefined,
    duplicate_flags: duplicateFlags,
    hospital_requested_takedown: false,
  };

  return judgeReview(input, aiConfig);
}

export async function judgeDetail(
  detail: DetailPageData,
  duplicateFlags: DuplicateFlags,
  aiConfig: AiAdapterConfig
): Promise<JudgmentResult> {
  const input: ReviewInput = {
    review_id: detail.review_id,
    review_type: detail.review_type,
    content_text: detail.content_text,
    photos: detail.photos,
    procedure: detail.procedure,
    receipt: detail.receipt,
    duplicate_flags: duplicateFlags,
    hospital_requested_takedown: detail.hospital_requested_takedown,
  };

  return judgeReview(input, aiConfig);
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- judge
```

Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/background/judge.ts chrome-extension/tests/judge.test.ts
git commit -m "feat: build ReviewInput from parsed list/detail data and call judgeReview"
```

---

### Task 9: 실제 결과 캡처 (`captureResult.ts`)

**무엇을 완료하는가 (쉬운 설명):** 검수 상태 텍스트('승인'/'보류'/'숨김')를 실제 결과로 바꾸고, 모의 판정과 비교해 `is_match`를 계산하는 순수 함수와, 캐시를 갱신하는 함수를 만듭니다.

**Files:**
- Create: `chrome-extension/src/background/captureResult.ts`
- Test: `chrome-extension/tests/captureResult.test.ts`

**Interfaces:**
- Consumes: `CacheStore` (Task 7), `MockJudgment`(`judgment-engine`), `ActualResult`/`ReviewStatusLabel` (Task 2)
- Produces:
  ```ts
  function computeIsMatch(mock: MockJudgment, actual: ActualResult): boolean | null;
  function captureActualResults(rows: Array<{ review_id: string; review_status: ReviewStatusLabel }>, cacheStore: CacheStore): Promise<void>;
  ```
  Task 11(messageHandler), Task 13(list orchestration)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/captureResult.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeIsMatch, captureActualResults } from '../src/background/captureResult';
import { createCacheStore } from '../src/background/cache';
import type { CacheEntry } from '../src/shared/types';

describe('computeIsMatch', () => {
  it('APPROVE_CANDIDATE + 실제 승인 = true', () => {
    expect(computeIsMatch('APPROVE_CANDIDATE', 'APPROVED')).toBe(true);
  });

  it('APPROVE_CANDIDATE + 실제 보류 = false', () => {
    expect(computeIsMatch('APPROVE_CANDIDATE', 'PAUSED')).toBe(false);
  });

  it('AUTO_HOLD_CANDIDATE + 실제 보류/숨김 = true', () => {
    expect(computeIsMatch('AUTO_HOLD_CANDIDATE', 'PAUSED')).toBe(true);
    expect(computeIsMatch('AUTO_HOLD_CANDIDATE', 'HIDDEN')).toBe(true);
  });

  it('AUTO_HOLD_CANDIDATE + 실제 승인 = false', () => {
    expect(computeIsMatch('AUTO_HOLD_CANDIDATE', 'APPROVED')).toBe(false);
  });

  it('NEEDS_REVIEW는 항상 null(판단보류, 집계 제외)', () => {
    expect(computeIsMatch('NEEDS_REVIEW', 'APPROVED')).toBeNull();
    expect(computeIsMatch('NEEDS_REVIEW', 'PAUSED')).toBeNull();
  });
});

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    get: async (keys: string[]) => {
      const r: Record<string, unknown> = {};
      keys.forEach((k) => k in data && (r[k] = data[k]));
      return r;
    },
    set: async (items: Record<string, unknown>) => Object.assign(data, items),
  };
}

function entry(reviewId: string, mock: CacheEntry['result']['mock_judgment']): CacheEntry {
  return {
    review_id: reviewId,
    tier: 'list',
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: { review_id: reviewId, mock_judgment: mock, matched_rules: [], confidence: 1, reasoning: 'ok', ai_invoked: false, photo_results: [] },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

describe('captureActualResults', () => {
  it('상태가 대기가 아니게 바뀐 캐시 항목에 actual_result/is_match를 기록한다', async () => {
    const store = createCacheStore(fakeStorage());
    await store.set(entry('r1', 'APPROVE_CANDIDATE'));

    await captureActualResults([{ review_id: 'r1', review_status: '승인' }], store);

    const updated = await store.get('r1');
    expect(updated?.actual_result).toBe('APPROVED');
    expect(updated?.is_match).toBe(true);
  });

  it('아직 대기 상태인 행은 건드리지 않는다', async () => {
    const store = createCacheStore(fakeStorage());
    await store.set(entry('r1', 'APPROVE_CANDIDATE'));

    await captureActualResults([{ review_id: 'r1', review_status: '대기' }], store);

    const updated = await store.get('r1');
    expect(updated?.actual_result).toBeUndefined();
  });

  it('캐시에 판정 결과가 없는 review_id는 건드리지 않는다', async () => {
    const store = createCacheStore(fakeStorage());
    await captureActualResults([{ review_id: 'unknown', review_status: '승인' }], store);
    expect(await store.get('unknown')).toBeUndefined();
  });

  it('이미 actual_result가 기록된 항목은 다시 기록하지 않는다(중복 방지)', async () => {
    const store = createCacheStore(fakeStorage());
    const withResult = { ...entry('r1', 'APPROVE_CANDIDATE'), actual_result: 'APPROVED' as const, is_match: true };
    await store.set(withResult);

    await captureActualResults([{ review_id: 'r1', review_status: '보류' }], store);

    const updated = await store.get('r1');
    expect(updated?.actual_result).toBe('APPROVED'); // 그대로 유지, '보류'로 덮어쓰지 않음
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- captureResult
```

Expected: FAIL — `Cannot find module '../src/background/captureResult'`

- [ ] **Step 3: captureResult.ts 구현**

`chrome-extension/src/background/captureResult.ts`:
```ts
import type { MockJudgment } from 'judgment-engine';
import type { CacheStore } from './cache';
import type { ActualResult, ReviewStatusLabel } from '../shared/types';

const STATUS_TO_ACTUAL: Partial<Record<ReviewStatusLabel, ActualResult>> = {
  승인: 'APPROVED',
  보류: 'PAUSED',
  숨김: 'HIDDEN',
};

/**
 * NEEDS_REVIEW는 검수자 재량 판단이 필요했던 케이스라 "정답"이 정해져 있지 않으므로
 * 항상 null(판단보류)을 반환하고, 팝업 집계(§4)에서 match/mismatch 계산에서 제외한다.
 */
export function computeIsMatch(mock: MockJudgment, actual: ActualResult): boolean | null {
  if (mock === 'NEEDS_REVIEW') return null;
  if (mock === 'APPROVE_CANDIDATE') return actual === 'APPROVED';
  return actual === 'PAUSED' || actual === 'HIDDEN';
}

export async function captureActualResults(
  rows: Array<{ review_id: string; review_status: ReviewStatusLabel }>,
  cacheStore: CacheStore
): Promise<void> {
  for (const row of rows) {
    const actual = STATUS_TO_ACTUAL[row.review_status];
    if (!actual) continue; // 여전히 '대기'거나 알 수 없는 라벨

    const cached = await cacheStore.get(row.review_id);
    if (!cached || cached.actual_result) continue; // 판정 없음, 또는 이미 캡처됨(중복 방지)

    const isMatch = computeIsMatch(cached.result.mock_judgment, actual);
    await cacheStore.set({
      ...cached,
      actual_result: actual,
      is_match: isMatch ?? undefined,
    });
  }
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- captureResult
```

Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/background/captureResult.ts chrome-extension/tests/captureResult.test.ts
git commit -m "feat: capture actual review status and compute is_match, excluding NEEDS_REVIEW"
```

---

### Task 10: Background 메시지 라우터 (`messageHandler.ts`)

**무엇을 완료하는가 (쉬운 설명):** content script가 보내는 메시지(목록 판정 요청, 상세 판정 요청, 캐시 조회, 상태 캡처)를 받아 앞에서 만든 함수들(judge/cache/captureResult)을 호출하는 순수 라우팅 함수를 만듭니다. `chrome.runtime`은 여기서 직접 다루지 않고, Task 11(`background/index.ts`)에서만 연결합니다.

**Files:**
- Create: `chrome-extension/src/background/messageHandler.ts`
- Test: `chrome-extension/tests/messageHandler.test.ts`

**Interfaces:**
- Consumes: `ExtensionMessage`/`ExtensionResponse` (Task 2), `CacheStore` (Task 7), `judgeListRow`/`judgeDetail` (Task 8), `captureActualResults` (Task 9), `computeListDuplicateFlags` (Task 6), `computeFingerprint` (Task 3)
- Produces: `handleMessage(message: ExtensionMessage, deps: { cacheStore: CacheStore; aiConfig: AiAdapterConfig }): Promise<ExtensionResponse>` — Task 11에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/messageHandler.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleMessage } from '../src/background/messageHandler';
import { createCacheStore } from '../src/background/cache';
import type { ListRowData, DetailPageData } from '../src/shared/types';

vi.mock('judgment-engine', () => ({
  judgeReview: vi.fn(async (input) => ({
    review_id: input.review_id,
    mock_judgment: 'APPROVE_CANDIDATE',
    matched_rules: [],
    confidence: 1,
    reasoning: 'mock',
    ai_invoked: false,
    photo_results: [],
  })),
}));

afterEach(() => vi.clearAllMocks());

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    get: async (keys: string[]) => {
      const r: Record<string, unknown> = {};
      keys.forEach((k) => k in data && (r[k] = data[k]));
      return r;
    },
    set: async (items: Record<string, unknown>) => Object.assign(data, items),
  };
}

const aiConfig = { proxyUrl: 'https://proxy.example/api/judge-content' };

describe('handleMessage', () => {
  it('JUDGE_LIST: 캐시 미스인 행만 판정하고 tier=list로 저장한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const rows: ListRowData[] = [
      {
        review_id: 'r1',
        review_type: 'TICKET_USE',
        content_text: 'ok',
        photos: [],
        review_status: '대기',
        modified_at: '2026-07-20',
        author: '홍**',
      },
    ];

    const response = await handleMessage({ type: 'JUDGE_LIST', rows }, { cacheStore, aiConfig });

    expect(response).toMatchObject({ type: 'JUDGE_LIST_RESULT' });
    if (response.type === 'JUDGE_LIST_RESULT') {
      expect(response.entries[0].tier).toBe('list');
      expect(response.entries[0].result.mock_judgment).toBe('APPROVE_CANDIDATE');
    }
  });

  it('JUDGE_LIST: 지문이 같은 캐시가 이미 있으면 재판정하지 않는다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const rows: ListRowData[] = [
      {
        review_id: 'r1',
        review_type: 'TICKET_USE',
        content_text: 'ok',
        photos: [],
        review_status: '대기',
        modified_at: '2026-07-20',
        author: '홍**',
      },
    ];

    await handleMessage({ type: 'JUDGE_LIST', rows }, { cacheStore, aiConfig });
    const { judgeReview } = await import('judgment-engine');
    vi.mocked(judgeReview).mockClear();

    await handleMessage({ type: 'JUDGE_LIST', rows }, { cacheStore, aiConfig });

    expect(judgeReview).not.toHaveBeenCalled();
  });

  it('JUDGE_DETAIL: tier=detail로 저장한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const detail: DetailPageData = {
      review_id: 'r1',
      review_type: 'TICKET_USE',
      content_text: 'ok',
      photos: [],
      procedure: { is_before_after_exempt: false },
      hospital_requested_takedown: false,
      modified_at: '2026-07-20',
    };

    const response = await handleMessage({ type: 'JUDGE_DETAIL', detail }, { cacheStore, aiConfig });

    expect(response).toMatchObject({ type: 'JUDGE_DETAIL_RESULT' });
    if (response.type === 'JUDGE_DETAIL_RESULT') {
      expect(response.entry.tier).toBe('detail');
    }
  });

  it('GET_CACHE: 캐시에 없으면 entry: null을 반환한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const response = await handleMessage({ type: 'GET_CACHE', reviewId: 'missing' }, { cacheStore, aiConfig });
    expect(response).toEqual({ type: 'CACHE_ENTRY', entry: null });
  });

  it('CAPTURE_STATUS: 캡처 완료 후 CAPTURE_DONE을 반환한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const response = await handleMessage(
      { type: 'CAPTURE_STATUS', rows: [{ review_id: 'r1', review_status: '승인' }] },
      { cacheStore, aiConfig }
    );
    expect(response).toEqual({ type: 'CAPTURE_DONE' });
  });

  it('SAVE_FEEDBACK: 캐시 항목에 reviewer_feedback을 기록한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    await handleMessage({ type: 'JUDGE_DETAIL', detail: {
      review_id: 'r1',
      review_type: 'TICKET_USE',
      content_text: 'ok',
      photos: [],
      procedure: { is_before_after_exempt: false },
      hospital_requested_takedown: false,
      modified_at: '2026-07-20',
    } }, { cacheStore, aiConfig });

    const response = await handleMessage({ type: 'SAVE_FEEDBACK', reviewId: 'r1', feedback: 'AGREE' }, { cacheStore, aiConfig });

    expect(response).toMatchObject({ type: 'FEEDBACK_SAVED', entry: { reviewer_feedback: 'AGREE' } });
  });

  it('SAVE_FEEDBACK: 캐시에 없는 review_id면 entry: null을 반환한다', async () => {
    const cacheStore = createCacheStore(fakeStorage());
    const response = await handleMessage({ type: 'SAVE_FEEDBACK', reviewId: 'missing', feedback: 'AGREE' }, { cacheStore, aiConfig });
    expect(response).toEqual({ type: 'FEEDBACK_SAVED', entry: null });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- messageHandler
```

Expected: FAIL — `Cannot find module '../src/background/messageHandler'`

- [ ] **Step 3: messageHandler.ts 구현**

`chrome-extension/src/background/messageHandler.ts`:
```ts
import type { AiAdapterConfig } from 'judgment-engine';
import type { CacheStore } from './cache';
import { judgeListRow, judgeDetail } from './judge';
import { captureActualResults } from './captureResult';
import { computeListDuplicateFlags } from '../parsing/duplicateFlags';
import { computeFingerprint } from '../shared/fingerprint';
import type { CacheEntry, ExtensionMessage, ExtensionResponse } from '../shared/types';

export interface MessageHandlerDeps {
  cacheStore: CacheStore;
  aiConfig: AiAdapterConfig;
}

export async function handleMessage(message: ExtensionMessage, deps: MessageHandlerDeps): Promise<ExtensionResponse> {
  const { cacheStore, aiConfig } = deps;

  switch (message.type) {
    case 'JUDGE_LIST': {
      const entries: CacheEntry[] = [];
      for (const row of message.rows) {
        const fingerprint = computeFingerprint(row);
        const existing = await cacheStore.get(row.review_id);
        if (existing && existing.fingerprint === fingerprint) {
          entries.push(existing);
          continue;
        }

        const duplicateFlags = computeListDuplicateFlags(row, message.rows);
        const result = await judgeListRow(row, duplicateFlags, aiConfig);
        const entry: CacheEntry = {
          review_id: row.review_id,
          tier: 'list',
          fingerprint,
          duplicate_flags: duplicateFlags,
          result,
          checked_at: new Date().toISOString(),
        };
        await cacheStore.set(entry);
        entries.push(entry);
      }
      return { type: 'JUDGE_LIST_RESULT', entries };
    }

    case 'JUDGE_DETAIL': {
      const existing = await cacheStore.get(message.detail.review_id);
      const duplicateFlags = existing?.duplicate_flags ?? {
        same_customer: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: false,
      };
      const result = await judgeDetail(message.detail, duplicateFlags, aiConfig);
      const entry: CacheEntry = {
        review_id: message.detail.review_id,
        tier: 'detail',
        fingerprint: computeFingerprint(message.detail),
        duplicate_flags: duplicateFlags,
        result,
        checked_at: new Date().toISOString(),
      };
      await cacheStore.set(entry);
      return { type: 'JUDGE_DETAIL_RESULT', entry };
    }

    case 'GET_CACHE': {
      const entry = await cacheStore.get(message.reviewId);
      return { type: 'CACHE_ENTRY', entry: entry ?? null };
    }

    case 'CAPTURE_STATUS': {
      await captureActualResults(message.rows, cacheStore);
      return { type: 'CAPTURE_DONE' };
    }

    case 'SAVE_FEEDBACK': {
      const existing = await cacheStore.get(message.reviewId);
      if (!existing) return { type: 'FEEDBACK_SAVED', entry: null };

      const updated: CacheEntry = { ...existing, reviewer_feedback: message.feedback };
      await cacheStore.set(updated);
      return { type: 'FEEDBACK_SAVED', entry: updated };
    }
  }
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- messageHandler
```

Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/background/messageHandler.ts chrome-extension/tests/messageHandler.test.ts
git commit -m "feat: route extension messages to judge/cache/capture logic"
```

---

### Task 11: Background 진입점 (`background/index.ts`) + proxy URL 설정

**무엇을 완료하는가 (쉬운 설명):** 지금까지 만든 순수 라우터를 실제 `chrome.runtime.onMessage`에 연결합니다. 이 파일 자체는 아주 얇은 글루 코드입니다.

**Files:**
- Modify: `chrome-extension/src/background/index.ts` (Task 1에서 만든 임시 파일 교체)
- Create: `chrome-extension/src/shared/proxyConfig.ts`
- Test: `chrome-extension/tests/proxyConfig.test.ts`

**Interfaces:**
- Consumes: `handleMessage` (Task 10), `createCacheStore` (Task 7)
- Produces: `PROXY_URL` 상수, 실행 중인 background service worker.

- [ ] **Step 1: 실패하는 테스트 작성 (proxyConfig)**

`chrome-extension/tests/proxyConfig.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PROXY_URL } from '../src/shared/proxyConfig';

describe('PROXY_URL', () => {
  it('judge-content 엔드포인트를 가리킨다', () => {
    expect(PROXY_URL).toMatch(/\/api\/judge-content$/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- proxyConfig
```

Expected: FAIL — `Cannot find module '../src/shared/proxyConfig'`

- [ ] **Step 3: proxyConfig.ts 작성 (Task 18에서 실제 배포 URL로 교체 예정)**

`chrome-extension/src/shared/proxyConfig.ts`:
```ts
// Task 18(Vercel 배포)에서 실제 배포 URL로 교체한다. 그 전까지는 로컬 `vercel dev`(기본 3000 포트) 기준.
export const PROXY_URL = 'http://localhost:3000/api/judge-content';
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- proxyConfig
```

Expected: PASS

- [ ] **Step 5: background/index.ts를 실제 글루 코드로 교체**

`chrome-extension/src/background/index.ts`:
```ts
import { handleMessage } from './messageHandler';
import { createCacheStore } from './cache';
import { PROXY_URL } from '../shared/proxyConfig';
import type { ExtensionMessage } from '../shared/types';

const cacheStore = createCacheStore(chrome.storage.local);
const aiConfig = { proxyUrl: PROXY_URL };

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message, { cacheStore, aiConfig }).then(sendResponse);
  return true; // 비동기 응답을 위해 채널을 열어둔다
});
```

- [ ] **Step 6: 기존 스모크 테스트가 여전히 통과하는지 확인 (BACKGROUND_READY export 제거로 인한 회귀 방지)**

`chrome-extension/tests/smoke.test.ts`를 아래로 교체:
```ts
import { describe, it, expect } from 'vitest';
import { PROXY_URL } from '../src/shared/proxyConfig';

describe('smoke', () => {
  it('shared 모듈이 로드된다', () => {
    expect(PROXY_URL).toBeTruthy();
  });
});
```

- [ ] **Step 7: 전체 테스트 + 빌드 재실행**

```bash
cd chrome-extension && npm test && npm run build
```

Expected: 모든 테스트 PASS, 빌드 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add chrome-extension/src/background/index.ts chrome-extension/src/shared/proxyConfig.ts chrome-extension/tests/proxyConfig.test.ts chrome-extension/tests/smoke.test.ts
git commit -m "feat: wire background service worker to message handler via chrome.runtime"
```

---

### Task 12: 목록 배지 렌더링 (`renderBadge.ts`)

**무엇을 완료하는가 (쉬운 설명):** 판정 결과를 받아서 목록 행 옆에 배지(색+텍스트, 클릭 시 근거 툴팁)를 그리는 순수 DOM 함수를 만듭니다.

**Files:**
- Create: `chrome-extension/src/content/list/renderBadge.ts`
- Test: `chrome-extension/tests/renderBadge.test.ts`

**Interfaces:**
- Consumes: `CacheEntry` (Task 2)
- Produces: `renderBadge(rowEl: HTMLElement, entry: CacheEntry): void` — Task 13에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/renderBadge.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderBadge } from '../src/content/list/renderBadge';
import type { CacheEntry } from '../src/shared/types';

let rowEl: HTMLElement;

function entry(overrides: Partial<CacheEntry['result']> = {}): CacheEntry {
  return {
    review_id: 'r1',
    tier: 'list',
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: 'r1',
      mock_judgment: 'APPROVE_CANDIDATE',
      matched_rules: ['rule-a'],
      confidence: 0.9,
      reasoning: '근거 요약',
      ai_invoked: true,
      photo_results: [],
      ...overrides,
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

beforeEach(() => {
  const dom = new JSDOM('<tr><td>1</td></tr>');
  rowEl = dom.window.document.querySelector('tr') as unknown as HTMLElement;
});

describe('renderBadge', () => {
  it('rvw-mock- 접두사가 붙은 배지 요소를 행에 추가한다', () => {
    renderBadge(rowEl, entry());
    const badge = rowEl.querySelector('.rvw-mock-badge');
    expect(badge).not.toBeNull();
  });

  it('판정별 라벨 텍스트를 표시한다', () => {
    renderBadge(rowEl, entry({ mock_judgment: 'AUTO_HOLD_CANDIDATE' }));
    expect(rowEl.querySelector('.rvw-mock-badge')?.textContent).toContain('자동보류후보');
  });

  it('예비 판정(tier=list)은 라벨을 추가로 표시한다', () => {
    renderBadge(rowEl, entry());
    expect(rowEl.querySelector('.rvw-mock-badge')?.textContent).toContain('예비 판정');
  });

  it('같은 행에 다시 렌더링하면 기존 배지를 교체한다(중복 삽입 방지)', () => {
    renderBadge(rowEl, entry());
    renderBadge(rowEl, entry());
    expect(rowEl.querySelectorAll('.rvw-mock-badge').length).toBe(1);
  });

  it('클릭하면 matched_rules/confidence 툴팁을 보여준다', () => {
    renderBadge(rowEl, entry());
    const badge = rowEl.querySelector('.rvw-mock-badge') as HTMLElement;
    badge.click();
    const tooltip = rowEl.querySelector('.rvw-mock-tooltip');
    expect(tooltip?.textContent).toContain('rule-a');
    expect(tooltip?.textContent).toContain('0.9');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- renderBadge
```

Expected: FAIL — `Cannot find module '../src/content/list/renderBadge'`

- [ ] **Step 3: renderBadge.ts 구현**

`chrome-extension/src/content/list/renderBadge.ts`:
```ts
import type { CacheEntry } from '../../shared/types';
import type { MockJudgment } from 'judgment-engine';

const LABELS: Record<MockJudgment, string> = {
  AUTO_HOLD_CANDIDATE: '🟡 자동보류후보',
  APPROVE_CANDIDATE: '🟢 승인후보',
  NEEDS_REVIEW: '⚪ 검토필요',
};

export function renderBadge(rowEl: HTMLElement, entry: CacheEntry): void {
  rowEl.querySelector('.rvw-mock-badge')?.remove();
  rowEl.querySelector('.rvw-mock-tooltip')?.remove();

  const badge = rowEl.ownerDocument.createElement('span');
  badge.className = 'rvw-mock-badge';
  const tierLabel = entry.tier === 'list' ? ' (예비 판정)' : '';
  badge.textContent = `${LABELS[entry.result.mock_judgment]}${tierLabel}`;

  badge.addEventListener('click', () => {
    rowEl.querySelector('.rvw-mock-tooltip')?.remove();
    const tooltip = rowEl.ownerDocument.createElement('div');
    tooltip.className = 'rvw-mock-tooltip';
    tooltip.textContent = `근거: ${entry.result.matched_rules.join(', ') || '없음'} / 신뢰도: ${entry.result.confidence}`;
    rowEl.appendChild(tooltip);
  });

  rowEl.appendChild(badge);
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- renderBadge
```

Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/content/list/renderBadge.ts chrome-extension/tests/renderBadge.test.ts
git commit -m "feat: render judgment badge with rule/confidence tooltip on list rows"
```

---

### Task 13: 목록 페이지 오케스트레이션 (`listPageFlow.ts` + `content/list/index.ts`)

**무엇을 완료하는가 (쉬운 설명):** "이 페이지 모의판정 실행" 버튼을 만들고, 클릭하면 목록을 파싱해서 background에 메시지를 보내고, 응답으로 받은 결과를 배지로 그리는 흐름을 연결합니다. `chrome.runtime.sendMessage`를 인자로 주입받는 순수 오케스트레이션 함수(`runListPageFlow`)로 먼저 만들고, 실제 `chrome.*` 연결은 `index.ts`에서 최소한으로만 합니다.

**Files:**
- Create: `chrome-extension/src/content/list/listPageFlow.ts`
- Create: `chrome-extension/src/content/list/index.ts`
- Test: `chrome-extension/tests/listPageFlow.test.ts`

**Interfaces:**
- Consumes: `parseListPage` (Task 4), `renderBadge` (Task 12), `ExtensionMessage`/`ExtensionResponse` (Task 2)
- Produces: `runListPageFlow(table: HTMLTableElement, sendMessage: (msg) => Promise<ExtensionResponse>): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/listPageFlow.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runListPageFlow } from '../src/content/list/listPageFlow';
import type { ExtensionResponse } from '../src/shared/types';

let table: HTMLTableElement;

// beforeEach로 매 테스트마다 새로 파싱한다 — runListPageFlow가 renderBadge로 테이블을
// 직접 변형하므로(배지 DOM 삽입), beforeAll로 공유하면 테스트 순서에 따라 상태가 오염된다.
beforeEach(() => {
  const html = readFileSync(new URL('./fixtures/list-page.html', import.meta.url), 'utf-8');
  const dom = new JSDOM(html);
  table = dom.window.document.querySelector('table') as HTMLTableElement;
});

function fakeEntry(reviewId: string) {
  return {
    review_id: reviewId,
    tier: 'list' as const,
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: reviewId,
      mock_judgment: 'APPROVE_CANDIDATE' as const,
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [],
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

describe('runListPageFlow', () => {
  it('JUDGE_LIST 메시지를 보내고 응답받은 항목마다 배지를 렌더링한다', async () => {
    const sendMessage = vi.fn(
      async (): Promise<ExtensionResponse> => ({
        type: 'JUDGE_LIST_RESULT',
        entries: [fakeEntry('1001'), fakeEntry('1003')],
      })
    );

    await runListPageFlow(table, sendMessage);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'JUDGE_LIST', rows: expect.arrayContaining([expect.objectContaining({ review_id: '1001' })]) })
    );
    expect(table.querySelectorAll('.rvw-mock-badge').length).toBe(2);
  });

  it('CAPTURE_STATUS 메시지도 함께 보낸다(현재 페이지 전체 행의 상태)', async () => {
    const sendMessage = vi.fn(async (msg: any): Promise<ExtensionResponse> => {
      if (msg.type === 'JUDGE_LIST') return { type: 'JUDGE_LIST_RESULT', entries: [] };
      return { type: 'CAPTURE_DONE' };
    });

    await runListPageFlow(table, sendMessage);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CAPTURE_STATUS',
        rows: expect.arrayContaining([expect.objectContaining({ review_id: '1002', review_status: '승인' })]),
      })
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- listPageFlow
```

Expected: FAIL — `Cannot find module '../src/content/list/listPageFlow'`

- [ ] **Step 3: listPageFlow.ts 구현**

`chrome-extension/src/content/list/listPageFlow.ts`:
```ts
import { parseListPage, buildHeaderIndex } from '../../parsing/listParser';
import { renderBadge } from './renderBadge';
import type { ExtensionMessage, ExtensionResponse, ReviewStatusLabel } from '../../shared/types';

const KNOWN_STATUS_LABELS: ReviewStatusLabel[] = ['대기', '승인', '보류', '숨김'];
const DETAIL_LINK_PATTERN = /\/posts\/reviews\/detail\/(\d+)/;

function scrapeAllRowStatuses(table: HTMLTableElement): Array<{ review_id: string; review_status: ReviewStatusLabel }> {
  const statusIndex = buildHeaderIndex(table)['검수 상태'];
  if (statusIndex === undefined) return [];

  return Array.from(table.querySelectorAll('tbody tr')).flatMap((row) => {
    const link = row.querySelector('a[href*="/posts/reviews/detail/"]');
    const match = link?.getAttribute('href')?.match(DETAIL_LINK_PATTERN);
    const status = row.cells[statusIndex]?.textContent?.trim() as ReviewStatusLabel;
    if (!match || !KNOWN_STATUS_LABELS.includes(status)) return [];
    return [{ review_id: match[1], review_status: status }];
  });
}

/**
 * "이 페이지 모의판정 실행" 클릭 시 실행되는 순수 오케스트레이션.
 * chrome.runtime.sendMessage 자체는 index.ts에서 주입한다.
 */
export async function runListPageFlow(
  table: HTMLTableElement,
  sendMessage: (message: ExtensionMessage) => Promise<ExtensionResponse>
): Promise<void> {
  const rows = parseListPage(table);

  const judgeResponse = await sendMessage({ type: 'JUDGE_LIST', rows });
  if (judgeResponse.type === 'JUDGE_LIST_RESULT') {
    for (const entry of judgeResponse.entries) {
      const link = table.querySelector(`a[href*="/posts/reviews/detail/${entry.review_id}"]`);
      const rowEl = link?.closest('tr');
      if (rowEl) renderBadge(rowEl as HTMLElement, entry);
    }
  }

  const allStatuses = scrapeAllRowStatuses(table);
  if (allStatuses.length > 0) {
    await sendMessage({ type: 'CAPTURE_STATUS', rows: allStatuses });
  }
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- listPageFlow
```

Expected: PASS (2 tests)

- [ ] **Step 5: content/list/index.ts 작성 (chrome.* 글루, "이 페이지 모의판정 실행" 버튼 삽입)**

`chrome-extension/src/content/list/index.ts`:
```ts
import { runListPageFlow } from './listPageFlow';
import type { ExtensionMessage, ExtensionResponse } from '../../shared/types';

function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message);
}

function insertTriggerButton(table: HTMLTableElement) {
  if (document.querySelector('.rvw-mock-trigger')) return;

  const button = document.createElement('button');
  button.className = 'rvw-mock-trigger';
  button.textContent = '이 페이지 모의판정 실행';
  button.addEventListener('click', () => {
    button.disabled = true;
    runListPageFlow(table, sendMessage).finally(() => {
      button.disabled = false;
    });
  });

  table.parentElement?.insertBefore(button, table);
}

const table = document.querySelector('table');
if (table) insertTriggerButton(table as HTMLTableElement);
```

- [ ] **Step 6: 전체 테스트 + 빌드 재실행**

```bash
cd chrome-extension && npm test && npm run build
```

Expected: 모든 테스트 PASS, 빌드 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add chrome-extension/src/content/list/listPageFlow.ts chrome-extension/src/content/list/index.ts chrome-extension/tests/listPageFlow.test.ts
git commit -m "feat: wire list-page trigger button to judgment + status-capture flow"
```

---

### Task 14: 상세 패널 렌더링 (`renderPanel.ts`)

**무엇을 완료하는가 (쉬운 설명):** 상세 화면 사이드 패널을 그리는 순수 함수를 만듭니다. 캐시가 없으면 "정밀 판정하기" 버튼만, 있으면 결과+동의/비동의 버튼과 함께 재판정 버튼("정밀 판정하기" 또는 "다시 판정하기")을 항상 보여줍니다 — 스펙 §3.4 "사용자가 언제든 수동으로 다시 판정 가능(지문이 같아도 강제 재호출)" 요구사항 때문에, 이미 tier=detail 결과가 있어도 버튼이 사라지면 안 됩니다.

**Files:**
- Create: `chrome-extension/src/content/detail/renderPanel.ts`
- Test: `chrome-extension/tests/renderPanel.test.ts`

**Interfaces:**
- Consumes: `CacheEntry` (Task 2)
- Produces:
  ```ts
  function renderPanel(
    container: HTMLElement,
    entry: CacheEntry | null,
    handlers: { onJudge: () => void; onFeedback: (feedback: 'AGREE' | 'DISAGREE') => void }
  ): void;
  ```
  Task 15에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/renderPanel.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderPanel } from '../src/content/detail/renderPanel';
import type { CacheEntry } from '../src/shared/types';

let container: HTMLElement;

function entry(tier: CacheEntry['tier']): CacheEntry {
  return {
    review_id: 'r1',
    tier,
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: 'r1',
      mock_judgment: 'APPROVE_CANDIDATE',
      matched_rules: ['rule-a'],
      confidence: 0.9,
      reasoning: '근거 요약',
      ai_invoked: true,
      photo_results: [],
    },
    checked_at: '2026-07-20T00:00:00Z',
  };
}

beforeEach(() => {
  const dom = new JSDOM('<div id="panel"></div>');
  container = dom.window.document.getElementById('panel') as HTMLElement;
});

describe('renderPanel', () => {
  it('캐시가 없으면 정밀 판정하기 버튼을 보여준다', () => {
    const onJudge = vi.fn();
    renderPanel(container, null, { onJudge, onFeedback: vi.fn() });

    const button = container.querySelector('.rvw-mock-judge-button') as HTMLElement;
    expect(button?.textContent).toContain('정밀 판정하기');
    button.click();
    expect(onJudge).toHaveBeenCalled();
  });

  it('tier=list 캐시만 있으면 예비 판정 표시와 함께 정밀 판정하기 버튼도 보여준다', () => {
    renderPanel(container, entry('list'), { onJudge: vi.fn(), onFeedback: vi.fn() });
    expect(container.textContent).toContain('예비 판정');
    expect(container.querySelector('.rvw-mock-judge-button')).not.toBeNull();
  });

  it('tier=detail 캐시가 있으면 결과와 함께 "다시 판정하기" 버튼도 보여준다(수동 강제 재호출)', () => {
    const onJudge = vi.fn();
    renderPanel(container, entry('detail'), { onJudge, onFeedback: vi.fn() });
    const button = container.querySelector('.rvw-mock-judge-button') as HTMLElement;
    expect(button?.textContent).toContain('다시 판정하기');
    expect(container.textContent).toContain('rule-a');
    button.click();
    expect(onJudge).toHaveBeenCalled();
  });

  it('동의/비동의 버튼 클릭 시 onFeedback을 호출한다', () => {
    const onFeedback = vi.fn();
    renderPanel(container, entry('detail'), { onJudge: vi.fn(), onFeedback });

    (container.querySelector('.rvw-mock-feedback-agree') as HTMLElement).click();
    expect(onFeedback).toHaveBeenCalledWith('AGREE');

    (container.querySelector('.rvw-mock-feedback-disagree') as HTMLElement).click();
    expect(onFeedback).toHaveBeenCalledWith('DISAGREE');
  });

  it('다시 렌더링하면 이전 내용을 교체한다', () => {
    renderPanel(container, null, { onJudge: vi.fn(), onFeedback: vi.fn() });
    renderPanel(container, entry('detail'), { onJudge: vi.fn(), onFeedback: vi.fn() });
    expect(container.querySelectorAll('.rvw-mock-panel').length).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- renderPanel
```

Expected: FAIL — `Cannot find module '../src/content/detail/renderPanel'`

- [ ] **Step 3: renderPanel.ts 구현**

`chrome-extension/src/content/detail/renderPanel.ts`:
```ts
import type { CacheEntry } from '../../shared/types';
import type { MockJudgment } from 'judgment-engine';

const LABELS: Record<MockJudgment, string> = {
  AUTO_HOLD_CANDIDATE: '🟡 자동보류후보',
  APPROVE_CANDIDATE: '🟢 승인후보',
  NEEDS_REVIEW: '⚪ 검토필요',
};

export interface PanelHandlers {
  onJudge: () => void;
  onFeedback: (feedback: 'AGREE' | 'DISAGREE') => void;
}

export function renderPanel(container: HTMLElement, entry: CacheEntry | null, handlers: PanelHandlers): void {
  container.querySelector('.rvw-mock-panel')?.remove();

  const panel = container.ownerDocument.createElement('div');
  panel.className = 'rvw-mock-panel';

  if (entry) {
    const tierNote = entry.tier === 'list' ? ' (예비 판정 — 목록 기준)' : '';
    const summary = container.ownerDocument.createElement('p');
    summary.textContent = `${LABELS[entry.result.mock_judgment]}${tierNote} / 근거: ${entry.result.matched_rules.join(', ') || '없음'} / 신뢰도: ${entry.result.confidence}`;
    panel.appendChild(summary);

    const agree = container.ownerDocument.createElement('button');
    agree.className = 'rvw-mock-feedback-agree';
    agree.textContent = '동의';
    agree.addEventListener('click', () => handlers.onFeedback('AGREE'));
    panel.appendChild(agree);

    const disagree = container.ownerDocument.createElement('button');
    disagree.className = 'rvw-mock-feedback-disagree';
    disagree.textContent = '비동의';
    disagree.addEventListener('click', () => handlers.onFeedback('DISAGREE'));
    panel.appendChild(disagree);
  }

  // 재판정 버튼은 항상 보여준다 — tier=detail이어도 사라지면 안 됨(§3.4 "지문이 같아도 강제 재호출" 요구사항).
  const judgeButton = container.ownerDocument.createElement('button');
  judgeButton.className = 'rvw-mock-judge-button';
  judgeButton.textContent = entry?.tier === 'detail' ? '다시 판정하기' : '정밀 판정하기';
  judgeButton.addEventListener('click', handlers.onJudge);
  panel.appendChild(judgeButton);

  container.appendChild(panel);
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- renderPanel
```

Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/src/content/detail/renderPanel.ts chrome-extension/tests/renderPanel.test.ts
git commit -m "feat: render detail judgment panel with tier-aware re-judge button"
```

---

### Task 15: 상세 페이지 오케스트레이션 (`detailPageFlow.ts` + `content/detail/index.ts`)

**무엇을 완료하는가 (쉬운 설명):** 상세 화면 진입 시 캐시를 조회해서 패널을 그리고, "정밀 판정하기" 버튼을 누르면 상세 데이터를 파싱해 background에 보내고 결과로 패널을 갱신하는 흐름을 연결합니다.

**Files:**
- Create: `chrome-extension/src/content/detail/detailPageFlow.ts`
- Create: `chrome-extension/src/content/detail/index.ts`
- Test: `chrome-extension/tests/detailPageFlow.test.ts`

**Interfaces:**
- Consumes: `parseDetailPage` (Task 5), `renderPanel` (Task 14), `ExtensionMessage`/`ExtensionResponse` (Task 2)
- Produces: `runDetailPageFlow(root: HTMLElement, panelContainer: HTMLElement, reviewId: string, sendMessage): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/detailPageFlow.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runDetailPageFlow } from '../src/content/detail/detailPageFlow';
import type { ExtensionResponse } from '../src/shared/types';

let root: HTMLElement;
let panelContainer: HTMLElement;

beforeEach(() => {
  const html = readFileSync(new URL('./fixtures/detail-page.html', import.meta.url), 'utf-8');
  const dom = new JSDOM(`<div id="panel-container"></div>${html}`);
  root = dom.window.document.querySelector('.review-detail') as HTMLElement;
  panelContainer = dom.window.document.getElementById('panel-container') as HTMLElement;
});

describe('runDetailPageFlow', () => {
  it('진입 시 GET_CACHE로 조회해 패널을 렌더링한다', async () => {
    const sendMessage = vi.fn(async (): Promise<ExtensionResponse> => ({ type: 'CACHE_ENTRY', entry: null }));

    await runDetailPageFlow(root, panelContainer, '1001', sendMessage);

    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_CACHE', reviewId: '1001' });
    expect(panelContainer.querySelector('.rvw-mock-judge-button')).not.toBeNull();
  });

  it('정밀 판정하기 클릭 시 상세 데이터를 파싱해 JUDGE_DETAIL을 보낸다', async () => {
    const sendMessage = vi.fn(async (msg: any): Promise<ExtensionResponse> => {
      if (msg.type === 'GET_CACHE') return { type: 'CACHE_ENTRY', entry: null };
      return {
        type: 'JUDGE_DETAIL_RESULT',
        entry: {
          review_id: '1001',
          tier: 'detail',
          fingerprint: 'fp',
          duplicate_flags: {
            same_customer: false,
            same_written_at: false,
            same_procedure_event: false,
            same_content: false,
            same_photo: false,
            same_receipt: false,
          },
          result: { review_id: '1001', mock_judgment: 'APPROVE_CANDIDATE', matched_rules: [], confidence: 1, reasoning: 'ok', ai_invoked: true, photo_results: [] },
          checked_at: '2026-07-20T00:00:00Z',
        },
      };
    });

    await runDetailPageFlow(root, panelContainer, '1001', sendMessage);
    (panelContainer.querySelector('.rvw-mock-judge-button') as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'JUDGE_DETAIL', detail: expect.objectContaining({ review_id: '1001' }) }));
  });

  it('동의 버튼 클릭 시 SAVE_FEEDBACK을 보낸다', async () => {
    const detailEntry = {
      review_id: '1001',
      tier: 'detail' as const,
      fingerprint: 'fp',
      duplicate_flags: {
        same_customer: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: false,
      },
      result: { review_id: '1001', mock_judgment: 'APPROVE_CANDIDATE' as const, matched_rules: [], confidence: 1, reasoning: 'ok', ai_invoked: true, photo_results: [] },
      checked_at: '2026-07-20T00:00:00Z',
    };
    const sendMessage = vi.fn(async (msg: any): Promise<ExtensionResponse> => {
      if (msg.type === 'GET_CACHE') return { type: 'CACHE_ENTRY', entry: detailEntry };
      if (msg.type === 'SAVE_FEEDBACK') return { type: 'FEEDBACK_SAVED', entry: { ...detailEntry, reviewer_feedback: msg.feedback } };
      throw new Error('unexpected message');
    });

    await runDetailPageFlow(root, panelContainer, '1001', sendMessage);
    (panelContainer.querySelector('.rvw-mock-feedback-agree') as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_FEEDBACK', reviewId: '1001', feedback: 'AGREE' });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- detailPageFlow
```

Expected: FAIL — `Cannot find module '../src/content/detail/detailPageFlow'`

- [ ] **Step 3: detailPageFlow.ts 구현**

`chrome-extension/src/content/detail/detailPageFlow.ts`:
```ts
import { parseDetailPage } from '../../parsing/detailParser';
import { renderPanel } from './renderPanel';
import type { CacheEntry, ExtensionMessage, ExtensionResponse } from '../../shared/types';

export async function runDetailPageFlow(
  root: HTMLElement,
  panelContainer: HTMLElement,
  reviewId: string,
  sendMessage: (message: ExtensionMessage) => Promise<ExtensionResponse>
): Promise<void> {
  const cacheResponse = await sendMessage({ type: 'GET_CACHE', reviewId });
  let currentEntry: CacheEntry | null = cacheResponse.type === 'CACHE_ENTRY' ? cacheResponse.entry : null;

  const draw = () => {
    renderPanel(panelContainer, currentEntry, {
      onJudge: async () => {
        const detail = parseDetailPage(root, reviewId);
        const response = await sendMessage({ type: 'JUDGE_DETAIL', detail });
        if (response.type === 'JUDGE_DETAIL_RESULT') {
          currentEntry = response.entry;
          draw();
        }
      },
      onFeedback: async (feedback) => {
        const response = await sendMessage({ type: 'SAVE_FEEDBACK', reviewId, feedback });
        if (response.type === 'FEEDBACK_SAVED' && response.entry) {
          currentEntry = response.entry;
          draw();
        }
      },
    });
  };

  draw();
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- detailPageFlow
```

Expected: PASS (3 tests)

- [ ] **Step 5: content/detail/index.ts 작성**

`chrome-extension/src/content/detail/index.ts`:
```ts
import { runDetailPageFlow } from './detailPageFlow';
import type { ExtensionMessage, ExtensionResponse } from '../../shared/types';

function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message);
}

function extractReviewId(): string | null {
  const match = window.location.pathname.match(/\/posts\/reviews\/detail\/(\d+)/);
  return match ? match[1] : null;
}

const root = document.querySelector('.review-detail') as HTMLElement | null;
const reviewId = extractReviewId();

if (root && reviewId) {
  const panelContainer = document.createElement('div');
  panelContainer.className = 'rvw-mock-panel-container';
  root.parentElement?.insertBefore(panelContainer, root);
  runDetailPageFlow(root, panelContainer, reviewId, sendMessage);
}
```

- [ ] **Step 6: 전체 테스트 + 빌드 재실행**

```bash
cd chrome-extension && npm test && npm run build
```

Expected: 모든 테스트 PASS, 빌드 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add chrome-extension/src/content/detail/detailPageFlow.ts chrome-extension/src/content/detail/index.ts chrome-extension/tests/detailPageFlow.test.ts
git commit -m "feat: wire detail-page panel to cache lookup and precise re-judgment"
```

---

### Task 16: 팝업 요약 (`summarize.ts` + `popup/main.ts`)

**무엇을 완료하는가 (쉬운 설명):** 저장된 모든 판정 결과를 읽어서 "판정 분포 + 일치율(NEEDS_REVIEW 제외) + 최근 불일치 사례"를 계산하는 순수 함수와, 그걸 팝업 화면에 그리는 코드를 만듭니다.

**Files:**
- Create: `chrome-extension/src/popup/summarize.ts`
- Modify: `chrome-extension/src/popup/main.ts`
- Modify: `chrome-extension/src/popup/index.html`
- Test: `chrome-extension/tests/summarize.test.ts`

**Interfaces:**
- Consumes: `CacheEntry` (Task 2)
- Produces:
  ```ts
  interface AccuracySummary {
    total_judged: number;
    distribution: Record<MockJudgment, number>;
    matched: number;
    mismatched: number;
    match_rate: number | null;
    recent_mismatches: Array<{ review_id: string; mock_judgment: MockJudgment; actual_result: ActualResult }>;
  }
  function summarize(entries: CacheEntry[]): AccuracySummary;
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`chrome-extension/tests/summarize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { summarize } from '../src/popup/summarize';
import type { CacheEntry } from '../src/shared/types';

function entry(overrides: Partial<CacheEntry> & Partial<CacheEntry['result']> = {}): CacheEntry {
  return {
    review_id: overrides.review_id ?? 'r1',
    tier: 'list',
    fingerprint: 'fp',
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    result: {
      review_id: overrides.review_id ?? 'r1',
      mock_judgment: overrides.mock_judgment ?? 'APPROVE_CANDIDATE',
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [],
    },
    checked_at: '2026-07-20T00:00:00Z',
    actual_result: overrides.actual_result,
    is_match: overrides.is_match,
  };
}

describe('summarize', () => {
  it('판정 유형별 건수를 집계한다', () => {
    const summary = summarize([
      entry({ review_id: 'r1', mock_judgment: 'APPROVE_CANDIDATE' }),
      entry({ review_id: 'r2', mock_judgment: 'AUTO_HOLD_CANDIDATE' }),
      entry({ review_id: 'r3', mock_judgment: 'NEEDS_REVIEW' }),
    ]);
    expect(summary.distribution).toEqual({ APPROVE_CANDIDATE: 1, AUTO_HOLD_CANDIDATE: 1, NEEDS_REVIEW: 1 });
    expect(summary.total_judged).toBe(3);
  });

  it('is_match true/false로 일치/불일치를 센다', () => {
    const summary = summarize([
      entry({ review_id: 'r1', is_match: true, actual_result: 'APPROVED' }),
      entry({ review_id: 'r2', is_match: false, actual_result: 'PAUSED' }),
    ]);
    expect(summary.matched).toBe(1);
    expect(summary.mismatched).toBe(1);
    expect(summary.match_rate).toBe(0.5);
  });

  it('is_match가 없는(아직 캡처 안 된) 항목은 일치율 계산에서 제외한다', () => {
    const summary = summarize([entry({ review_id: 'r1' })]);
    expect(summary.matched).toBe(0);
    expect(summary.mismatched).toBe(0);
    expect(summary.match_rate).toBeNull();
  });

  it('불일치 사례를 review_id/mock_judgment/actual_result와 함께 담는다', () => {
    const summary = summarize([entry({ review_id: 'r1', is_match: false, actual_result: 'PAUSED', mock_judgment: 'APPROVE_CANDIDATE' })]);
    expect(summary.recent_mismatches).toEqual([{ review_id: 'r1', mock_judgment: 'APPROVE_CANDIDATE', actual_result: 'PAUSED' }]);
  });

  it('최근 불일치 사례는 최대 10건까지만 담는다', () => {
    const entries = Array.from({ length: 15 }, (_, i) => entry({ review_id: `r${i}`, is_match: false, actual_result: 'PAUSED' }));
    const summary = summarize(entries);
    expect(summary.recent_mismatches.length).toBe(10);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd chrome-extension && npm test -- summarize
```

Expected: FAIL — `Cannot find module '../src/popup/summarize'`

- [ ] **Step 3: summarize.ts 구현**

`chrome-extension/src/popup/summarize.ts`:
```ts
import type { MockJudgment } from 'judgment-engine';
import type { ActualResult, CacheEntry } from '../shared/types';

export interface AccuracySummary {
  total_judged: number;
  distribution: Record<MockJudgment, number>;
  matched: number;
  mismatched: number;
  match_rate: number | null;
  recent_mismatches: Array<{ review_id: string; mock_judgment: MockJudgment; actual_result: ActualResult }>;
}

export function summarize(entries: CacheEntry[]): AccuracySummary {
  const distribution: Record<MockJudgment, number> = {
    AUTO_HOLD_CANDIDATE: 0,
    APPROVE_CANDIDATE: 0,
    NEEDS_REVIEW: 0,
  };
  let matched = 0;
  let mismatched = 0;
  const recentMismatches: AccuracySummary['recent_mismatches'] = [];

  for (const entry of entries) {
    distribution[entry.result.mock_judgment]++;

    if (entry.is_match === true) {
      matched++;
    } else if (entry.is_match === false) {
      mismatched++;
      recentMismatches.push({
        review_id: entry.review_id,
        mock_judgment: entry.result.mock_judgment,
        actual_result: entry.actual_result!,
      });
    }
  }

  const capturable = matched + mismatched;

  return {
    total_judged: entries.length,
    distribution,
    matched,
    mismatched,
    match_rate: capturable > 0 ? matched / capturable : null,
    recent_mismatches: recentMismatches.slice(-10),
  };
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd chrome-extension && npm test -- summarize
```

Expected: PASS (5 tests)

- [ ] **Step 5: popup/index.html 갱신**

`chrome-extension/src/popup/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>후기 모의 검수</title>
  </head>
  <body>
    <div id="app">로딩 중...</div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: popup/main.ts를 실제 렌더링 코드로 교체**

`chrome-extension/src/popup/main.ts`:
```ts
import { createCacheStore } from '../background/cache';
import { summarize } from './summarize';

async function render() {
  const cacheStore = createCacheStore(chrome.storage.local);
  const entries = await cacheStore.getAll();
  const summary = summarize(entries);

  const app = document.getElementById('app')!;
  app.innerHTML = `
    <p>오늘까지 판정: ${summary.total_judged}건</p>
    <ul>
      <li>승인후보: ${summary.distribution.APPROVE_CANDIDATE}</li>
      <li>자동보류후보: ${summary.distribution.AUTO_HOLD_CANDIDATE}</li>
      <li>검토필요: ${summary.distribution.NEEDS_REVIEW}</li>
    </ul>
    <p>일치율(검토필요 제외): ${summary.match_rate === null ? '아직 데이터 없음' : `${Math.round(summary.match_rate * 100)}% (${summary.matched}/${summary.matched + summary.mismatched})`}</p>
    <p>최근 불일치: ${summary.recent_mismatches.length}건</p>
  `;
}

render();
```

- [ ] **Step 7: 전체 테스트 + 빌드 재실행**

```bash
cd chrome-extension && npm test && npm run build
```

Expected: 모든 테스트 PASS, 빌드 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add chrome-extension/src/popup/summarize.ts chrome-extension/src/popup/main.ts chrome-extension/src/popup/index.html chrome-extension/tests/summarize.test.ts
git commit -m "feat: summarize judgment distribution and match rate in popup"
```

---

### Task 17: 팝업 화면 수동 확인

**무엇을 완료하는가 (쉬운 설명):** 지금까지 만든 확장 프로그램을 크롬에 직접 로드해서, 최소한 팝업이 에러 없이 뜨는지 눈으로 확인합니다(로그인된 실제 사이트 접속은 Task 19에서 함).

**Files:** 없음 (수동 확인만)

- [ ] **Step 1: 빌드**

```bash
cd chrome-extension && npm run build
```

- [ ] **Step 2: 크롬에 로드**

`chrome://extensions` → "개발자 모드" 켜기 → "압축해제된 확장 프로그램을 로드합니다" → `chrome-extension/dist` 폴더 선택

Expected: 에러 없이 로드되고, 툴바에 확장 아이콘이 나타남

- [ ] **Step 3: 팝업 클릭해서 확인**

Expected: "오늘까지 판정: 0건", "일치율(검토필요 제외): 아직 데이터 없음" 텍스트가 보임 (아직 아무 데이터도 없으므로 정상)

- [ ] **Step 4: 문제 없으면 다음 태스크로. 콘솔 에러가 있으면 여기서 멈추고 원인을 고친 뒤 다시 확인.**

---

### Task 18: Vercel CORS 설정 (`chrome-extension://` 오리진 허용)

**무엇을 완료하는가 (쉬운 설명):** 크롬 확장이 Vercel에 배포된 프록시를 호출할 수 있도록, 프록시가 `chrome-extension://<확장 ID>` 오리진의 요청을 허용하게 만듭니다.

**Files:**
- Modify: `proxy/api/judge-content.ts:55-65` (CORS 헤더 + OPTIONS 프리플라이트 추가)
- Modify: `proxy/tests/handler.test.ts:1` (import에 `afterEach` 추가), `proxy/tests/handler.test.ts:4-9` (fakeRes에 setHeader/end 추가), 파일 끝(88번째 줄 이후)에 CORS 테스트 추가
- Modify: `proxy/.env.example:1` (`ALLOWED_EXTENSION_ORIGIN` 항목 추가)

**Interfaces:**
- Consumes: 기존 `createHandler(client)` (proxy, 변경 없음 유지)
- Produces: OPTIONS 프리플라이트 응답 + `Access-Control-Allow-Origin` 헤더

- [ ] **Step 1: 실패하는 테스트 작성 (fakeRes에 setHeader 추가 + 새 테스트)**

`proxy/tests/handler.test.ts`의 `fakeRes` 함수(4-9번째 줄)를 아래로 교체:
```ts
function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
}
```

파일 끝(88번째 줄, `});` 다음)에 아래 테스트 추가:
```ts

describe('judge-content handler CORS', () => {
  const originalEnv = process.env.ALLOWED_EXTENSION_ORIGIN;

  afterEach(() => {
    process.env.ALLOWED_EXTENSION_ORIGIN = originalEnv;
  });

  it('ALLOWED_EXTENSION_ORIGIN이 설정되어 있으면 Access-Control-Allow-Origin을 반환한다', async () => {
    process.env.ALLOWED_EXTENSION_ORIGIN = 'chrome-extension://abc123';
    const handler = createHandler({ models: { generateContent: vi.fn() } } as any);
    const req: any = { method: 'OPTIONS' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'chrome-extension://abc123');
  });

  it('OPTIONS 프리플라이트는 204로 즉시 응답한다', async () => {
    process.env.ALLOWED_EXTENSION_ORIGIN = 'chrome-extension://abc123';
    const handler = createHandler({ models: { generateContent: vi.fn() } } as any);
    const req: any = { method: 'OPTIONS' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(204);
  });
});
```

파일 상단 import에 `afterEach` 추가 (1번째 줄 교체):
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd proxy && npm test -- handler
```

Expected: FAIL — CORS 관련 새 테스트 2건 실패 (`setHeader`가 호출되지 않음, 상태 204 없음)

- [ ] **Step 3: proxy/api/judge-content.ts에 CORS 처리 추가**

`createHandler` 함수(기존 55번째 줄)의 반환 함수 시작 부분을 아래로 교체:
```ts
export function createHandler(client: GeminiLike) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const allowedOrigin = process.env.ALLOWED_EXTENSION_ORIGIN;
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }
```

(이후 기존 로직은 그대로 유지)

- [ ] **Step 4: 테스트 재실행**

```bash
cd proxy && npm test -- handler
```

Expected: PASS (기존 5건 + 신규 2건 = 7건)

- [ ] **Step 5: .env.example에 새 환경변수 문서화**

`proxy/.env.example`:
```
GEMINI_API_KEY=xxxxx
ALLOWED_EXTENSION_ORIGIN=chrome-extension://your-extension-id-here
```

- [ ] **Step 6: 커밋**

```bash
git add proxy/api/judge-content.ts proxy/tests/handler.test.ts proxy/.env.example
git commit -m "feat: allow chrome-extension origin via CORS for judge-content proxy"
```

- [ ] **Step 7: (수동, 사용자 확인 필요) Vercel 배포 및 환경변수 설정**

이 단계는 사용자의 Vercel 계정 접근이 필요해 에이전트가 대신 실행할 수 없다. 사용자에게 아래를 요청한다:
1. `cd proxy && vercel --prod`로 배포 (또는 Vercel 대시보드에서 GitHub 연동 배포)
2. Vercel 프로젝트 환경변수에 `GEMINI_API_KEY`(이미 로컬에 있던 값)와 `ALLOWED_EXTENSION_ORIGIN`(크롬에 확장을 로드한 뒤 `chrome://extensions`에서 확인한 확장 ID로 `chrome-extension://<ID>` 형태) 설정
3. 배포된 실제 URL을 `chrome-extension/src/shared/proxyConfig.ts`의 `PROXY_URL`에 반영

---

### Task 19: 실사용 스모크 테스트 (수동, 실제 로그인 필요)

**무엇을 완료하는가 (쉬운 설명):** 실제 `admin.fastlane.kr`에 로그인한 뒤, 지금까지 만든 확장 프로그램이 실제 화면에서 배지/패널을 제대로 그리는지 한 번 확인합니다. 이 태스크는 자동화된 테스트가 아니라 사람이(또는 Playwright/MCP로) 직접 확인하는 체크리스트이며, 민감한 실사용 고객 데이터를 캡처/기록하지 않는다.

**Files:** 없음 (코드 변경 없음, 관찰 및 선택자 조정만)

- [ ] **Step 1: 최신 빌드로 확장 프로그램 리로드**

```bash
cd chrome-extension && npm run build
```

`chrome://extensions`에서 리로드 버튼 클릭.

- [ ] **Step 2: `admin.fastlane.kr/posts/reviews`에 실제 로그인 후 접속**

Expected: "이 페이지 모의판정 실행" 버튼이 표에 삽입돼 보임

- [ ] **Step 3: 버튼 클릭 후 대기 상태 행에 배지가 그려지는지 확인**

Expected: 배지가 그려짐. **만약 배지가 안 그려지면**, `parseListPage`(Task 4)가 가정한 컬럼 헤더 텍스트/링크 패턴이 실제 화면과 다르다는 뜻 — 브라우저 개발자도구로 실제 `<thead>`/`<a>` 구조를 확인하고 `chrome-extension/src/parsing/listParser.ts`의 헤더 라벨/셀렉터만 수정한다(다른 파일은 건드릴 필요 없음, 계층 분리 덕분).

- [ ] **Step 4: 상세 화면 진입 후 패널이 그려지는지, "정밀 판정하기"가 동작하는지 확인**

Expected: 패널이 보이고 클릭 시 결과가 갱신됨. 안 되면 Task 5의 `parseDetailPage` 라벨/셀렉터를 실제 화면에 맞게 조정한다.

- [ ] **Step 5: 실제로 승인/보류 처리 후 목록으로 돌아와 "이 페이지 모의판정 실행"을 다시 클릭해, `is_match`가 팝업에 반영되는지 확인**

Expected: 팝업의 "일치율" 수치가 갱신됨

- [ ] **Step 6: 확인 과정에서 본 실제 고객 데이터(이름, 전화번호, 후기 원문 등)는 어떤 문서에도 기록하지 않는다. 구조적으로 조정이 필요했던 선택자 변경 사항만 커밋한다.**

```bash
git add chrome-extension/src/parsing
git commit -m "fix: adjust list/detail selectors to match real admin markup"
```

(선택자 변경이 없었다면 이 커밋은 생략)

---

## 마일스톤 ↔ 태스크 매핑 (스펙 §8 참고)

| 스펙 마일스톤 | 태스크 |
|---|---|
| M1 | Task 1 |
| M2 | Task 4, 5 |
| M3 | Task 6, 7, 8, 9, 10, 11 |
| M4 | Task 12, 13, 14, 15 |
| M5 | Task 9(포함), 16 |
| M6 | Task 17, 18, 19 |
