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
}

export async function handleMessage(message: ExtensionMessage, deps: MessageHandlerDeps): Promise<ExtensionResponse> {
  const { cacheStore, aiConfig } = deps;

  switch (message.type) {
    case 'JUDGE_LIST': {
      const entries = await Promise.all(
        message.rows.map(async (row): Promise<CacheEntry> => {
          const fingerprint = computeFingerprint(row);
          const existing = await cacheStore.get(row.review_id);
          if (existing && existing.fingerprint === fingerprint) return existing;

          const duplicateFlags = computeListDuplicateFlags(row, message.rows);
          const result = await judgeListRow(row, duplicateFlags, aiConfig);
          const entry: CacheEntry = {
            review_id: row.review_id,
            tier: 'list',
            fingerprint,
            duplicate_flags: duplicateFlags,
            result,
            checked_at: new Date().toISOString(),
          };
          await cacheStore.set(entry);
          return entry;
        })
      );
      return { type: 'JUDGE_LIST_RESULT', entries };
    }

    case 'JUDGE_DETAIL': {
      const existing = await cacheStore.get(message.detail.review_id);
      const duplicateFlags = existing?.duplicate_flags ?? {
        same_customer: false,
        same_written_at: false,
        same_procedure_event: false,
        same_content: false,
        same_photo: false,
        same_receipt: false,
      };
      const result = await judgeDetail(message.detail, duplicateFlags, aiConfig);
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
