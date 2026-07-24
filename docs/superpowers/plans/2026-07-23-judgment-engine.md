# 판정 엔진 모듈 (judgment-engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRD 8.0~8.6의 후기 승인/보류 판정 기준을 코드화한 순수 모듈(`judgment-engine`)과, 그 모듈이 사진/텍스트 내용을 판단할 때 호출하는 Claude API 프록시(`proxy`)를 만든다. 크롬 확장 UI는 이 계획에 포함하지 않는다.

**Architecture:** `judgment-engine`은 브라우저/Node.js 어디서나 동작하는 순수 TypeScript 패키지로, 객관적 규칙(중복, 영수증 일치 여부, 의미불명 텍스트, 게시중단)을 먼저 체크하고, 확정되지 않으면 별도 `proxy`(Vercel Function)를 통해 Claude API로 사진/텍스트 내용을 판단한 뒤 그 결과를 8.6 매핑 규칙으로 합성해 최종 판정(전체 판정 + 사진별 판정)을 반환한다. `proxy`가 Claude API 키를 캡슐화해 클라이언트에는 키가 노출되지 않는다.

**Tech Stack:** TypeScript, Node.js, Vitest(테스트), Vercel Functions(`@vercel/node`), `@anthropic-ai/sdk`

## Global Constraints

- `judgment-engine/src/**`는 `window`, `document`, `chrome.*` 등 브라우저 전역 객체를 참조하지 않는다 (스펙 §2 핵심 원칙).
- `judgeReview()`는 절대 예외를 던지지 않고 항상 `JudgmentResult`를 반환한다 — 실패 시에도 `NEEDS_REVIEW`로 안전하게 떨어뜨린다 (스펙 §5.2).
- Claude API 키는 `proxy`의 환경변수(`ANTHROPIC_API_KEY`)에만 존재하며, `judgment-engine`이나 클라이언트 코드에는 절대 포함하지 않는다 (스펙 §5.1).
- 사용할 Claude 모델 ID는 `claude-sonnet-5` (Sonnet 5)로 통일한다.
- 테스트는 Vitest로 작성하고, AI 호출이 필요한 경로는 실제 네트워크 호출 없이 mock으로 검증한다 (스펙 §6).
- 출력 타입(`JudgmentResult`, `photo_results` 등)은 스펙 §3의 정의를 그대로 따른다.

> **2026-07-24 amendment:** Task 11 완료 후 실제 스모크 테스트(Task 12) 진행 중 Anthropic 계정 크레딧 부족으로 막혀, 사용자 요청에 따라 `proxy`의 AI 제공자를 Claude(Anthropic SDK)에서 **Google Gemini(`@google/genai`)** 로 교체했다. 아래 Task 10/11 섹션에 적힌 Claude 기반 코드는 **실제로 커밋된 원본 그대로 보존**한 역사적 기록이며, 이후 별도 커밋으로 Gemini 기반 구현으로 교체되었다 — 실제 소스는 `proxy/api/judge-content.ts` 참고. 아래 Global Constraints 중 "Claude 모델 ID `claude-sonnet-5`"와 "`ANTHROPIC_API_KEY`" 항목은 이 교체 이후로는 적용되지 않으며, 현재는 모델 `gemini-2.5-flash`와 환경변수 `GEMINI_API_KEY`를 사용한다. Task 12 섹션은 이 교체를 반영해 갱신했다.

---

## File Structure

```
(프로젝트 루트)/
├── judgment-engine/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── types.ts
│   │   ├── rules/
│   │   │   ├── duplicate.ts
│   │   │   ├── receipt.ts
│   │   │   ├── meaninglessText.ts
│   │   │   ├── objectiveRules.ts
│   │   │   └── mapping.ts
│   │   ├── ai/
│   │   │   └── aiAdapter.ts
│   │   ├── engine.ts
│   │   └── index.ts
│   └── tests/
│       ├── fixtures.ts
│       ├── duplicate.test.ts
│       ├── receipt.test.ts
│       ├── meaninglessText.test.ts
│       ├── objectiveRules.test.ts
│       ├── mapping.test.ts
│       ├── aiAdapter.test.ts
│       └── engine.test.ts
└── proxy/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── .env.example
    ├── api/
    │   └── judge-content.ts
    ├── src/
    │   └── prompt.ts
    ├── tests/
    │   ├── prompt.test.ts
    │   └── handler.test.ts
    └── scripts/
        └── smoke-test.ts
```

---

### Task 1: 저장소 및 도구 스캐폴드

**무엇을 완료하는가 (쉬운 설명):** 코드를 담을 폴더 구조와 git 버전관리, 테스트 도구(Vitest)를 준비합니다. 아직 실제 판정 로직은 없고, "테스트 하나가 통과한다"는 것만 확인하는 단계입니다.

**Files:**
- Create: `judgment-engine/package.json`
- Create: `judgment-engine/tsconfig.json`
- Create: `judgment-engine/vitest.config.ts`
- Create: `judgment-engine/src/index.ts`
- Create: `judgment-engine/tests/smoke.test.ts`

**Interfaces:**
- Produces: `judgment-engine` 패키지 루트, `npm test` 명령으로 Vitest 실행 가능.

- [ ] **Step 1: git 저장소 초기화**

```bash
git init
```

Expected: `Initialized empty Git repository in .../Automated Review Verification/.git/`

- [ ] **Step 2: judgment-engine 폴더와 package.json 생성**

`judgment-engine/package.json`:
```json
{
  "name": "judgment-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 3: tsconfig.json 생성**

`judgment-engine/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: vitest.config.ts 생성**

`judgment-engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: 임시 index.ts 생성**

`judgment-engine/src/index.ts`:
```ts
export const ENGINE_VERSION = '0.1.0';
```

- [ ] **Step 6: 실패하는(아직 없는) 스모크 테스트 작성**

`judgment-engine/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../src/index';

