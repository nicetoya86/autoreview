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
