# 설계: 후기 모의 검수 크롬 확장 프로그램 골격 (chrome-extension)

- 문서 버전: v1.0
- 작성일: 2026-07-27
- 상위 문서: [PRD_후기모의검수_크롬확장.md](../../../PRD_후기모의검수_크롬확장.md)
- 선행 문서: [2026-07-23-judgment-engine-design.md](./2026-07-23-judgment-engine-design.md) (판정 엔진, 이미 구현 완료)
- 이 문서의 범위: PRD 마일스톤(§14) 기준 **E2(크롬 확장 프로그램 골격: 오버레이/배지/팝업)**. 단, 사용자 요청에 따라 원래 E3로 미루려 했던 **"실제 처리 결과 캡처 + 정확도 비교"를 최소 기능으로 이번 스펙에 앞당겨 포함**한다. E4(일정 기간 실사용 검증)는 이 스펙 밖이다.

## 이전 세션에서 이어짐

이 브레인스토밍은 2026-07-24에 한 번 중단되었다가 이번 세션에서 재개되었다. 그때 이미 확정된 전제:

1. **수집 계층은 DOM 파싱만 사용** — `admin-api.yeoshin.co.kr` 교차 출처 인증 여부가 미확인이라, 이번 스펙은 admin-api를 직접 호출하지 않는다.
2. **판정 대상은 검수 상태 = '대기' 행만.**
3. **판정 트리거는 버튼 클릭** — 페이지 로드 시 자동으로 AI를 호출하지 않는다(비용/API 호출량 통제).
4. **캐싱은 `chrome.storage.local`, `review_id` 기준.**
5. **Vercel 배포 + `chrome-extension://` 오리진 CORS 허용을 이번 스펙 범위에 포함.**

그리고 이번 세션에서 추가로 확정된 것:
- **판정 범위 접근 방식: A안** — 목록(가벼운 데이터로 배지) + 상세(전체 필드로 재판정, 근거 패널)의 2단계 구조.
- **실제 결과 캡처를 이번 스펙에 포함** (사용자가 "검수 정확도 테스트를 빠르게 할 수 있는 방법"을 원했기 때문 — E3를 통째로 당기지 않고, admin-api 호출 없이 가능한 최소 버전만 포함).

---

## 1. 목표 / 비목표

**목표**
- `admin.fastlane.kr/posts/reviews` 목록/상세 화면 위에 모의 판정 배지·패널을 오버레이로 표시한다.
- 판정 엔진(`judgment-engine`, 이미 완료)을 코드 변경 없이 그대로 가져다 쓴다.
- 검수자가 실제로 승인/보류 처리한 결과를 (admin-api 호출 없이) 화면 재스캔만으로 감지해, 모의 판정과 비교한 `is_match`를 기록한다.
- 팝업에서 판정 분포 + 일치율을 확인할 수 있게 해, "판정 로직이 실제로 얼마나 맞는지"를 빠르게 검증할 수 있게 한다.

**비목표**
- 실제 승인/보류/숨김 상태 변경 실행 (PRD 비목표와 동일).
- `admin-api.yeoshin.co.kr` 직접 호출 — 인증 여부 미확인 상태이므로 이번 스펙은 DOM 파싱만 사용한다.
- 영수증 결제금액/일자 자동 OCR 대조, 페이지 전체 데이터셋 기준의 정밀 중복 판정(§8.4) — 목록/상세 화면에 보이는 범위 내에서만 best-effort로 처리한다.
- 정밀도/재현율 같은 통계적 지표의 고도화(신뢰구간 등) — 이번 스펙은 단순 카운트 기반 요약만 다룬다.
- 일정 기간 실사용 검증(E4).

---

## 2. 아키텍처

