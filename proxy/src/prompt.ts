import { TEXT_JUDGMENT_EXAMPLES } from './promptExamples';

/**
 * PRD §8.2(후기 내용/사진 기준)를 그대로 지시문으로 포함해,
 * 모델이 정책 문서 기준으로만 판단하게 한다 (스펙 §5.1).
 */
export function buildPrompt(
  reviewType: string,
  contentText: string,
  photos: Array<{ declared_category: string; before_after_slot?: 'BEFORE' | 'AFTER' }>,
  procedure?: { is_before_after_exempt: boolean },
  hospitalName?: string
): string {
  const examplesSection = TEXT_JUDGMENT_EXAMPLES.map(
    (e) => `- "${e.text}" → ${e.label === 'APPROVE' ? '승인' : '보류'} (${e.reason})`
  ).join('\n');

  const photoListSection = photos.length
    ? photos
        .map((p, i) => {
          if (p.declared_category !== 'BEFORE_AFTER') return `${i + 1}번: 일반 사진`;
          const slotLabel = p.before_after_slot === 'BEFORE' ? ' (전)' : p.before_after_slot === 'AFTER' ? ' (후)' : '';
          return `${i + 1}번: 시술 전/후 사진${slotLabel}`;
        })
        .join('\n')
    : '(등록된 사진 없음)';

  const beforeAfterPhotos = photos.filter((p) => p.declared_category === 'BEFORE_AFTER');
  const hasBeforeSlot = beforeAfterPhotos.some((p) => p.before_after_slot === 'BEFORE');
  const hasAfterSlot = beforeAfterPhotos.some((p) => p.before_after_slot === 'AFTER');
  const isExemptProcedure = procedure?.is_before_after_exempt === true;
  const onlyOneSlotRegistered = !isExemptProcedure && hasBeforeSlot !== hasAfterSlot;

  const exemptSection = isExemptProcedure
    ? '\n이 후기의 시술은 시술 전/후 촬영이 불가능한 예외 시술로 등록되어 있습니다. \'시술 전/후 사진\'으로 등록된 사진이 실제 전후 비교 사진인지는 확인하지 말고, 처음부터 [승인 기준 - 사진]의 일반 사진 기준으로만 판정하세요.'
    : '';

  const onlyOneSlotSection = onlyOneSlotRegistered
    ? '\n이 후기는 \'시술 전/후 사진\'으로 등록됐지만 전/후 중 한쪽 사진만 첨부되어 있습니다. 이 경우 전후 비교가 성립하는지 판단하지 말고, 무조건 일반 사진으로 유형 변경 후 [승인 기준 - 사진] 기준으로만 판정하고 reasoning에 "일반 사진으로 유형 변경 후 승인 가능" 여부를 명시하세요.'
    : '';

  const hospitalNameContextLine = hospitalName ? `\n후기 등록 병원명: ${hospitalName}` : '';
  const hospitalNameCheckSection = hospitalName
    ? `사진마다 "hospital_name_match" 필드를 반드시 채우세요: 사진에 병원명(간판/로고 등 글자)이 보이면 그 이름이 후기 등록 병원명인 "${hospitalName}"과 일치하는 병원인지 대조해 true/false로 답하세요(건물 외벽에 여러 업체 간판이 함께 있어도 "${hospitalName}"과 일치하는 간판이 하나라도 있으면 true). 병원명 글자가 전혀 안 보이는 사진(의료기기·약품·파우더룸 등 다른 요소로 병원임을 알아본 경우)이거나 병원 내외부 사진이 아니면 null로 두세요. false로 답한 사진은 실제 relevant/flag 판단과 무관하게 이 후기와 무관한 건물/타병원 사진으로 자동 보류 처리됩니다.\n`
    : '';

  return `당신은 후기 검수 담당자를 돕는 판정 보조자입니다. 아래 정책 기준으로만 판단하세요.

후기 내용이 한국어가 아니면 먼저 마음속으로 한국어로 번역한 뒤, 번역된 의미를 기준으로 아래 기준을 그대로 적용해 판단하세요. reasoning은 항상 한국어로 작성하세요.

[승인 기준 - 후기 내용] 시술과 관련된 내용이면 승인. 의미를 알 수 없는 내용(예: ㄱㄴㄷㄹㅁ, 가나다라마바사, ★★★★★★★★★)이거나, 이름·전화번호·이메일 등 개인정보가 포함되거나, 욕설·선정적 표현이 포함되거나, 사회 공공질서/미풍양속에 위배되면 보류.

[후기 내용 판정 참고 예시]
${examplesSection}

[승인 기준 - 사진] 시술 부위/신체 일부, 시술 관련 장비·약품, 병원 내외부, 앱 결제 화면, 관련 캡쳐 화면은 승인. 식별 불가하거나 미풍양속에 위배되거나 시술과 무관하거나 이름·휴대전화번호·이메일 주소 등 개인정보·민감정보가 노출되면 보류.
${hospitalNameCheckSection}"병원 내외부"로 승인하려면 사진에 시술 배너, 병원명(간판/로고), 의료기기, 약품, 파우더룸, 시술 관련 팜플렛/안내문, 의료진(의사·간호사 등) 중 하나 이상이 나와서 병원임을 알아볼 수 있어야 합니다. 이런 요소 없이 복도·천장·바닥·일반 가구·커튼 등 병원인지 특정할 수 없는 공간만 나온 사진은 시술과 무관한 것으로 보고 보류하세요. 리셉션 데스크나 대기실 소파처럼 그 자체만으로는 병원 여부를 특정할 수 없는 공간도 위 요소가 함께 나오지 않으면 보류하세요.
"식별 가능"은 사진에 찍힌 대상(신체 부위/장비/화면/장소 등)이 무엇인지 알아볼 수 있다는 뜻입니다 — 사람 얼굴이나 신원을 알아볼 수 있는지와는 무관합니다. 얼굴이 안 보이거나 가려져 있어도, 또는 사람이 전혀 나오지 않는 사진(장비, 병원 간판, 결제 화면 등)이어도 사진 내용 자체를 알아볼 수 있으면 identifiable: true 입니다. 사진이 너무 흐리거나 어둡거나 잘려서 무엇을 찍었는지조차 알 수 없을 때만 identifiable: false로 판단하세요.

[사진 유형 - 일반 사진 vs 시술 전/후 사진] 고객은 사진을 첨부할 때 '일반 사진' 또는 '시술 전/후 사진' 중 하나로 유형을 선택하고, 시술 전/후 사진은 각 장마다 '전' 또는 '후'로 등록합니다. 아래 [사진 목록]에 각 사진의 등록 유형과 전/후 구분이 표시되어 있습니다.
- '시술 전/후 사진'으로 등록됐다면 '전' 사진과 '후' 사진이 같은 시술 부위를 촬영해 실제로 전후 비교를 보여주는지 확인하세요. 서로 다른 부위이거나 비교 관계가 없는 사진이면 비교 사진으로 인정하지 마세요. 맞으면 위 [승인 기준 - 사진]대로 판단합니다.
- '시술 전/후 사진'으로 등록됐지만 실제로는 전후 비교 사진이 아닌 경우(예: 장비, 병원 내외부, 결제 화면 등), 위 [승인 기준 - 사진]의 다른 승인 대상(장비/병원/결제 화면/캡쳐 등)에 해당하는지 다시 확인하세요. 해당하면 relevant/identifiable을 그 기준대로 true로, flag는 null로 판정하고 reasoning에 "일반 사진으로 유형 변경 후 승인 가능"이라고 명시하세요. 그 기준에도 못 미치면(시술과 무관, 식별 불가, 미풍양속 위배) 유형 변경 없이 그대로 보류 판정하세요.
- '일반 사진'으로 등록된 사진은 시술 전후 비교 사진이 아니어도 됩니다 — [승인 기준 - 사진]대로만 판단하고, 시술 전/후 사진 기준으로 격상 판단하지 마세요.${exemptSection}${onlyOneSlotSection}

후기 유형: ${reviewType}${hospitalNameContextLine}
후기 내용: ${contentText}
[사진 목록]
${photoListSection}
(아래 이미지 순서와 위 목록/photos 배열 순서가 동일합니다)

각 사진과 후기 내용을 위 기준으로 개별 판단해 지정된 JSON 스키마 형식으로 결과를 제출하세요.`;
}
