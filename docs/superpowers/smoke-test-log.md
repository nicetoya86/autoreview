# Task 12 스모크 테스트 로그

- 실행일: 2026-07-24
- 대상: `proxy/scripts/smoke-test.ts` (`npm run smoke-test`)
- AI 제공자: Google Gemini (`gemini-2.5-flash`, `@google/genai`) — 원래 계획은 Claude였으나, 스모크 테스트 도중 Anthropic 계정 크레딧 부족(`Your credit balance is too low...`)으로 막혀 사용자 결정에 따라 Gemini로 영구 이관했다(관련 커밋: `0612871`).

## 실행 결과 (사람 확인)

**사례 1** — 입력: "시술 후 붓기도 금방 가라앉고 만족스러웠어요"
```json
{
  "content_relevant": true,
  "content_flag": null,
  "photos": [
    { "url": "image_1.jpg", "relevant": true, "identifiable": true, "flag": null, "confidence": 1 }
  ],
  "confidence": 1,
  "reasoning": "후기 내용은 시술 후 경험에 대한 긍정적인 언급으로 시술과 관련된 내용에 해당하여 승인 기준에 부합합니다. 사진은 시술이 진행 중인 신체 부위(얼굴)와 시술 관련 장비(바늘)를 명확하게 보여주며, 식별 가능하고 시술과 관련성이 높아 승인 기준에 부합합니다."
}
```
→ 정상 후기로 승인 판단. **기대와 일치.**

**사례 2** — 입력: "ㄱㄴㄷㄹㅁ"
```json
{
  "content_relevant": false,
  "content_flag": "meaningless",
  "photos": [
    { "url": "image.jpg", "relevant": true, "identifiable": true, "flag": null, "confidence": 0.95 }
  ],
  "confidence": 0.95,
  "reasoning": "후기 내용 'ㄱㄴㄷㄹㅁ'은 의미를 알 수 없는 내용에 해당하여 보류됩니다. 사진은 시술 부위와 시술 관련 장비를 포함하며, 인물이 식별 가능하여 승인 기준을 만족합니다."
}
```
→ `content_flag: "meaningless"`로 정확히 판단. **기대와 일치.** (참고: 실제 파이프라인에서는 `objectiveRules.ts`의 `isMeaninglessText`가 AI 호출 전에 이미 이 사례를 걸러내므로, 이 결과는 프록시 단독 동작 확인 용도다.)

## 발견된 문제와 조치

두 사례 모두 `photos[].url`이 입력 URL(`https://images.unsplash.com/photo-...`)이 아니라 Gemini가 자체적으로 붙인 라벨(`image_1.jpg`, `image.jpg`)로 반환됨을 확인했다.

`judgment-engine/src/rules/mapping.ts`의 `buildResultFromAi`가 `ai.photos.find(p => p.url === photo.url)`로 **URL 문자열 일치**를 기준으로 AI 판단을 입력 사진에 매칭하고 있었기 때문에, 이 상태로 실서비스에 나갔다면 모든 사진이 매칭 실패로 간주되어 AI의 실제 판단과 무관하게 전부 `HIDDEN(irrelevant)` 처리될 뻔했다.

조치: 프롬프트가 이미 "이미지 순서와 photos 배열 순서가 동일함"을 보장하므로, URL 동등 비교 대신 **배열 인덱스 기준 매칭**으로 수정했다 (커밋 `3bb686b`). 회귀 테스트(`mapping.test.ts` — "AI가 입력 URL과 다른 문자열을 반환해도 순서 기준으로 매칭") 추가, 전체 51개 테스트 통과, `tsc --noEmit` 클린 확인.

## 결론

- 프록시(Gemini) 연동 자체는 정상 동작하며, 두 사례 모두 사람이 보기에 타당한 판정을 반환했다.
- 스모크 테스트가 아니었다면 발견하지 못했을 실제 매칭 버그를 찾아 수정했다 — Task 12(수동 스모크 테스트)의 목적이 정확히 이런 종류의 문제를 잡는 것이었다는 점에서 유효했다.
- Task 12 완료.