describe('smoke', () => {
  it('exposes a version string', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 7: 의존성 설치 및 테스트 실행**

```bash
cd judgment-engine && npm install && npm test
```

Expected: PASS (1 test)

- [ ] **Step 8: 커밋**

```bash
git add judgment-engine
git commit -m "chore: scaffold judgment-engine package with vitest"
```

---

### Task 2: 공용 타입 정의 (`types.ts`)

**무엇을 완료하는가 (쉬운 설명):** 엔진에 "이런 모양의 데이터를 넣으면, 이런 모양의 결과가 나온다"는 약속(타입)을 정의합니다. 아직 판단 로직은 없고, 데이터 모양만 확정합니다.

**Files:**
- Create: `judgment-engine/src/types.ts`
- Test: `judgment-engine/tests/types.test.ts`

**Interfaces:**
- Produces: `ReviewInput`, `ReviewPhoto`, `ReviewType`, `PhotoCategory`, `MockJudgment`, `PhotoResult`, `JudgmentResult`, `AiPhotoJudgment`, `AiContentJudgment` — 이후 모든 태스크가 이 타입들을 가져다 쓴다.

- [ ] **Step 1: 타입을 사용하는 실패 테스트 작성**

`judgment-engine/tests/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { ReviewInput, JudgmentResult } from '../src/types';

describe('types', () => {
  it('allows constructing a minimal ReviewInput and JudgmentResult', () => {
    const input: ReviewInput = {
      review_id: 'r1',
      review_type: 'TICKET_USE',
      content_text: '시술 후 만족스러웠어요',
      photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
      procedure: { is_before_after_exempt: false },
      duplicate_flags: {
        same_customer: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: false,
      },
      hospital_requested_takedown: false,
    };

    const result: JudgmentResult = {
      review_id: 'r1',
      mock_judgment: 'APPROVE_CANDIDATE',
      matched_rules: [],
      confidence: 1,
      reasoning: 'ok',
      ai_invoked: false,
      photo_results: [{ url: 'https://x/1.jpg', decision: 'APPROVED' }],
    };

    expect(input.review_id).toBe('r1');
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd judgment-engine && npm test
```

Expected: FAIL — `Cannot find module '../src/types'`

- [ ] **Step 3: types.ts 작성**

`judgment-engine/src/types.ts`:
```ts
export type ReviewType = 'TICKET_USE' | 'CONSULTATION' | 'ONSITE_APP_PAYMENT' | 'RECEIPT';

export type PhotoCategory = 'GENERAL' | 'BEFORE_AFTER' | 'RECEIPT';

export interface ReviewPhoto {
  url: string;
  declared_category: PhotoCategory;
  before_after_slot?: 'BEFORE' | 'AFTER';
}

export interface ReceiptInfo {
  amount_matches: boolean | null;
  date_matches: boolean | null;
  hospital_name_matches: boolean | null;
  photo_count: number;
  is_app_payment_receipt: boolean;
}

export interface DuplicateFlags {
  same_customer: boolean;
  same_written_at: boolean;
  same_procedure_event: boolean;
  procedure_event_exists?: boolean; // CONSULTATION 유형에서만 사용 (§8.4 "시술이벤트가 있는 경우만")
  same_content: boolean;
  same_photo: boolean;
  same_receipt: boolean;
}

export interface ReviewInput {
  review_id: string;
  review_type: ReviewType;
  content_text: string;
  photos: ReviewPhoto[];
  procedure: {
    name?: string;
    is_before_after_exempt: boolean;
  };
  receipt?: ReceiptInfo;
  duplicate_flags: DuplicateFlags;
  hospital_requested_takedown: boolean;
}

export type MockJudgment = 'AUTO_HOLD_CANDIDATE' | 'APPROVE_CANDIDATE' | 'NEEDS_REVIEW';

export interface PhotoResult {
  url: string;
  decision: 'APPROVED' | 'HIDDEN';
  reason?: string;
}

export interface JudgmentResult {
  review_id: string;
  mock_judgment: MockJudgment;
  matched_rules: string[];
  confidence: number;
  reasoning: string;
  ai_invoked: boolean;
  photo_results: PhotoResult[];
}

export interface AiPhotoJudgment {
  url: string;
  relevant: boolean;
  identifiable: boolean;
  flag: 'unidentifiable' | 'public_order' | 'irrelevant' | null;
  confidence: number;
}

export interface AiContentJudgment {
  content_relevant: boolean;
  content_flag: 'meaningless' | 'public_order' | null;
  photos: AiPhotoJudgment[];
  confidence: number;
  reasoning: string;
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd judgment-engine && npm test
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add judgment-engine/src/types.ts judgment-engine/tests/types.test.ts
git commit -m "feat: define ReviewInput/JudgmentResult core types"
```

---

### Task 3: 중복 후기 규칙 (PRD 8.4)

**무엇을 완료하는가 (쉬운 설명):** "같은 사람이 같은 내용/사진으로 후기를 여러 번 등록했는지"를 판별하는 규칙을 만듭니다. 후기 유형(티켓/상담/현장앱결제/영수증)마다 확인하는 항목이 다릅니다.

**Files:**
- Create: `judgment-engine/src/rules/duplicate.ts`
- Test: `judgment-engine/tests/duplicate.test.ts`

**Interfaces:**
- Consumes: `ReviewInput`, `DuplicateFlags` (Task 2)
- Produces: `isDuplicate(input: ReviewInput): boolean` — Task 6(`objectiveRules.ts`)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`judgment-engine/tests/duplicate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isDuplicate } from '../src/rules/duplicate';
import type { ReviewInput } from '../src/types';

function baseInput(overrides: Partial<ReviewInput>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: 'text',
    photos: [],
    procedure: { is_before_after_exempt: false },
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
    ...overrides,
  };
}

describe('isDuplicate', () => {
  it('TICKET_USE: 모든 조건 충족 시 true', () => {
    const input = baseInput({
      review_type: 'TICKET_USE',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: true,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('TICKET_USE: 한 조건이라도 false면 false', () => {
    const input = baseInput({
      review_type: 'TICKET_USE',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: false,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(false);
  });

  it('CONSULTATION: 시술이벤트가 없는 경우 그 조건은 무시', () => {
    const input = baseInput({
      review_type: 'CONSULTATION',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: false,
        procedure_event_exists: false,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('ONSITE_APP_PAYMENT: 시술이벤트 조건 자체가 없음', () => {
    const input = baseInput({
      review_type: 'ONSITE_APP_PAYMENT',
      duplicate_flags: {
        same_customer: true,
        same_written_at: true,
        same_procedure_event: false,
        same_content: true,
        same_photo: true,
        same_receipt: false,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('RECEIPT: 동일 영수증만 있어도(OR) 중복', () => {
    const input = baseInput({
      review_type: 'RECEIPT',
      duplicate_flags: {
        same_customer: true,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: true,
      },
    });
    expect(isDuplicate(input)).toBe(true);
  });

  it('RECEIPT: 고객이 다르면 영수증이 같아도 중복 아님', () => {
    const input = baseInput({
      review_type: 'RECEIPT',
      duplicate_flags: {
        same_customer: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: true,
      },
    });
    expect(isDuplicate(input)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd judgment-engine && npm test -- duplicate
```

Expected: FAIL — `Cannot find module '../src/rules/duplicate'`

- [ ] **Step 3: duplicate.ts 구현**

`judgment-engine/src/rules/duplicate.ts`:
```ts
import type { ReviewInput } from '../types';

/**
 * PRD 8.4 중복 기준.
 * TICKET_USE/CONSULTATION/ONSITE_APP_PAYMENT: AND 조건.
 * RECEIPT: (고객+내용+사진 동일) 이거나 (고객+영수증 동일) 중 하나만 맞아도 중복(OR).
 */
export function isDuplicate(input: ReviewInput): boolean {
  const f = input.duplicate_flags;

  switch (input.review_type) {
    case 'TICKET_USE':
      return f.same_customer && f.same_written_at && f.same_procedure_event && f.same_content && f.same_photo;

    case 'CONSULTATION': {
      const procedureEventOk = f.procedure_event_exists === false ? true : f.same_procedure_event;
      return f.same_customer && f.same_written_at && procedureEventOk && f.same_content && f.same_photo;
    }

    case 'ONSITE_APP_PAYMENT':
      return f.same_customer && f.same_written_at && f.same_content && f.same_photo;

    case 'RECEIPT':
      return (
        (f.same_customer && f.same_content && f.same_photo) ||
        (f.same_customer && f.same_receipt)
      );

    default:
      return false;
  }
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd judgment-engine && npm test -- duplicate
```

Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add judgment-engine/src/rules/duplicate.ts judgment-engine/tests/duplicate.test.ts
git commit -m "feat: implement PRD 8.4 duplicate review rule"
```

---

### Task 4: 영수증 객관 규칙 (PRD 8.3 중 객관적으로 확인 가능한 항목)

**무엇을 완료하는가 (쉬운 설명):** 영수증 후기에서 "영수증 미등록", "여러 장 등록", "앱결제 영수증", "금액/일자/병원명 불일치"처럼 사람이 다시 볼 필요 없이 기계적으로 판단 가능한 보류 사유를 찾아냅니다.

**Files:**
- Create: `judgment-engine/src/rules/receipt.ts`
- Test: `judgment-engine/tests/receipt.test.ts`

**Interfaces:**
- Consumes: `ReviewInput`, `ReceiptInfo` (Task 2)
- Produces: `checkReceiptObjective(input: ReviewInput): { holdReason: string | null; unconfirmed: boolean }` — Task 6에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`judgment-engine/tests/receipt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { checkReceiptObjective } from '../src/rules/receipt';
import type { ReviewInput } from '../types';

function receiptInput(receipt: Partial<NonNullable<ReviewInput['receipt']>>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'RECEIPT',
    content_text: 'text',
    photos: [],
    procedure: { is_before_after_exempt: false },
    receipt: {
      amount_matches: true,
      date_matches: true,
      hospital_name_matches: true,
      photo_count: 1,
      is_app_payment_receipt: false,
      ...receipt,
    },
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
  };
}

describe('checkReceiptObjective', () => {
  it('모든 조건 충족 시 holdReason null, unconfirmed false', () => {
    const result = checkReceiptObjective(receiptInput({}));
    expect(result).toEqual({ holdReason: null, unconfirmed: false });
  });

  it('영수증 미등록(photo_count 0)', () => {
    const result = checkReceiptObjective(receiptInput({ photo_count: 0 }));
    expect(result.holdReason).toBe('receipt-missing');
  });

  it('다수 영수증 등록(photo_count > 1)', () => {
    const result = checkReceiptObjective(receiptInput({ photo_count: 2 }));
    expect(result.holdReason).toBe('receipt-multiple');
  });

  it('앱결제 영수증 등록', () => {
    const result = checkReceiptObjective(receiptInput({ is_app_payment_receipt: true }));
    expect(result.holdReason).toBe('receipt-app-payment');
  });

  it('결제금액 불일치', () => {
    const result = checkReceiptObjective(receiptInput({ amount_matches: false }));
    expect(result.holdReason).toBe('receipt-amount-mismatch');
  });

  it('결제일자 불일치', () => {
    const result = checkReceiptObjective(receiptInput({ date_matches: false }));
    expect(result.holdReason).toBe('receipt-date-mismatch');
  });

  it('병원명 불일치', () => {
    const result = checkReceiptObjective(receiptInput({ hospital_name_matches: false }));
    expect(result.holdReason).toBe('receipt-hospital-mismatch');
  });

  it('금액 일치 여부를 알 수 없으면(null) unconfirmed true', () => {
    const result = checkReceiptObjective(receiptInput({ amount_matches: null }));
    expect(result).toEqual({ holdReason: null, unconfirmed: true });
  });

  it('RECEIPT가 아닌 유형이면 항상 통과', () => {
    const input = receiptInput({});
    input.review_type = 'TICKET_USE';
    input.receipt = undefined;
    expect(checkReceiptObjective(input)).toEqual({ holdReason: null, unconfirmed: false });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd judgment-engine && npm test -- receipt
```

Expected: FAIL — `Cannot find module '../src/rules/receipt'`

- [ ] **Step 3: receipt.ts 구현**

`judgment-engine/src/rules/receipt.ts`:
```ts
import type { ReviewInput } from '../types';

export interface ReceiptCheckResult {
  holdReason: string | null;
  unconfirmed: boolean;
}

/**
 * PRD 8.3 영수증 사진 조건 중 기계적으로 확인 가능한 것들만 체크한다.
 * amount/date/hospital_name matches가 null이면(OCR 자동 대사 불가) unconfirmed=true로
 * 반환해, 호출자가 NEEDS_REVIEW로 보낼 수 있게 한다 (스펙 §8 열린 질문).
 */
export function checkReceiptObjective(input: ReviewInput): ReceiptCheckResult {
  if (input.review_type !== 'RECEIPT' || !input.receipt) {
    return { holdReason: null, unconfirmed: false };
  }

  const r = input.receipt;

  if (r.photo_count === 0) return { holdReason: 'receipt-missing', unconfirmed: false };
  if (r.photo_count > 1) return { holdReason: 'receipt-multiple', unconfirmed: false };
  if (r.is_app_payment_receipt) return { holdReason: 'receipt-app-payment', unconfirmed: false };
  if (r.amount_matches === false) return { holdReason: 'receipt-amount-mismatch', unconfirmed: false };
  if (r.date_matches === false) return { holdReason: 'receipt-date-mismatch', unconfirmed: false };
  if (r.hospital_name_matches === false) return { holdReason: 'receipt-hospital-mismatch', unconfirmed: false };

  const unconfirmed = r.amount_matches === null || r.date_matches === null || r.hospital_name_matches === null;
  return { holdReason: null, unconfirmed };
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd judgment-engine && npm test -- receipt
```

Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add judgment-engine/src/rules/receipt.ts judgment-engine/tests/receipt.test.ts
git commit -m "feat: implement PRD 8.3 objective receipt checks"
```

---

### Task 5: 의미 불명 텍스트 규칙

**무엇을 완료하는가 (쉬운 설명):** "ㄱㄴㄷㄹㅁ", "가나다라마바사", "★★★★★★★★★"처럼 뜻이 없는 후기 내용을 규칙(패턴)으로 걸러냅니다.

**Files:**
- Create: `judgment-engine/src/rules/meaninglessText.ts`
- Test: `judgment-engine/tests/meaninglessText.test.ts`

**Interfaces:**
- Produces: `isMeaninglessText(text: string): boolean` — Task 6에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`judgment-engine/tests/meaninglessText.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isMeaninglessText } from '../src/rules/meaninglessText';

describe('isMeaninglessText', () => {
  it('자모만 나열된 경우 true', () => {
    expect(isMeaninglessText('ㄱㄴㄷㄹㅁ')).toBe(true);
  });

  it('같은 특수문자 반복 true', () => {
    expect(isMeaninglessText('★★★★★★★★★')).toBe(true);
  });

  it('가나다라 순서 나열 true', () => {
    expect(isMeaninglessText('가나다라마바사')).toBe(true);
  });

  it('너무 짧은 텍스트(공백만) true', () => {
    expect(isMeaninglessText('   ')).toBe(true);
  });

  it('시술 관련 정상 후기는 false', () => {
    expect(isMeaninglessText('시술 후 붓기도 금방 가라앉고 만족스러웠어요')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd judgment-engine && npm test -- meaninglessText
```

Expected: FAIL — `Cannot find module '../src/rules/meaninglessText'`

- [ ] **Step 3: meaninglessText.ts 구현**

`judgment-engine/src/rules/meaninglessText.ts`:
```ts
const JAMO_ONLY = /^[ㄱ-ㅎㅏ-ㅣ\s]+$/; // 자음/모음만
const REPEATED_CHAR = /(.)\1{4,}/; // 같은 문자 5회 이상 반복
const KNOWN_FILLER_PHRASES = ['가나다라마바사'];

/**
 * PRD 8.2 "의미를 알 수 없는 내용" 1차 규칙 판별.
 * 오탐이 많다고 판단되면(§8 열린 질문) 이 함수를 AI 판단 경로로 옮기는 방향을 검토한다.
 */
export function isMeaninglessText(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 2) return true;
  if (JAMO_ONLY.test(trimmed)) return true;
  if (REPEATED_CHAR.test(trimmed)) return true;
  if (KNOWN_FILLER_PHRASES.includes(trimmed)) return true;

  return false;
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd judgment-engine && npm test -- meaninglessText
```

Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add judgment-engine/src/rules/meaninglessText.ts judgment-engine/tests/meaninglessText.test.ts
git commit -m "feat: implement meaningless-text heuristic rule"
```

---

### Task 6: 객관적 규칙 오케스트레이터 (`objectiveRules.ts`)

**무엇을 완료하는가 (쉬운 설명):** 앞에서 만든 규칙들(중복, 영수증, 의미불명 텍스트)과 "병원 게시중단 요청"을 순서대로 확인해서, "이미 확정할 수 있는 판정"이 있으면 그 자리에서 확정하고, 없으면 "AI에게 물어봐야 함"이라고 알려주는 함수를 만듭니다.

**Files:**
- Create: `judgment-engine/src/rules/objectiveRules.ts`
- Test: `judgment-engine/tests/objectiveRules.test.ts`

**Interfaces:**
- Consumes: `isDuplicate` (Task 3), `checkReceiptObjective` (Task 4), `isMeaninglessText` (Task 5), `ReviewInput`/`MockJudgment` (Task 2)
- Produces:
  ```ts
  type ObjectiveResult =
    | { decided: true; mock_judgment: MockJudgment; matched_rules: string[]; reasoning: string }
    | { decided: false };
  function runObjectiveRules(input: ReviewInput): ObjectiveResult;
  ```
  Task 9(`engine.ts`)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`judgment-engine/tests/objectiveRules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runObjectiveRules } from '../src/rules/objectiveRules';
import type { ReviewInput } from '../src/types';

function baseInput(overrides: Partial<ReviewInput>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '시술 후 만족스러웠어요',
    photos: [],
    procedure: { is_before_after_exempt: false },
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
    ...overrides,
  };
}

describe('runObjectiveRules', () => {
  it('병원 게시중단 요청이면 즉시 NEEDS_REVIEW', () => {
    const result = runObjectiveRules(baseInput({ hospital_requested_takedown: true }));
    expect(result).toMatchObject({ decided: true, mock_judgment: 'NEEDS_REVIEW' });
  });

  it('중복이면 즉시 AUTO_HOLD_CANDIDATE', () => {
    const result = runObjectiveRules(
      baseInput({
        duplicate_flags: {
          same_customer: true,
          same_written_at: true,
          same_procedure_event: true,
          same_content: true,
          same_photo: true,
          same_receipt: false,
        },
      })
    );
    expect(result).toMatchObject({ decided: true, mock_judgment: 'AUTO_HOLD_CANDIDATE' });
    if (result.decided) expect(result.matched_rules).toContain('8.4-duplicate');
  });

  it('영수증 금액 불일치면 즉시 AUTO_HOLD_CANDIDATE', () => {
    const result = runObjectiveRules(
      baseInput({
        review_type: 'RECEIPT',
        receipt: {
          amount_matches: false,
          date_matches: true,
          hospital_name_matches: true,
          photo_count: 1,
          is_app_payment_receipt: false,
        },
      })
    );
    expect(result).toMatchObject({ decided: true, mock_judgment: 'AUTO_HOLD_CANDIDATE' });
    if (result.decided) expect(result.matched_rules).toContain('receipt-amount-mismatch');
  });

  it('의미 불명 텍스트면 즉시 AUTO_HOLD_CANDIDATE', () => {
    const result = runObjectiveRules(baseInput({ content_text: 'ㄱㄴㄷㄹㅁ' }));
    expect(result).toMatchObject({ decided: true, mock_judgment: 'AUTO_HOLD_CANDIDATE' });
  });

  it('영수증 필드 확인 불가면 NEEDS_REVIEW', () => {
    const result = runObjectiveRules(
      baseInput({
        review_type: 'RECEIPT',
        receipt: {
          amount_matches: null,
          date_matches: true,
          hospital_name_matches: true,
          photo_count: 1,
          is_app_payment_receipt: false,
        },
      })
    );
    expect(result).toMatchObject({ decided: true, mock_judgment: 'NEEDS_REVIEW' });
  });

  it('아무 객관적 사유도 없으면 decided: false (AI 필요)', () => {
    const result = runObjectiveRules(baseInput({}));
    expect(result).toEqual({ decided: false });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd judgment-engine && npm test -- objectiveRules
```

Expected: FAIL — `Cannot find module '../src/rules/objectiveRules'`

- [ ] **Step 3: objectiveRules.ts 구현**

`judgment-engine/src/rules/objectiveRules.ts`:
```ts
import type { MockJudgment, ReviewInput } from '../types';
import { isDuplicate } from './duplicate';
import { checkReceiptObjective } from './receipt';
import { isMeaninglessText } from './meaninglessText';

export type ObjectiveResult =
  | { decided: true; mock_judgment: MockJudgment; matched_rules: string[]; reasoning: string }
  | { decided: false };

export function runObjectiveRules(input: ReviewInput): ObjectiveResult {
  if (input.hospital_requested_takedown) {
    return {
      decided: true,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: ['hospital-takedown-request'],
      reasoning: '병원이 게시중단을 요청한 후기 — 별도 프로세스로 처리 필요',
    };
  }

  if (isDuplicate(input)) {
    return {
      decided: true,
      mock_judgment: 'AUTO_HOLD_CANDIDATE',
      matched_rules: ['8.4-duplicate'],
      reasoning: '동일 고객의 중복 후기로 판단됨 (PRD 8.4 기준 충족)',
    };
  }

  const receiptCheck = checkReceiptObjective(input);
  if (receiptCheck.holdReason) {
    return {
      decided: true,
      mock_judgment: 'AUTO_HOLD_CANDIDATE',
      matched_rules: [receiptCheck.holdReason],
      reasoning: `영수증 조건 미충족: ${receiptCheck.holdReason}`,
    };
  }

  if (isMeaninglessText(input.content_text)) {
    return {
      decided: true,
      mock_judgment: 'AUTO_HOLD_CANDIDATE',
      matched_rules: ['meaningless-text'],
      reasoning: '후기 내용이 의미를 알 수 없는 텍스트로 판단됨',
    };
  }

  if (receiptCheck.unconfirmed) {
    return {
      decided: true,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: ['receipt-fields-unconfirmed'],
      reasoning: '영수증 금액/일자/병원명 자동 대사가 불가능해 사람 확인이 필요함',
    };
  }

  return { decided: false };
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd judgment-engine && npm test -- objectiveRules
```

Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add judgment-engine/src/rules/objectiveRules.ts judgment-engine/tests/objectiveRules.test.ts
git commit -m "feat: combine objective rules into single decision function"
```

---

### Task 7: AI 응답 매핑 (`mapping.ts`, PRD 8.6)

**무엇을 완료하는가 (쉬운 설명):** AI가 "이 사진은 문제 있음", "이 텍스트는 시술과 관련 있음" 같은 세부 판단을 주면, 이걸 최종 "승인후보/자동보류후보/검토필요"와 "사진별 승인/숨김"으로 바꿔주는 로직을 만듭니다.

**Files:**
- Create: `judgment-engine/src/rules/mapping.ts`
- Test: `judgment-engine/tests/mapping.test.ts`

**Interfaces:**
- Consumes: `ReviewInput`, `AiContentJudgment`, `JudgmentResult` (Task 2)
- Produces: `buildResultFromAi(input: ReviewInput, ai: AiContentJudgment): JudgmentResult` — Task 9(`engine.ts`)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`judgment-engine/tests/mapping.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildResultFromAi } from '../src/rules/mapping';
import type { AiContentJudgment, ReviewInput } from '../src/types';

function inputWithPhotos(urls: string[]): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '시술 후 만족스러웠어요',
    photos: urls.map((url) => ({ url, declared_category: 'GENERAL' as const })),
    procedure: { is_before_after_exempt: false },
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
  };
}

describe('buildResultFromAi', () => {
  it('모든 사진과 텍스트가 문제없으면 APPROVE_CANDIDATE', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'APPROVED' }]);
    expect(result.ai_invoked).toBe(true);
  });

  it('사진 2장 중 1장만 무관하면 그 사진만 HIDDEN이고 전체는 승인', () => {
    const input = inputWithPhotos(['https://x/1.jpg', 'https://x/2.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [
        { url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 },
        { url: 'https://x/2.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.8 },
      ],
      confidence: 0.9,
      reasoning: 'photo2는 시술과 무관',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.photo_results).toEqual([
      { url: 'https://x/1.jpg', decision: 'APPROVED' },
      { url: 'https://x/2.jpg', decision: 'HIDDEN', reason: 'irrelevant' },
    ]);
  });

  it('남는 승인 사진이 없으면 AUTO_HOLD_CANDIDATE', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: false, identifiable: true, flag: 'irrelevant', confidence: 0.8 }],
      confidence: 0.8,
      reasoning: '사진이 시술과 무관',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('AUTO_HOLD_CANDIDATE');
  });

  it('사진에 미풍양속 플래그가 있으면 NEEDS_REVIEW (사람 판단 필요)', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: 'public_order', confidence: 0.7 }],
      confidence: 0.7,
      reasoning: '미풍양속 위배 소지 있음',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.photo_results[0]).toEqual({ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'public_order' });
  });

  it('텍스트가 미풍양속 위배면 NEEDS_REVIEW', () => {
    const input = inputWithPhotos(['https://x/1.jpg']);
    const ai: AiContentJudgment = {
      content_relevant: true,
      content_flag: 'public_order',
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: '텍스트에 미풍양속 위배 소지',
    };
    const result = buildResultFromAi(input, ai);
    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd judgment-engine && npm test -- mapping
```

Expected: FAIL — `Cannot find module '../src/rules/mapping'`

- [ ] **Step 3: mapping.ts 구현**

`judgment-engine/src/rules/mapping.ts`:
```ts
import type { AiContentJudgment, JudgmentResult, PhotoResult, ReviewInput } from '../types';

/**
 * PRD 8.6 매핑: AI가 준 텍스트/사진별 세부 판단을 최종 3단계 판정과
 * 사진별 승인/숨김 결과로 합성한다. AI는 세부 항목만 판단하고,
 * 최종 분류 규칙은 여기(코드)에서 결정한다 (스펙 §5.1).
 */
export function buildResultFromAi(input: ReviewInput, ai: AiContentJudgment): JudgmentResult {
  const photo_results: PhotoResult[] = input.photos.map((photo) => {
    const judged = ai.photos.find((p) => p.url === photo.url);
    if (!judged || !judged.relevant || !judged.identifiable || judged.flag) {
      return {
        url: photo.url,
        decision: 'HIDDEN',
        reason: judged?.flag ?? 'irrelevant',
      };
    }
    return { url: photo.url, decision: 'APPROVED' };
  });

  const hasPublicOrderPhoto = photo_results.some((p) => p.decision === 'HIDDEN' && p.reason === 'public_order');
  const contentNeedsReview = ai.content_flag === 'public_order';
  const contentHold = ai.content_flag === 'meaningless' || ai.content_relevant === false;
  const approvedPhotoCount = photo_results.filter((p) => p.decision === 'APPROVED').length;

  const matched_rules: string[] = [];
  if (contentHold) matched_rules.push('ai-content-irrelevant-or-meaningless');
  if (contentNeedsReview) matched_rules.push('ai-content-public-order');
  if (hasPublicOrderPhoto) matched_rules.push('ai-photo-public-order');
  if (approvedPhotoCount === 0) matched_rules.push('no-approved-photo-remaining');

  let mock_judgment: JudgmentResult['mock_judgment'];
  if (contentNeedsReview || hasPublicOrderPhoto) {
    mock_judgment = 'NEEDS_REVIEW';
  } else if (contentHold || approvedPhotoCount === 0) {
    mock_judgment = 'AUTO_HOLD_CANDIDATE';
  } else {
    mock_judgment = 'APPROVE_CANDIDATE';
  }

  const photoConfidences = ai.photos.map((p) => p.confidence);
  const confidence = Math.min(ai.confidence, ...(photoConfidences.length ? photoConfidences : [1]));

  return {
    review_id: input.review_id,
    mock_judgment,
    matched_rules,
    confidence,
    reasoning: ai.reasoning,
    ai_invoked: true,
    photo_results,
  };
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd judgment-engine && npm test -- mapping
```

Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add judgment-engine/src/rules/mapping.ts judgment-engine/tests/mapping.test.ts
git commit -m "feat: map AI judgments to final verdict per PRD 8.6"
```

---

### Task 8: AI 어댑터 (`aiAdapter.ts`)

**무엇을 완료하는가 (쉬운 설명):** 프록시 서버에 "이 사진들과 텍스트 좀 판단해줘"라고 요청을 보내고 응답을 받아오는 코드를 만듭니다. 실제 네트워크 호출 없이, 가짜 응답으로 테스트합니다.

**Files:**
- Create: `judgment-engine/src/ai/aiAdapter.ts`
- Test: `judgment-engine/tests/aiAdapter.test.ts`

**Interfaces:**
- Consumes: `ReviewInput`, `AiContentJudgment` (Task 2)
- Produces:
  ```ts
  interface AiAdapterConfig { proxyUrl: string; timeoutMs?: number; }
  function judgeContentWithAi(
    input: Pick<ReviewInput, 'review_type' | 'content_text' | 'photos'>,
    config: AiAdapterConfig
  ): Promise<AiContentJudgment>;
  ```
  Task 9(`engine.ts`)에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`judgment-engine/tests/aiAdapter.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeContentWithAi } from '../src/ai/aiAdapter';

const sampleInput = {
  review_type: 'TICKET_USE' as const,
  content_text: '시술 후 만족스러웠어요',
  photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' as const }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('judgeContentWithAi', () => {
  it('프록시가 정상 응답하면 파싱된 결과를 반환', async () => {
    const fakeResponse = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    } as unknown as Response);

    const result = await judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' });
    expect(result).toEqual(fakeResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://proxy.example/api/judge-content',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('프록시가 실패 상태를 반환하면 에러를 던짐', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' })
    ).rejects.toThrow('proxy responded with status 500');
  });

  it('응답 형태가 이상하면 에러를 던짐', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nonsense: true }) } as unknown as Response);

    await expect(
      judgeContentWithAi(sampleInput, { proxyUrl: 'https://proxy.example/api/judge-content' })
    ).rejects.toThrow('invalid AI response shape');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd judgment-engine && npm test -- aiAdapter
```

Expected: FAIL — `Cannot find module '../src/ai/aiAdapter'`

- [ ] **Step 3: aiAdapter.ts 구현**

`judgment-engine/src/ai/aiAdapter.ts`:
```ts
import type { AiContentJudgment, ReviewInput } from '../types';

export interface AiAdapterConfig {
  proxyUrl: string;
  timeoutMs?: number;
}

/**
 * 순수 함수: DOM/chrome API에 의존하지 않고 fetch만 사용하므로
 * 브라우저 확장(background)과 Node.js 양쪽에서 동일하게 동작한다.
 */
export async function judgeContentWithAi(
  input: Pick<ReviewInput, 'review_type' | 'content_text' | 'photos'>,
  config: AiAdapterConfig
): Promise<AiContentJudgment> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);

  try {
    const res = await fetch(config.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        review_type: input.review_type,
        content_text: input.content_text,
        photos: input.photos.map((p) => ({ url: p.url, declared_category: p.declared_category })),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`proxy responded with status ${res.status}`);
    }

    const data = await res.json();
    return validateAiResponse(data);
  } finally {
    clearTimeout(timeout);
  }
}

function validateAiResponse(data: unknown): AiContentJudgment {
  const d = data as Partial<AiContentJudgment> | null;
  if (
    !d ||
    typeof d.content_relevant !== 'boolean' ||
    !Array.isArray(d.photos) ||
    typeof d.confidence !== 'number' ||
    typeof d.reasoning !== 'string'
  ) {
    throw new Error('invalid AI response shape');
  }
  return d as AiContentJudgment;
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd judgment-engine && npm test -- aiAdapter
```

Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add judgment-engine/src/ai/aiAdapter.ts judgment-engine/tests/aiAdapter.test.ts
git commit -m "feat: add proxy-calling AI adapter with response validation"
```

---

### Task 9: 엔진 오케스트레이션 (`engine.ts`) + `index.ts` export

**무엇을 완료하는가 (쉬운 설명):** 지금까지 만든 조각들(객관적 규칙, AI 어댑터, 매핑)을 하나로 연결한 최종 함수 `judgeReview()`를 만듭니다. 이게 이 패키지의 "대표 기능"입니다.

**Files:**
- Create: `judgment-engine/src/engine.ts`
- Modify: `judgment-engine/src/index.ts`
- Test: `judgment-engine/tests/engine.test.ts`

**Interfaces:**
- Consumes: `runObjectiveRules` (Task 6), `judgeContentWithAi` (Task 8), `buildResultFromAi` (Task 7)
- Produces: `judgeReview(input: ReviewInput, aiConfig: AiAdapterConfig): Promise<JudgmentResult>` — 크롬 확장/2차 서버가 최종적으로 호출하는 함수.

- [ ] **Step 1: 실패하는 테스트 작성**

`judgment-engine/tests/engine.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeReview } from '../src/engine';
import type { ReviewInput } from '../src/types';

function baseInput(overrides: Partial<ReviewInput>): ReviewInput {
  return {
    review_id: 'r1',
    review_type: 'TICKET_USE',
    content_text: '시술 후 만족스러웠어요',
    photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }],
    procedure: { is_before_after_exempt: false },
    duplicate_flags: {
      same_customer: false,
      same_written_at: false,
      same_procedure_event: false,
      same_content: false,
      same_photo: false,
      same_receipt: false,
    },
    hospital_requested_takedown: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('judgeReview', () => {
  it('객관적 규칙으로 확정되면 AI를 호출하지 않음', async () => {
    global.fetch = vi.fn();
    const input = baseInput({ hospital_requested_takedown: true });

    const result = await judgeReview(input, { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.ai_invoked).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('객관적 규칙이 없으면 AI를 호출해 결과를 매핑', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content_relevant: true,
        content_flag: null,
        photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
        confidence: 0.9,
        reasoning: 'ok',
      }),
    } as unknown as Response);

    const result = await judgeReview(baseInput({}), { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('APPROVE_CANDIDATE');
    expect(result.ai_invoked).toBe(true);
  });

  it('AI 호출이 실패해도 예외를 던지지 않고 NEEDS_REVIEW를 반환', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await judgeReview(baseInput({}), { proxyUrl: 'https://proxy.example/api/judge-content' });

    expect(result.mock_judgment).toBe('NEEDS_REVIEW');
    expect(result.ai_invoked).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.photo_results).toEqual([{ url: 'https://x/1.jpg', decision: 'HIDDEN', reason: 'ai_error' }]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd judgment-engine && npm test -- engine
```

Expected: FAIL — `Cannot find module '../src/engine'`

- [ ] **Step 3: engine.ts 구현**

`judgment-engine/src/engine.ts`:
```ts
import type { JudgmentResult, ReviewInput } from './types';
import { runObjectiveRules } from './rules/objectiveRules';
import { buildResultFromAi } from './rules/mapping';
import { judgeContentWithAi, type AiAdapterConfig } from './ai/aiAdapter';

/**
 * 이 패키지의 대표 함수. 절대 예외를 던지지 않고 항상 JudgmentResult를 반환한다
 * (스펙 §5.2 "안전한 쪽(검토필요)으로 떨어뜨린다").
 */
export async function judgeReview(input: ReviewInput, aiConfig: AiAdapterConfig): Promise<JudgmentResult> {
  const objective = runObjectiveRules(input);

  if (objective.decided) {
    const decision = objective.mock_judgment === 'APPROVE_CANDIDATE' ? 'APPROVED' : 'HIDDEN';
    return {
      review_id: input.review_id,
      mock_judgment: objective.mock_judgment,
      matched_rules: objective.matched_rules,
      confidence: 1,
      reasoning: objective.reasoning,
      ai_invoked: false,
      photo_results: input.photos.map((p) => ({ url: p.url, decision })),
    };
  }

  try {
    const ai = await judgeContentWithAi(input, aiConfig);
    return buildResultFromAi(input, ai);
  } catch {
    return {
      review_id: input.review_id,
      mock_judgment: 'NEEDS_REVIEW',
      matched_rules: ['ai-error'],
      confidence: 0,
      reasoning: 'AI 판단 실패 — 검수자 직접 확인 필요',
      ai_invoked: true,
      photo_results: input.photos.map((p) => ({ url: p.url, decision: 'HIDDEN', reason: 'ai_error' })),
    };
  }
}
```

- [ ] **Step 4: index.ts에서 공개 API export**

`judgment-engine/src/index.ts`:
```ts
export { judgeReview } from './engine';
export type { AiAdapterConfig } from './ai/aiAdapter';
export type {
  ReviewInput,
  ReviewPhoto,
  ReviewType,
  PhotoCategory,
  ReceiptInfo,
  DuplicateFlags,
  MockJudgment,
  PhotoResult,
  JudgmentResult,
  AiContentJudgment,
  AiPhotoJudgment,
} from './types';
```

- [ ] **Step 5: 전체 테스트 재실행**

```bash
cd judgment-engine && npm test
```

Expected: PASS (모든 테스트, 이전 태스크 포함 총 30개 이상)

- [ ] **Step 6: 커밋**

```bash
git add judgment-engine/src/engine.ts judgment-engine/src/index.ts judgment-engine/tests/engine.test.ts
git commit -m "feat: wire objective rules, AI adapter, and mapping into judgeReview"
```

---

### Task 10: 프록시 스캐폴드 + 프롬프트 빌더 (네트워크 호출 없이 테스트 가능한 부분)

**무엇을 완료하는가 (쉬운 설명):** AI에게 보낼 "질문 문구(프롬프트)"를 만드는 부분을 먼저 만듭니다. 이 부분은 실제 AI를 부르지 않아도 테스트할 수 있습니다.

**Files:**
- Create: `proxy/package.json`
- Create: `proxy/tsconfig.json`
- Create: `proxy/vitest.config.ts`
- Create: `proxy/.env.example`
- Create: `proxy/src/prompt.ts`
- Test: `proxy/tests/prompt.test.ts`

**Interfaces:**
- Produces: `buildPrompt(reviewType: string, contentText: string, photoCount: number): string` — Task 11에서 사용.

- [ ] **Step 1: 프록시 프로젝트 스캐폴드 생성**

`proxy/package.json`:
```json
{
  "name": "judgment-engine-proxy",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "dev": "vercel dev"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0"
  },
  "devDependencies": {
    "@vercel/node": "^3.2.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

`proxy/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["api", "src"]
}
```

`proxy/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

`proxy/.env.example`:
```
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

- [ ] **Step 2: 실패하는 테스트 작성**

`proxy/tests/prompt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/prompt';

describe('buildPrompt', () => {
  it('후기 유형, 내용, 사진 수를 프롬프트에 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '시술 후 만족스러웠어요', 2);
    expect(prompt).toContain('TICKET_USE');
    expect(prompt).toContain('시술 후 만족스러웠어요');
    expect(prompt).toContain('2장');
  });

  it('승인/보류 기준 문구를 포함한다', () => {
    const prompt = buildPrompt('RECEIPT', 'text', 1);
    expect(prompt).toContain('미풍양속');
    expect(prompt).toContain('식별');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
cd proxy && npm install && npm test
```

Expected: FAIL — `Cannot find module '../src/prompt'`

- [ ] **Step 4: prompt.ts 구현**

`proxy/src/prompt.ts`:
```ts
/**
 * PRD §8.2(후기 내용/사진 기준)를 그대로 지시문으로 포함해,
 * 모델이 정책 문서 기준으로만 판단하게 한다 (스펙 §5.1).
 */
export function buildPrompt(reviewType: string, contentText: string, photoCount: number): string {
  return `당신은 후기 검수 담당자를 돕는 판정 보조자입니다. 아래 정책 기준으로만 판단하세요.

[승인 기준 - 후기 내용] 시술과 관련된 내용이면 승인. 의미를 알 수 없는 내용(예: ㄱㄴㄷㄹㅁ, 가나다라마바사, ★★★★★★★★★)이거나 사회 공공질서/미풍양속에 위배되면 보류.

[승인 기준 - 사진] 시술 부위/신체 일부, 시술 관련 장비·약품, 병원 내외부, 앱 결제 화면, 관련 캡쳐 화면은 승인. 식별 불가하거나 미풍양속에 위배되거나 시술과 무관하면 보류.

후기 유형: ${reviewType}
후기 내용: ${contentText}
등록된 사진 수: ${photoCount}장 (아래 이미지 순서와 photos 배열 순서가 동일합니다)

각 사진과 후기 내용을 위 기준으로 개별 판단해 submit_judgment 도구로 결과를 제출하세요.`;
}
```

- [ ] **Step 5: 테스트 재실행**

```bash
cd proxy && npm test
```

Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add proxy/package.json proxy/tsconfig.json proxy/vitest.config.ts proxy/.env.example proxy/src/prompt.ts proxy/tests/prompt.test.ts
git commit -m "chore: scaffold proxy project and prompt builder"
```

---

### Task 11: Claude API 연동 핸들러 (`api/judge-content.ts`)

**무엇을 완료하는가 (쉬운 설명):** 실제로 Claude에게 사진+텍스트를 보내고 구조화된 답변을 받아오는 서버 함수를 만듭니다. 진짜 Claude API 대신 "가짜 응답을 주는 대역"으로 테스트해서, API 키 없이도 로직이 맞는지 확인합니다.

**Files:**
- Create: `proxy/api/judge-content.ts`
- Test: `proxy/tests/handler.test.ts`

**Interfaces:**
- Consumes: `buildPrompt` (Task 10)
- Produces: `createHandler(client: AnthropicLike)` — Vercel이 최종적으로 실행하는 `export default` 핸들러의 팩토리. 테스트에서는 가짜 client를 주입.

- [ ] **Step 1: 실패하는 테스트 작성**

`proxy/tests/handler.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createHandler } from '../api/judge-content';

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('judge-content handler', () => {
  it('POST가 아니면 405 반환', async () => {
    const handler = createHandler({ messages: { create: vi.fn() } } as any);
    const req: any = { method: 'GET' };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('body가 유효하지 않으면 400 반환', async () => {
    const handler = createHandler({ messages: { create: vi.fn() } } as any);
    const req: any = { method: 'POST', body: { content_text: 123 } };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('Claude 응답의 tool_use.input을 그대로 반환', async () => {
    const toolResult = {
      content_relevant: true,
      content_flag: null,
      photos: [{ url: 'https://x/1.jpg', relevant: true, identifiable: true, flag: null, confidence: 0.9 }],
      confidence: 0.9,
      reasoning: 'ok',
    };
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', name: 'submit_judgment', input: toolResult }],
    });
    const handler = createHandler({ messages: { create } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [{ url: 'https://x/1.jpg', declared_category: 'GENERAL' }] },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5', tool_choice: { type: 'tool', name: 'submit_judgment' } })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(toolResult);
  });

  it('Claude가 tool_use를 반환하지 않으면 502', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'oops' }] });
    const handler = createHandler({ messages: { create } } as any);
    const req: any = {
      method: 'POST',
      body: { review_type: 'TICKET_USE', content_text: 'ok', photos: [] },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd proxy && npm test -- handler
```

Expected: FAIL — `Cannot find module '../api/judge-content'`

- [ ] **Step 3: judge-content.ts 구현**

`proxy/api/judge-content.ts`:
```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt } from '../src/prompt';

interface AnthropicLike {
  messages: {
    create: (params: Record<string, unknown>) => Promise<{ content: Array<Record<string, unknown>> }>;
  };
}

const JUDGE_TOOL = {
  name: 'submit_judgment',
  description: '후기 텍스트와 사진에 대한 판단 결과를 제출한다',
  input_schema: {
    type: 'object',
    properties: {
      content_relevant: { type: 'boolean' },
      content_flag: { type: ['string', 'null'], enum: ['meaningless', 'public_order', null] },
      photos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            relevant: { type: 'boolean' },
            identifiable: { type: 'boolean' },
            flag: { type: ['string', 'null'], enum: ['unidentifiable', 'public_order', 'irrelevant', null] },
            confidence: { type: 'number' },
          },
          required: ['url', 'relevant', 'identifiable', 'flag', 'confidence'],
        },
      },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['content_relevant', 'content_flag', 'photos', 'confidence', 'reasoning'],
  },
} as const;

interface JudgeRequestBody {
  review_type: string;
  content_text: string;
  photos: Array<{ url: string; declared_category: string }>;
}

function isValidBody(body: unknown): body is JudgeRequestBody {
  const b = body as Partial<JudgeRequestBody> | null;
  return !!b && typeof b.content_text === 'string' && Array.isArray(b.photos);
}

export function createHandler(client: AnthropicLike) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }

    if (!isValidBody(req.body)) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }

    const { review_type, content_text, photos } = req.body;

    const imageBlocks = photos.map((p) => ({
      type: 'image' as const,
      source: { type: 'url' as const, url: p.url },
    }));

    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      tools: [JUDGE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_judgment' },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildPrompt(review_type, content_text, photos.length) }, ...imageBlocks],
        },
      ],
    });

    const toolUse = message.content.find((block) => block.type === 'tool_use');
    if (!toolUse) {
      res.status(502).json({ error: 'AI did not return structured judgment' });
      return;
    }

    res.status(200).json((toolUse as { input: unknown }).input);
  };
}

export default createHandler(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
```

- [ ] **Step 4: 테스트 재실행**

```bash
cd proxy && npm test -- handler
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add proxy/api/judge-content.ts proxy/tests/handler.test.ts
git commit -m "feat: implement Claude API proxy handler with injectable client"
```

---

### Task 12: 실제 Gemini API 연동 스모크 테스트 (M4, 수동 검증)

> **2026-07-24 갱신:** 이 태스크는 원래 Claude 기준으로 작성되었으나, Task 11 완료 후 Anthropic 계정 크레딧 부족으로 막혀 AI 제공자를 Google Gemini(`@google/genai`)로 교체한 뒤 실행했다. 아래 내용은 실제로 커밋된 Gemini 기반 코드를 반영한다.

**무엇을 완료하는가 (쉬운 설명):** 지금까지는 전부 "가짜 응답"으로 테스트했습니다. 이 단계에서는 실제 Gemini API 키를 넣고, 실제(익명화된) 후기 예시 몇 개를 넣어봐서 사람이 눈으로 결과가 그럴듯한지 확인합니다. 이건 자동으로 pass/fail 나는 테스트가 아니라 "사람이 보는 점검"입니다.

**Files:**
- Create: `proxy/scripts/smoke-test.ts`
- Modify: `proxy/package.json` (스크립트 추가)

**Interfaces:**
- Consumes: `createHandler`, 실제 `GoogleGenAI` 클라이언트 (Task 11, Gemini 이관 이후)
- Produces: 콘솔에 사람이 읽을 판정 결과 출력 (자동 테스트 아님)

- [x] **Step 1: 스모크 테스트 스크립트 작성**

`proxy/scripts/smoke-test.ts`:
```ts
import { GoogleGenAI } from '@google/genai';
import { createHandler } from '../api/judge-content';

/**
 * 수동 실행 전용 스크립트. GEMINI_API_KEY 환경변수가 필요하다.
 * 실행: npm run smoke-test -- (proxy 디렉토리에서)
 * 자동 CI 테스트에는 포함하지 않는다 — 실제 과금이 발생하고 결과가 비결정적이기 때문.
 */
const SAMPLE_CASES = [
  {
    review_type: 'TICKET_USE',
    content_text: '시술 후 붓기도 금방 가라앉고 만족스러웠어요',
    photos: [{ url: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c', declared_category: 'GENERAL' }],
  },
  {
    review_type: 'TICKET_USE',
    content_text: 'ㄱㄴㄷㄹㅁ',
    photos: [{ url: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c', declared_category: 'GENERAL' }],
  },
];

async function main() {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const handler = createHandler(client);

  for (const testCase of SAMPLE_CASES) {
    const res = {
      status: (_code: number) => res,
      json: (body: unknown) => {
        console.log(`\n입력: ${testCase.content_text}`);
        console.log('응답:', JSON.stringify(body, null, 2));
        return res;
      },
    };
    await handler({ method: 'POST', body: testCase } as any, res as any);
  }
}

main().catch((err) => {
  console.error('스모크 테스트 실패:', err);
  process.exit(1);
});
```

- [x] **Step 2: package.json에 실행 스크립트 추가**

`proxy/package.json`의 `"scripts"`에 추가:
```json
"smoke-test": "tsx scripts/smoke-test.ts"
```

`devDependencies`에 `tsx` 추가:
```json
"tsx": "^4.16.2"
```

- [x] **Step 3: 의존성 설치**

```bash
cd proxy && npm install
```

- [ ] **Step 4: 실제 API 키로 수동 실행 (사람이 직접 확인)**

```bash
cd proxy && GEMINI_API_KEY=실제키 npm run smoke-test
```

Expected: 콘솔에 두 사례에 대한 판정 결과가 출력됨. 첫 번째("만족스러웠어요")는 `content_relevant: true`, 두 번째("ㄱㄴㄷㄹㅁ")는 `content_flag: "meaningless"`에 가까운 응답이 나오는지 **사람이 직접 확인**한다. (참고: 이 엔진 단계에서는 첫 번째 규칙 체크에서 이미 의미불명 텍스트가 걸러지므로, 두 번째 사례는 실제로는 `objectiveRules.ts`가 AI 호출 전에 확정한다 — 이 스모크 테스트는 프록시 단독 동작만 확인하는 것이다.)

- [ ] **Step 5: 결과를 기록하고 커밋**

확인 결과를 `docs/superpowers/plans/2026-07-23-judgment-engine.md` 옆에 메모(예: `docs/superpowers/smoke-test-log.md`)로 남기고 커밋한다.

```bash
git add proxy/scripts/smoke-test.ts proxy/package.json docs/superpowers/smoke-test-log.md
git commit -m "chore: add manual smoke-test script for real Gemini API validation"
```

---

## Self-Review 결과

- **스펙 커버리지**: §3 데이터 인터페이스(Task 2), §4 판정 흐름(Task 6, 9), §5 AI 어댑터/프록시(Task 8, 10, 11), §6 테스트 전략(전 태스크 TDD + Task 12 스모크), §7 재사용 지점(구조 자체가 이를 보장, 별도 태스크 불필요) 모두 태스크로 매핑됨.
- **플레이스홀더 스캔**: "TODO"/"나중에" 등 표현 없음. 모든 스텝에 실제 코드 포함.
- **타입 일관성**: `ReviewInput`/`JudgmentResult`/`AiContentJudgment`가 Task 2에서 정의된 그대로 Task 3~11에서 동일한 필드명으로 사용됨 확인.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-23-judgment-engine.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 태스크마다 새 서브에이전트를 띄워 구현하고, 태스크 사이마다 검토합니다. 빠르게 반복할 수 있습니다.

**2. Inline Execution** - 이 세션에서 태스크를 순서대로 실행하고, 묶음 단위로 체크포인트를 두고 검토합니다.

**어느 방식으로 진행할까요?**
