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
}

export interface AiContentJudgment {
  content_relevant: boolean;
  content_flag: 'meaningless' | 'public_order' | null;
  photos: AiPhotoJudgment[];
  confidence: number;
  reasoning: string;
}
