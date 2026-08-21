import type { AiAdapterConfig } from 'judgment-engine';
import type { CacheStore } from './cache';
import { judgeListRow, judgeDetail } from './judge';
import { captureActualResults } from './captureResult';
import { computeListDuplicateFlags } from '../parsing/duplicateFlags';
import { computeFingerprint } from '../shared/fingerprint';
import type { CacheEntry, ExtensionMessage, ExtensionResponse } from '../shared/types';

export interface MessageHandlerDeps {
  cacheStore: CacheStore;
  aiConfig: AiAdapterConfig;
  captureUrl?: string;
}

/**
 * 모의판정 1건마다(AI 호출 여부 무관) 후기 내용/사진/판정 결과를 proxy에 보내 디스크에 캡처한다.
 * 실패해도 판정 결과에 영향을 주지 않는다.
 */
async function captureMockJudgment(
  captureUrl: string | undefined,
  review_id: string,
  review_type: string,
  content_text: string,
  photos: Array<{ url: string; declared_category: string }>,
  judgment: unknown
): Promise<void> {
  if (!captureUrl) return;
  try {
    await fetch(captureUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id, review_type, content_text, photos, judgment }),
    });
  } catch {
    // 캡처 실패는 판정 결과에 영향을 주지 않는다
  }
}

export async function handleMessage(message: ExtensionMessage, deps: MessageHandlerDeps): Promise<ExtensionResponse> {
  const { cacheStore, aiConfig, captureUrl } = deps;

  switch (message.type) {
    case 'JUDGE_LIST': {
      // 목록 판정은 많으면 300건 이상이라 동시에 쏘면 AI 쪽 rate limit에 걸린다(§ai-error 대량 발생).
      // 그래서 병렬이 아니라 한 건씩 순차로 처리한다.
      const entries: CacheEntry[] = [];
      for (const row of message.rows) {
        const fingerprint = computeFingerprint(row);
        const existing = await cacheStore.get(row.review_id);
        if (!message.force && existing && existing.fingerprint === fingerprint) {
          entries.push(existing);
          continue;
        }

        const duplicateFlags = await computeListDuplicateFlags(row, message.rows);
        const result = await judgeListRow(row, duplicateFlags, aiConfig);
        await captureMockJudgment(captureUrl, row.review_id, row.review_type, row.content_text, row.photos, result);
        const entry: CacheEntry = {
          review_id: row.review_id,
          tier: 'list',
          fingerprint,
          duplicate_flags: duplicateFlags,
          result,
          checked_at: new Date().toISOString(),
        };
        await cacheStore.set(entry);
        entries.push(entry);
      }
      return { type: 'JUDGE_LIST_RESULT', entries };
    }

    case 'JUDGE_DETAIL': {
      const existing = await cacheStore.get(message.detail.review_id);
      const duplicateFlags = existing?.duplicate_flags ?? {
        same_customer: false,
        same_hospital_name: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: false,
      };
      const result = await judgeDetail(message.detail, duplicateFlags, aiConfig);
      await captureMockJudgment(
        captureUrl,
        message.detail.review_id,
        message.detail.review_type,
        message.detail.content_text,
        message.detail.photos,
        result
      );
      const entry: CacheEntry = {
        review_id: message.detail.review_id,
        tier: 'detail',
        fingerprint: computeFingerprint(message.detail),
        duplicate_flags: duplicateFlags,
        result,
        checked_at: new Date().toISOString(),
      };
      await cacheStore.set(entry);
      return { type: 'JUDGE_DETAIL_RESULT', entry };
    }

    case 'GET_CACHE': {
      const entry = await cacheStore.get(message.reviewId);
      return { type: 'CACHE_ENTRY', entry: entry ?? null };
    }

    case 'CAPTURE_STATUS': {
      await captureActualResults(message.rows, cacheStore);
      return { type: 'CAPTURE_DONE' };
    }

    case 'SAVE_FEEDBACK': {
      const existing = await cacheStore.get(message.reviewId);
      if (!existing) return { type: 'FEEDBACK_SAVED', entry: null };

      const updated: CacheEntry = { ...existing, reviewer_feedback: message.feedback };
      await cacheStore.set(updated);
      return { type: 'FEEDBACK_SAVED', entry: updated };
    }
  }
}
