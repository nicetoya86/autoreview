# 설계: 후기 모의 검수 판정 엔진 모듈 (judgment-engine)

- 문서 버전: v1.0
- 작성일: 2026-07-23
- 상위 문서: [PRD_후기모의검수_크롬확장.md](../../../PRD_후기모의검수_크롬확장.md)
- 이 문서의 범위: PRD 전체(크롬 확장 프로그램) 중 **§6 "판정 엔진 계층"** 부분만 먼저 설계·구현한다. 콘텐츠 스크립트, 오버레이 UI, 팝업 대시보드는 이 스펙에 포함하지 않으며, 이후 별도 스펙(크롬 확장 골격)에서 이 엔진을 가져다 쓴다.

## 왜 엔진부터 만드는가

PRD가 스스로 "판정 엔진이 2차(24시간 서버 자동화) 재사용의 핵심"이라고 명시하고 있고, 이 엔진은 브라우저 API에 의존하지 않는 순수 로직이라 크롬 확장과 독립적으로 만들고 검증할 수 있다. 판정 정확도(이번 프로젝트 전체의 목적)를 검증하는 것도 결국 이 엔진의 출력이 맞는지를 보는 것이므로, 오버레이 UI보다 먼저 이 부분의 정확도와 견고함을 확보하는 것이 우선순위가 높다.

---

## 1. 목표 / 비목표

**목표**
- PRD 8.0~8.6의 판정 기준을 그대로 코드화해, review 데이터(JSON)를 입력받아 `AUTO_HOLD_CANDIDATE` / `APPROVE_CANDIDATE` / `NEEDS_REVIEW` 중 하나와 판정 근거를 반환하는 모듈을 만든다.
- 티켓 사용/상담/현장 앱결제/영수증 4개 후기 유형 모두의 승인·보류 기준(PRD 8.1~8.5)을 다룬다 — 영수증 후기에만 국한하지 않는다.
- 사진이 N장 등록된 경우, PRD 8.0의 "기준 미달 사진만 숨김 처리 후 승인" 규칙에 따라 사진 단위 개별 판정까지 반환한다(전체 후기 판정 하나만이 아니라).
- 객관적으로 확인 가능한 규칙과, 사진/텍스트 내용처럼 사람의 판단이 필요한 부분(AI 판단)을 분리해서 구현하고, 후자는 이번 1차부터 Gemini API로 처리한다.
- 브라우저(크롬 확장)와 Node.js(2차 서버) 양쪽에서 코드 변경 없이 재사용 가능한 형태로 만든다.

**비목표**
- 크롬 확장 프로그램(콘텐츠 스크립트, 오버레이, 팝업)은 이 스펙에서 다루지 않는다.
- 영수증 결제금액/일자의 정밀 OCR 자동 비교는 PRD상 필드 스펙 미확인 상태이므로, 이 엔진은 "이미 계산된 일치 여부"를 입력으로 받는다(§4, 아래 §3 참고). OCR 자체 구현은 범위 밖.
- 후기 간 중복 판단에 필요한 "다른 후기 조회"는 이 엔진이 직접 하지 않는다(순수 함수 원칙). 중복 여부는 호출자가 미리 계산해 입력으로 넘긴다.

---

## 2. 아키텍처

```
judgment-engine/                    ← 독립 패키지 (2차 서버로 그대로 이식 대상)
├── src/
│   ├── types.ts                    # ReviewInput, JudgmentResult 등 공용 타입
│   ├── rules/
│   │   ├── objectiveRules.ts       # 8.0~8.5의 규칙 기반(결정론적) 체크
│   │   └── mapping.ts              # 8.6 매핑 테이블 (세부기준 → 3단계 판정)
│   ├── ai/
│   │   ├── aiAdapter.ts            # 프록시 호출 + 응답 파싱 (fetch 기반, 순수 함수)
│   │   └── promptSchema.ts         # AI에게 보낼 프롬프트/출력 스키마 정의
│   ├── engine.ts                   # judgeReview(input): 규칙 → (필요시) AI → 최종 판정
│   └── index.ts
└── tests/
    ├── fixtures/                   # PRD 8장 기반 가상 review 샘플
    ├── objectiveRules.test.ts
    ├── engine.test.ts              # AI 어댑터는 mock으로 대체해 결정론적으로 테스트
    └── mapping.test.ts

proxy/                              ← 별도 Vercel 프로젝트 (judgment-engine이 호출하는 대상)
└── api/judge-content.ts            # { photos, text, reviewType } 받아 Gemini API 호출 후 구조화 응답 반환
```