```
[admin.fastlane.kr/posts/reviews 화면]
        │ DOM 읽기 + 오버레이 삽입
        ▼
┌──────────────────┐   chrome.runtime.sendMessage   ┌───────────────────────┐
│ Content Script    │ ─────────────────────────────► │ Background            │
│ (list + detail    │ ◄───────────────────────────── │ Service Worker         │
│  둘 다 매칭)       │      결과(JudgmentResult)       │                        │
└──────────────────┘                                 │ - judgment-engine 호출  │
        ▲                                             │ - chrome.storage 읽기/  │
        │ chrome.storage.onChanged                     │   쓰기                │
┌──────────────────┐                                 │ - proxy(Vercel) fetch  │
│ Popup UI          │────────────────────────────────► └───────────────────────┘
│ (판정 분포/일치율) │   chrome.storage.local 직접 조회
└──────────────────┘
```

**계층 분리 (PRD §6 그대로 적용)**
- **수집 계층**: content script의 DOM 파서. `admin.fastlane.kr/posts/reviews*`(목록), `admin.fastlane.kr/posts/reviews/detail/*`(상세)에 매칭. admin-api 호출 없음.
- **판정 엔진 계층**: `judgment-engine`을 수정 없이 import. **background service worker에서만 호출** — content script는 DOM 접근과 렌더링만 담당하고, `fetch`/`chrome.storage` 같은 비동기 작업은 background로 위임한다(MV3 권장 패턴).
- **표시/기록 계층**: content script가 배지/패널 DOM을 그리고, background가 결과를 `chrome.storage.local`에 적재한다.

**패키징**: 저장소 루트에 workspace 설정이 없으므로(각 패키지가 독립 `package.json`), 새 `chrome-extension/` 패키지에서 `"judgment-engine": "file:../judgment-engine"`으로 로컬 의존성을 추가한다. MV3 서비스 워커/콘텐츠 스크립트는 raw TS나 동적 npm 해석을 지원하지 않으므로, Vite + `@crxjs/vite-plugin`으로 content/background/popup을 각각 정적 번들로 빌드한다.

---

## 3. 컴포넌트

### 3.1 목록 화면 파서 + 배지 (Content Script)

실제 화면 조사 결과(이전 세션, Playwright로 로그인 후 확인) 목록 행에 이미 사진 썸네일이 노출되므로(일반 사진=단일 썸네일, 전/후=라벨 붙은 두 썸네일), 목록 단계에서도 `content_text`, `review_type`, `photos`(썸네일 URL + declared_category)까지는 확보 가능하다.

다만 아래는 목록 화면만으로는 확보할 수 없어 **예비 판정(tier: `list`)**으로 취급한다:
- 영수증 매칭 정보 → `receipt`를 전부 `null`로 전달 (엔진이 이미 `NEEDS_REVIEW`로 안전하게 처리하도록 설계돼 있음)
- 정밀 중복 판정 → `duplicate_flags`는 **현재 로드된 페이지 내 행끼리만** 비교해 best-effort로 채움 (전체 데이터셋 대조 아님)

**트리거**: 목록 상단에 "이 페이지 모의판정 실행" 버튼 1개. 클릭 시 현재 페이지에 보이는 '대기' 상태 행만 일괄 판정. 캐시(§3.4)에 이미 있는 행은 재호출 없이 즉시 배지 표시. 페이지 로드 시 자동 실행하지 않는다(비용 통제).

**배지 UI**: 판정 3종(자동보류후보/승인후보/검토필요)을 색상 + 텍스트 라벨로 병기(접근성). 클릭 시 `matched_rules` + `confidence` 툴팁, 상단에 "예비 판정(목록 기준)" 라벨 표기.

### 3.2 상세 화면 판정 패널 (Content Script)

- 진입 시 캐시를 조회해 `tier: detail`이 지문(§3.4) 일치로 있으면 **즉시 표시**(재호출 없음).
- 없거나 예비(`list`) 판정만 있으면, 자동 실행 대신 패널에 **"정밀 판정하기"** 버튼을 띄운다(여기서도 비용 통제 원칙 유지). 클릭 시 상세 화면의 전체 필드(영수증 매칭, `procedure.name`, `hospital_requested_takedown` 등)로 엔진을 다시 호출해 `tier: detail`로 캐시를 덮어쓴다.
- 동의/비동의 피드백 버튼(PRD §7.2, 선택 기능) — `reviewer_feedback`으로 저장. 규칙 튜닝에는 이번 스펙에서 아직 활용하지 않고 저장만 한다.

