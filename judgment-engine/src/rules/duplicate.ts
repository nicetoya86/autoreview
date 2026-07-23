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