**핵심 원칙**
- `judgment-engine`은 `window`, `document`, `chrome.*`를 전혀 참조하지 않는다. `fetch`만 사용하므로 브라우저 background service worker와 Node.js 양쪽에서 동일 코드로 동작한다.
- `judgeReview()`는 비동기 순수 함수다: 같은 입력 + 같은 프록시 응답이면 항상 같은 출력. 저장(로그 적재)이나 화면 표시는 이 엔진을 호출하는 쪽(확장 프로그램 또는 2차 서버)의 책임이며, 엔진 내부에서 하지 않는다.
- API 키, 모델명, Gemini API 호출 세부사항은 전부 `proxy/`에 캡슐화된다. `judgment-engine`은 프록시의 URL 하나만 알면 된다.

---

## 3. 데이터 인터페이스

### 입력: `ReviewInput`

```ts
type ReviewType = 'TICKET_USE' | 'CONSULTATION' | 'ONSITE_APP_PAYMENT' | 'RECEIPT';

interface ReviewInput {
  review_id: string;
  review_type: ReviewType;
  content_text: string;

  photos: Array<{
    url: string;
    declared_category: 'GENERAL' | 'BEFORE_AFTER' | 'RECEIPT';
    before_after_slot?: 'BEFORE' | 'AFTER'; // declared_category가 BEFORE_AFTER일 때만
  }>;

  procedure: {
    name?: string;
    // 브라질리언 제모, 여성 시술(LDM 등)처럼 전/후 사진 촬영이 불가능한 시술 목록과 매칭되는지 여부.
    // 목록 자체는 엔진 설정값(§8.0 예외 규칙)으로 관리하고, 여기서는 매칭 결과만 받는다.
    is_before_after_exempt: boolean;
  };

  // 영수증 후기에서만 사용. 결제금액/일자의 실제 OCR 대조는 범위 밖(§1 비목표)이므로
  // 호출자가 이미 계산한 일치 여부를 받는다. OCR 자동화가 붙기 전까지는 호출자가
  // 관리자 화면에 이미 표시된 대사 결과(있다면)를 넘기거나, 이 필드를 비워 NEEDS_REVIEW로 보낸다.
  receipt?: {
    amount_matches: boolean | null;   // null = 자동 대사 불가, AI/사람 확인 필요
    date_matches: boolean | null;
    hospital_name_matches: boolean | null;
    photo_count: number;              // 다수 영수증 등록 감지용
    is_app_payment_receipt: boolean;  // 여신티켓 앱 결제 영수증 등록 여부
  };

  // 중복 판단은 여러 후기를 조회해야 하므로 엔진이 직접 하지 않고, 호출자가 미리 계산해 넘긴다.
  duplicate_flags: {
    same_customer: boolean;
    same_written_at: boolean;
    same_procedure_event: boolean;
    same_content: boolean;
    same_photo: boolean;
    same_receipt: boolean; // 영수증 후기 전용, OR 조건
  };

  hospital_requested_takedown: boolean; // 게시중단 요청 — 있으면 무조건 NEEDS_REVIEW(별도 프로세스)
}
```

### 출력: `JudgmentResult`