### 3.3 Background Service Worker

- `chrome.runtime.onMessage`로 content script의 판정 요청을 받아 `judgment-engine`의 `judgeReview()` 호출. proxy URL은 빌드 타임 상수로 주입.
- `chrome.storage.local`에 결과 저장, 캐시 조회 API 제공.
- **실제 처리 결과 캡처(최소 구현, §4 참고)**: content script가 목록을 재스캔할 때마다 보내는 "현재 보이는 상태" 메시지를 받아, 캐시에 있는 `review_id`인데 상태가 더 이상 '대기'가 아니면 `actual_result` 기록 + `is_match` 계산.

### 3.4 캐싱 키 & 무효화

- 키: `review_id` + **콘텐츠 지문**(`content_text` + 사진 URL 목록 + 수정일시를 해시). 내용이 수정되면 지문이 달라져 자동으로 캐시 미스 → 재판정 필요. **TTL은 두지 않는다** — '대기' 상태 행은 처리되면 목록에서 사라지므로 TTL로 만료시킬 대상 자체가 오래 남아있지 않는다.
- 각 캐시 엔트리에 `tier: 'list' | 'detail'` 태그를 붙여 예비/정밀 결과를 구분한다.
- 사용자가 언제든 수동으로 "다시 판정" 가능(지문이 같아도 강제 재호출).

### 3.5 Popup UI

- `chrome.storage.local`을 직접 읽어(background를 거치지 않음) **판정 분포(자동보류후보/승인후보/검토필요 건수) + 일치율(`NEEDS_REVIEW` 제외) + 최근 불일치 사례**를 표시한다.
- PRD §7.4의 "정밀도/재현율"까지는 이번 스펙에서 계산하지 않는다 — 단순 카운트 기반 요약만 다룬다(§1 비목표).

---

## 4. 데이터 흐름

**판정 흐름**
1. 목록 페이지 → "이 페이지 모의판정 실행" 클릭 → content script가 '대기' 행 스크랩(썸네일 URL 포함) → background에 배치 전송 → 캐시 미스 건만 `judgeReview()` 호출(`tier: list`) → 결과 저장 + 배지 렌더링.
2. 상세 페이지 진입 → 캐시에 `tier: detail`이 지문 일치로 있으면 즉시 표시, 없으면 "정밀 판정하기" 버튼 → 클릭 시 전체 필드로 재호출(`tier: detail`) → 캐시 덮어쓰기.

**실제 결과 캡처 (admin-api 호출 없이 순수 DOM 재스캔)**

3. 검수자가 실제로 승인/보류 처리를 하고 목록으로 돌아오면(또는 재방문 시), content script가 **목록을 다시 스크랩할 때마다** (버튼 클릭 불필요, AI 호출도 없으므로 비용 통제 원칙과 무관) 각 행의 "검수 상태" 컬럼을 읽는다.
4. 캐시에 이미 판정 결과가 있는 `review_id`인데 상태가 더 이상 '대기'가 아니면 → `actual_result`에 기록하고 `mock_judgment`과 비교해 `is_match` 계산:
   - `APPROVE_CANDIDATE` ↔ 실제 `승인` = match / `보류`·`숨김` = mismatch
   - `AUTO_HOLD_CANDIDATE` ↔ 실제 `보류`·`숨김` = match / `승인` = mismatch
   - `NEEDS_REVIEW`는 정답이 정해져 있지 않으므로 match/mismatch 판정에서 제외하고 "판단보류" 건수로만 집계한다(검수자 재량 판단이 필요했던 케이스라 오탐/정탐 이분법이 맞지 않는다).
5. 팝업이 `chrome.storage.local`을 읽어 판정 분포 + 일치율(NEEDS_REVIEW 제외) + 최근 불일치 사례를 보여준다.

이 캡처 방식은 admin-api를 직접 호출하지 않고 이미 화면에 그려지는 상태 텍스트만 읽으므로, §1의 "DOM 파싱만 사용" 전제와 충돌하지 않는다.

---

## 5. 에러 처리

