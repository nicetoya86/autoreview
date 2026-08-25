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
  same_hospital_name: boolean;
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
  hospital_name?: string;
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
  flag: 'unidentifiable' | 'public_order' | 'irrelevant' | 'personal_info' | null;
  confidence: number;
  // 사진 속 병원명이 후기 등록 병원명과 일치하는지: true=일치, false=다른 병원, null=병원명이 안 보이는 사진.
  // 프롬프트 지시문만으로는 모델이 무시하는 경우가 있어(실측 확인), 이 필드로 강제하고
  // 최종 승인/보류는 mapping.ts에서 결정한다.
  hospital_name_match?: boolean | null;
  // 사진 안에 신체 일부가 하나라도 식별 가능하게 나오는지 (AI 판단). true면 relevant/flag의
  // 종합 판단과 무관하게 mapping.ts에서 승인으로 강제한다 — 동일 유형 사진(예: 손이 나온
  // 일상 사진)에서도 relevant/flag 판단이 오락가락하는 사례가 실측에서 확인됨.
  body_part_visible?: boolean;
}

export interface AiContentJudgment {
  content_relevant: boolean;
  content_flag: 'meaningless' | 'public_order' | 'profanity' | null;
  photos: AiPhotoJudgment[];
  confidence: number;
  reasoning: string;
}