```ts
interface JudgmentResult {
  review_id: string;
  mock_judgment: 'AUTO_HOLD_CANDIDATE' | 'APPROVE_CANDIDATE' | 'NEEDS_REVIEW';
  matched_rules: string[];   // 예: ["8.4-duplicate", "receipt-amount-mismatch"]
  confidence: number;        // 0~1. 규칙만으로 확정되면 1.0, AI 판단이 섞이면 AI가 준 confidence를 그대로 사용
  reasoning: string;         // 사람이 읽는 판정 근거 요약
  ai_invoked: boolean;       // 이번 판정에 AI 호출이 있었는지 (비용/성능 모니터링용)

  // PRD 8.0 "일부 사진 기준 미달 시 해당 사진만 숨김 처리 후 승인" 반영.
  // photos 입력 배열과 순서/개수가 1:1 대응.
  photo_results: Array<{
    url: string;
    decision: 'APPROVED' | 'HIDDEN';
    reason?: string; // HIDDEN일 때만: "unidentifiable" | "public_order" | "irrelevant" 등
  }>;
}
```

전체 판정(`mock_judgment`)과 사진별 판정(`photo_results`)의 관계:
- 유효한(APPROVED) 사진이 하나도 남지 않으면 → `mock_judgment: AUTO_HOLD_CANDIDATE` (전체 보류, PRD 8.1의 "시술 관련 사진 등록" 조건 자체를 못 채움)
- 일부 사진만 HIDDEN이고 승인 조건을 충족하는 사진이 남아있으면 → `mock_judgment: APPROVE_CANDIDATE`, 문제 사진은 `photo_results`에서 `HIDDEN`으로 표시(호출자가 실제 화면에서 해당 사진만 숨김 처리하도록 안내)
- 미풍양속 관련 사진처럼 "숨김"이 아니라 사람 판단이 필요한 경우는 해당 사진의 `decision`을 `HIDDEN`으로 두되 전체 `mock_judgment`는 `NEEDS_REVIEW`로 올려, 검수자가 최종 확인하게 한다.

이 출력 구조는 PRD §10 "판정 결과 데이터 스펙"의 `mock_judgment`/`matched_rules`/`confidence`/`reasoning` 필드와 동일하게 맞춰, 나중에 확장 프로그램이 `checked_at`, `actual_result`, `is_match` 등을 덧붙여 그대로 저장할 수 있게 한다. `photo_results`는 PRD 스펙에는 없던 확장 필드이며, 확장 프로그램 UI에서 "이 사진만 숨김 처리해주세요" 같은 세부 안내를 표시하는 데 쓰인다.

---

## 4. 판정 흐름 (엔진 결합 방식: 규칙 우선, AI는 필요할 때만)

```
judgeReview(input)
  1. hospital_requested_takedown === true?
     → 즉시 NEEDS_REVIEW ("병원 게시중단 요청", 별도 프로세스)

  2. 객관적 규칙 체크 (objectiveRules.ts) — AI 호출 없이 결정 가능한 것들:
     - 8.4 중복 기준(AND 조건, review_type별로 대상 필드가 다름) 충족 → AUTO_HOLD_CANDIDATE
     - RECEIPT 유형: amount_matches===false 또는 date_matches===false
       또는 hospital_name_matches===false 또는 photo_count===0
       또는 photo_count>1 또는 is_app_payment_receipt===true → AUTO_HOLD_CANDIDATE
     - content_text가 규칙적으로 "의미 불명"으로 판별되는 경우(자모/특수문자 반복 등 패턴 매칭) → AUTO_HOLD_CANDIDATE
     - 시술 전/후 사진 중 일부 누락 + is_before_after_exempt=false인데 일반사진으로만 등록된 경우의
       "유형 변경 후 승인" 케이스는 규칙만으로 판단 가능 → 승인 판정에 반영(§8.0)
     하나라도 매칭되면 그 시점에서 확정, AI 호출 없이 반환 (confidence=1.0, ai_invoked=false)

  3. 위에서 확정되지 않았다면 AI 호출이 필요한 항목만 판단:
     - 후기 내용이 시술과 관련 있는지 / 미풍양속에 위배되는지 (텍스트, 후기 전체 단위 1회 판단)
     - 사진마다 개별로: 시술과 관련 있는지 / 식별 가능한지 / 미풍양속에 위배되는지 (photos 배열 각 항목 단위 판단)
     → aiAdapter.ts가 proxy/api/judge-content 호출(사진 배열 전체를 한 번의 요청에 포함), 사진별 구조화 응답(§5) 수신

  4. AI 응답(사진별 결과 + 텍스트 결과) + 규칙 결과를 mapping.ts(8.6 매핑표)로 합성
     - 사진별로 문제(관련없음/식별불가/미풍양속)가 있으면 그 사진만 photo_results에서 HIDDEN 처리
     - 문제없이 남은(APPROVED) 사진이 1장 이상이고 텍스트도 문제없음 → APPROVE_CANDIDATE
       (단, 숨김 사유가 "미풍양속"이면 전체를 NEEDS_REVIEW로 올림 — 사람 판단 필요, PRD 8.6과 동일)
     - 남는 유효 사진이 0장이거나 텍스트가 관련없음/의미불명 → AUTO_HOLD_CANDIDATE
     confidence는 AI가 반환한 값(사진별 최저값 또는 텍스트 값 중 낮은 쪽)을 사용, ai_invoked=true
```

