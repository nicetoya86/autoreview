# 후기 텍스트 판정 Few-shot 예시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `buildPrompt()`가 Gemini에 보내는 프롬프트에, 각색된(anonymized) few-shot 예시를 추가해 후기 텍스트 판정(승인/보류)의 애매한 경계 케이스 정확도를 높인다.

**Architecture:** `proxy/src/promptExamples.ts`에 정적 예시 배열(`PromptExample[]`)을 두고, `proxy/src/prompt.ts`의 `buildPrompt()`가 이를 가져와 프롬프트 문자열에 "[참고 예시]" 섹션으로 삽입한다. 사진 판정 로직/문구는 이번 작업에서 건드리지 않는다.

**Tech Stack:** TypeScript, Vitest (기존 `proxy/tests/prompt.test.ts`에 케이스 추가)

## Global Constraints

- 예시 텍스트는 실제 고객 후기 원문을 그대로 쓰지 않는다 — 관찰한 패턴을 각색한 문장만 사용한다 (스펙 §3).
- 사진(포토) 판정 프롬프트 문구(`[승인 기준 - 사진]`)는 이번 작업 범위 밖 — 수정하지 않는다 (스펙 §1 비목표).
- 새 외부 의존성 추가 금지 — 정적 TypeScript 배열로 충분하다 (스펙 §2).
- 예시 개수는 승인 3개 + 보류 2개, 총 5개로 시작한다 (스펙 §3).

---

### Task 1: `promptExamples.ts` 추가 + `buildPrompt()`에 예시 섹션 결합

**Files:**
- Create: `proxy/src/promptExamples.ts`
- Modify: `proxy/src/prompt.ts`
- Test: `proxy/tests/prompt.test.ts`

**Interfaces:**
- Produces: `PromptExample` 타입 (`{ label: 'APPROVE' | 'HOLD'; text: string; reason: string }`), `TEXT_JUDGMENT_EXAMPLES: PromptExample[]` — 둘 다 `proxy/src/promptExamples.ts`에서 export.
- Consumes (in `prompt.ts`): 위 `TEXT_JUDGMENT_EXAMPLES`를 import해 `buildPrompt()` 내부에서만 사용. `buildPrompt(reviewType: string, contentText: string, photoCount: number): string`의 기존 시그니처는 변경하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`proxy/tests/prompt.test.ts` 파일 끝에 새 `describe` 블록을 추가한다:

```ts
describe('buildPrompt - few-shot 예시', () => {
  it('참고 예시 섹션과 각 예시 문장을 포함한다', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', 0);
    expect(prompt).toContain('[참고 예시]');
    expect(prompt).toContain('기대했던 것보다 꼼꼼한 느낌은 아니었어요.');
    expect(prompt).toContain('통증 거의 없었고 직원분들도 친절했어요.');
    expect(prompt).toContain('날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다.');
    expect(prompt).toContain('오늘 점심 뭐 먹지 고민되네요.');
    expect(prompt).toContain('ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ');
  });

  it('예시가 [승인 기준 - 사진] 문구보다 뒤에 온다 (사진 기준은 건드리지 않았음을 확인)', () => {
    const prompt = buildPrompt('TICKET_USE', '아무 내용', 0);
    const photoRuleIndex = prompt.indexOf('[승인 기준 - 사진]');
    const exampleIndex = prompt.indexOf('[참고 예시]');
    expect(photoRuleIndex).toBeGreaterThan(-1);
    expect(exampleIndex).toBeGreaterThan(photoRuleIndex);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd proxy && npm test -- --run prompt.test.ts`
Expected: FAIL — `[참고 예시]` 등의 문자열을 찾지 못해 `toContain` 실패.

- [ ] **Step 3: `promptExamples.ts` 작성**

`proxy/src/promptExamples.ts` 새 파일:

