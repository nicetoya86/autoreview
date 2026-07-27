import type { CacheEntry } from '../shared/types';

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface CacheStore {
  get(reviewId: string): Promise<CacheEntry | undefined>;
  set(entry: CacheEntry): Promise<void>;
  getAll(): Promise<CacheEntry[]>;
}

const KEY_PREFIX = 'rvw-mock-review:';
const INDEX_KEY = 'rvw-mock-review-index';

/**
 * chrome.storage.local(또는 테스트용 fake storage)을 review_id 기준으로 감싼다.
 * getAll()을 위해 review_id 목록을 별도 인덱스 키에 유지한다.
 */
export function createCacheStore(storage: StorageArea): CacheStore {
  return {
    async get(reviewId) {
      const result = await storage.get([KEY_PREFIX + reviewId]);
      return result[KEY_PREFIX + reviewId] as CacheEntry | undefined;
    },

    async set(entry) {
      const indexResult = await storage.get([INDEX_KEY]);
      const index = (indexResult[INDEX_KEY] as string[] | undefined) ?? [];
      const nextIndex = index.includes(entry.review_id) ? index : [...index, entry.review_id];

      await storage.set({
        [KEY_PREFIX + entry.review_id]: entry,
        [INDEX_KEY]: nextIndex,
      });
    },

    async getAll() {
      const indexResult = await storage.get([INDEX_KEY]);
      const index = (indexResult[INDEX_KEY] as string[] | undefined) ?? [];
      if (index.length === 0) return [];

      const keys = index.map((id) => KEY_PREFIX + id);
      const result = await storage.get(keys);
      return keys.map((k) => result[k] as CacheEntry).filter(Boolean);
    },
  };
}