---

## 5. AI 어댑터 및 프록시 설계

### 5.1 프록시 (`proxy/api/judge-content.ts`, Vercel Function)

- 요청: `{ review_type, content_text, photos: [{url, declared_category}] }`
- 내부에서 Gemini API(비전+텍스트 통합 1회 호출)를 호출. API 키는 Vercel 환경변수로만 보관, 클라이언트(크롬 확장)에는 절대 노출되지 않음.
- 프롬프트는 PRD §8.2/§8.3의 승인/보류 기준 표를 그대로 지시문으로 포함해, 모델이 정책 문서 기준으로만 판단하게 한다.
- 응답은 구조화된 JSON으로 강제(tool use / structured output). 사진은 **배열의 각 항목마다 개별 판단**을 반환한다(PRD 8.0의 "일부 사진만 숨김 처리" 요구사항 반영):

```json
{
  "content_relevant": true,
  "content_flag": null,           // "meaningless" | "public_order" | null
  "photos": [
    {
      "url": "https://.../photo1.jpg",
      "relevant": true,
      "identifiable": true,
      "flag": null,                // "unidentifiable" | "public_order" | "irrelevant" | null
      "confidence": 0.9
    },
    {
      "url": "https://.../photo2.jpg",
      "relevant": false,
      "identifiable": true,
      "flag": "irrelevant",
      "confidence": 0.78
    }
  ],
  "confidence": 0.86,              // 텍스트 판단에 대한 전체 신뢰도
  "reasoning": "후기 내용이 시술 부위와 통증 완화 경험을 구체적으로 서술하고 있음. photo2는 시술과 무관한 인물 사진으로 판단됨."
}
```

- `judgment-engine`은 이 응답을 받아 mapping.ts에서 최종 판정과 `photo_results`로 변환한다. 즉 "AI가 3단계 판정을 직접 내리는 것"이 아니라 "AI는 텍스트/사진별 세부 항목만 판단하고, 최종 3단계 분류와 사진별 숨김 여부는 여전히 엔진의 매핑 로직이 결정"한다 — 이렇게 해야 판정 기준 변경(정책 개정) 시 프롬프트가 아니라 매핑 테이블만 고치면 되고, 근거 추적도 쉬워진다.

### 5.2 에러 처리

- 프록시 호출 실패(타임아웃, 5xx, 파싱 실패): `mock_judgment: 'NEEDS_REVIEW'`, `reasoning: 'AI 판단 실패 — 검수자 직접 확인 필요'`, `confidence: 0`, `ai_invoked: true`로 반환한다. `photo_results`는 입력받은 모든 사진을 `decision: 'HIDDEN', reason: 'ai_error'`로 채워 반환한다(사진별 판단을 시도했다가 실패했음을 명시하되, 임의로 승인 처리하지 않음). 판정 불가 상태를 "승인"이나 "보류"로 임의 확정하지 않고 항상 안전한 쪽(검토필요)으로 떨어뜨린다.
- 프록시 자체가 응답하지 않는 경우(네트워크 오류)도 동일하게 처리 — 엔진이 예외를 던지지 않고 항상 `JudgmentResult`를 반환하는 것을 계약으로 한다(호출자가 매번 try/catch를 반복하지 않아도 되게).