```ts
export interface PromptExample {
  label: 'APPROVE' | 'HOLD';
  text: string;
  reason: string;
}

/**
 * 실제 고객 후기 원문이 아니라, 관리자 화면에서 관찰한 패턴을 각색한 예시다.
 * 명백한 케이스(순수 잡담, ㄱㄴㄷㄹㅁ류)는 buildPrompt()의 기준 문구가 이미 다루므로,
 * 여기서는 애매한 경계 케이스만 다룬다.
 */
export const TEXT_JUDGMENT_EXAMPLES: PromptExample[] = [
  {
    label: 'APPROVE',
    text: '기대했던 것보다 꼼꼼한 느낌은 아니었어요.',
    reason: '불만이어도 시술 경험에 대한 구체적 내용 — 관련성 있음',
  },
  {
    label: 'APPROVE',
    text: '통증 거의 없었고 직원분들도 친절했어요.',
    reason: '짧아도 시술 경험(통증)과 병원 응대를 구체적으로 언급 — 승인',
  },
  {
    label: 'APPROVE',
    text: '날씨도 더운데 오늘 시술받고 왔어요. 다운타임 없어서 좋았습니다.',
    reason: '잡담이 섞여 있어도 시술 관련 내용이 포함되어 있으면 승인',
  },
  {
    label: 'HOLD',
    text: '오늘 점심 뭐 먹지 고민되네요.',
    reason: '시술과 전혀 무관한 잡담만 있음 — 관련없음으로 보류',
  },
  {
    label: 'HOLD',
    text: 'ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ',
    reason: '의미를 알 수 없는 반복 문자 — 보류',
  },
];
```

- [ ] **Step 4: `buildPrompt()`에 예시 섹션 결합**

`proxy/src/prompt.ts` 전체를 아래로 교체한다:

```ts
import { TEXT_JUDGMENT_EXAMPLES } from './promptExamples';

/**
 * PRD §8.2(후기 내용/사진 기준)를 그대로 지시문으로 포함해,
 * 모델이 정책 문서 기준으로만 판단하게 한다 (스펙 §5.1).
 */
export function buildPrompt(reviewType: string, contentText: string, photoCount: number): string {
  const examplesSection = TEXT_JUDGMENT_EXAMPLES.map(
    (e) => `- "${e.text}" → ${e.label === 'APPROVE' ? '승인' : '보류'} (${e.reason})`
  ).join('\n');

  return `당신은 후기 검수 담당자를 돕는 판정 보조자입니다. 아래 정책 기준으로만 판단하세요.

[승인 기준 - 후기 내용] 시술과 관련된 내용이면 승인. 의미를 알 수 없는 내용(예: ㄱㄴㄷㄹㅁ, 가나다라마바사, ★★★★★★★★★)이거나 사회 공공질서/미풍양속에 위배되면 보류.

[승인 기준 - 사진] 시술 부위/신체 일부, 시술 관련 장비·약품, 병원 내외부, 앱 결제 화면, 관련 캡쳐 화면은 승인. 식별 불가하거나 미풍양속에 위배되거나 시술과 무관하면 보류.

[참고 예시]
${examplesSection}

후기 유형: ${reviewType}
후기 내용: ${contentText}
등록된 사진 수: ${photoCount}장 (아래 이미지 순서와 photos 배열 순서가 동일합니다)

각 사진과 후기 내용을 위 기준으로 개별 판단해 지정된 JSON 스키마 형식으로 결과를 제출하세요.`;
}
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `cd proxy && npm test -- --run prompt.test.ts`
Expected: PASS — 기존 2개 테스트 + 새로 추가한 2개 테스트 모두 통과.

- [ ] **Step 6: 전체 테스트 스위트 확인 (회귀 없는지)**

Run: `cd proxy && npm test -- --run`
Expected: PASS — `handler.test.ts` 등 기존 테스트도 영향 없이 통과.

- [ ] **Step 7: 커밋**

```bash
cd "proxy" && git add src/promptExamples.ts src/prompt.ts tests/prompt.test.ts
git commit -m "$(cat <<'EOF'
feat: add anonymized few-shot examples to review-text judgment prompt

Adds a small curated set of paraphrased approve/hold examples covering
ambiguous boundary cases (negative-but-relevant reviews, chit-chat mixed
with relevant content) that the existing rule wording didn't make explicit.
Photo judgment prompt is untouched — deferred to a follow-up.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** §3(데이터 형식) → Step 3. §4(buildPrompt 변경) → Step 4. §5(테스트) → Steps 1,2,5,6. §2(위치: proxy/src/, judgment-engine 아님) → Files 섹션에서 `proxy/src/promptExamples.ts`로 명시. 모두 커버됨.
- **비목표 확인:** 사진 기준 문구(`[승인 기준 - 사진]`)는 Step 4의 교체본에서 원문 그대로 유지됨 — 수정 없음. Step 1의 두 번째 테스트가 이를 회귀 검증한다.
- **타입 일관성:** `PromptExample`은 Task 1 한 곳에서만 정의·사용되므로 이름 불일치 리스크 없음.