- **DOM 구조 변경**: 파서는 셀렉터를 찾지 못하면 해당 행/필드를 건너뛰고 콘솔 경고만 남긴다(throw 금지) — 관리자 화면 개편 시 확장 전체가 죽지 않고 일부 행만 스킵되도록 한다.
- **AI/프록시 실패**: 엔진 자체가 이미 안전하게 `NEEDS_REVIEW`로 폴백하므로(`judgment-engine/src/engine.ts`) content script는 결과를 그대로 신뢰하고 표시만 하면 된다. 별도 재시도 로직은 이번 스펙에서 두지 않는다.
- **부분 데이터**: 목록 단계에서 영수증 정보 등 미확인 필드는 `null`로 전달한다 — 엔진이 이 경우를 `NEEDS_REVIEW`로 처리하도록 이미 설계돼 있어 추가 처리가 필요 없다.
- **상태 캡처 중복 방지**: 목록 재스캔 시 같은 `review_id`에 이미 `actual_result`가 기록돼 있으면 스킵하는 가드를 둔다(반복 기록 방지).
- **화면 충돌**: 기존 `yrg-` 접두사 확장 프로그램과 DOM 삽입 위치가 겹치지 않도록 별도 네임스페이스(`rvw-mock-`류 접두사)를 사용한다(PRD §12).

---

## 6. 테스트 전략

- **judgment-engine**: 기존 유닛 테스트 그대로 재사용(변경 없음).
- **DOM 파서**: 실제 admin 화면 HTML 스냅샷(민감정보 제거 후 구조만 남긴) 픽스처로 파서 함수를 유닛 테스트한다 — 실제 사이트 접속 없이 검증 가능.
- **캐싱/지문 로직, `is_match` 계산**: `chrome.*` API에 의존하지 않는 순수 함수로 분리해 유닛 테스트한다.
- **확장 전체 동작**: 실제 로그인 후 Playwright/MCP로 1회 스모크 테스트(이전 세션에서 화면 구조 조사에 쓴 방식과 동일) — 민감 데이터는 기록하지 않고, 배지 렌더링/판정 트리거/캡처 동작만 확인한다.

---

## 7. 열린 질문 / 리스크 (이 스펙에 한정)

- 목록 화면의 썸네일 URL이 상세 화면과 동일한 서명된 CloudFront URL인지, 목록 전용으로 별도 축소 처리된 URL인지 미확인 — 다르다면 AI 판단 정확도에 영향을 줄 수 있어 구현 초기에 확인이 필요하다.
- "이 페이지 내 행끼리만" 비교하는 목록 단계 중복 판정은 페이지네이션(10~200건)에 따라 놓치는 중복이 있을 수 있다 — 상세 재판정 단계에서도 여전히 페이지 범위 밖 데이터는 못 보므로 근본적 한계이며, 개선은 2차(서버, admin-api 폴링)에서 다룬다(PRD §11).
- `NEEDS_REVIEW`를 일치율 계산에서 제외하는 방식이 "빠른 정확도 테스트"라는 목적에 충분한지는 실제 데이터가 쌓인 뒤 재확인이 필요하다.
- Vercel 배포 + `chrome-extension://` CORS 설정의 구체적인 매니페스트/헤더 값은 구현 단계에서 확정한다.

---

## 8. 이번 스펙의 마일스톤

| 단계 | 내용 |
|---|---|
| M1 | `chrome-extension/` 패키지 스캐폴드 + Vite/CRXJS 빌드 설정 + manifest.json |
| M2 | 목록/상세 DOM 파서 + fixture 기반 유닛 테스트 |
| M3 | Background service worker: `judgeReview()` 연동 + `chrome.storage.local` 캐싱(지문 기반) |
| M4 | 목록 배지 + 상세 패널 UI, 트리거 버튼 |
| M5 | 실제 결과 캡처(목록 재스캔 → `actual_result`/`is_match`) + 팝업 요약 UI |
| M6 | Vercel 배포 + CORS 설정 + 실제 로그인 스모크 테스트 |

M6까지 완료되면 PRD E3(전체 정확도 자동 집계 고도화)와 E4(실사용 검증)를 별도 스펙으로 이어간다.