---

## 6. 테스트 전략

- PRD 8.0~8.6 표의 각 행(row)마다 최소 1개의 가상 `ReviewInput` fixture를 만든다 (예: "영수증 금액 불일치", "브라질리언 제모 + 일반사진 등록 → 승인", "LDM+여성시술 + 일반사진 등록 → 보류" 등 PRD가 직접 든 예시 포함).
- 사진 N장 중 일부만 기준 미달인 케이스(예: 3장 중 1장이 시술과 무관 → 그 1장만 HIDDEN, 나머지 승인)를 별도 fixture로 반드시 포함해 `photo_results`가 사진별로 정확히 나뉘는지 검증한다.
- 객관적 규칙(`objectiveRules.ts`, `mapping.ts`)은 AI 호출 없이 100% 결정론적으로 단위 테스트한다.
- AI가 필요한 경로(`engine.test.ts`)는 `aiAdapter`를 mock으로 대체해, "AI가 이런 응답을 줬을 때 최종 판정이 올바르게 매핑되는가"를 검증한다. 실제 Gemini API를 매번 호출하지 않아 테스트가 빠르고 안정적이다.
- 실제 Gemini API/프록시 연동 자체가 잘 동작하는지는 별도의 소규모 수동 점검(스모크 테스트)으로 확인하고, 자동 유닛 테스트와는 분리한다.

---

## 7. 2차(서버 자동화)로의 재사용 지점

- `judgment-engine` 패키지는 코드 변경 없이 Node.js 서버 프로젝트에 그대로 옮겨 `import`한다 (PRD §11과 동일).
- `proxy/`도 그대로 유지 가능 — 2차 서버가 호출하는 대상이 크롬 확장에서 서버로 바뀔 뿐, 프록시 자체의 역할(Gemini API 키 보호)은 동일하다.
- 확장 프로그램(1차)과 서버(2차) 모두 "수집 계층"에서 `ReviewInput`을 만들어 `judgeReview()`에 넘기는 어댑터 코드만 각자 새로 작성하면 된다.

---

## 8. 열린 질문 / 리스크 (이 엔진 스펙에 한정)

- 영수증 결제금액/일자의 실제 OCR 자동 대조는 아직 구현 범위 밖 — `receipt.amount_matches` 등을 `null`로 받는 경우 엔진은 이를 "확인 불가"로 처리해 `NEEDS_REVIEW`로 분류한다(안전 우선). OCR이 붙기 전까지는 영수증 후기 상당수가 검토필요로 분류될 수 있음 — 실사용 검증 단계(PRD E4)에서 비율을 확인 필요.
- AI 판단(미풍양속, 관련성, 식별가능여부)의 실제 정확도는 아직 검증되지 않았다 — 이번 스펙에서는 인터페이스와 흐름만 확정하고, 정확도 자체는 구현 후 실사용 비교(PRD 성공 지표)로 측정한다.
- "의미 불명 텍스트" 판별을 규칙(정규식/패턴)으로 처리할지, 이것도 AI로 넘길지는 구현 단계에서 초기 규칙을 먼저 시도해보고 오탐이 많으면 AI 경로로 전환하는 방식을 제안한다.

---

## 9. 이번 스펙의 마일스톤

| 단계 | 내용 |
|---|---|
| M1 | 타입 정의(`types.ts`) + 객관적 규칙 엔진(`objectiveRules.ts`, `mapping.ts`) + fixture 기반 유닛 테스트 |
| M2 | 프록시(Vercel Function) 뼈대 + Gemini API 연동 + 구조화 출력 스키마 |
| M3 | `aiAdapter.ts` + `engine.ts` 오케스트레이션 + mock 기반 통합 테스트 |
| M4 | 실제 Gemini API 연동 스모크 테스트, 소수 실제(익명화) 사례로 수동 검증 |

M4까지 완료되면 이 엔진을 가져다 쓰는 크롬 확장 골격(콘텐츠 스크립트/오버레이/팝업)을 다음 스펙으로 브레인스토밍한다.
