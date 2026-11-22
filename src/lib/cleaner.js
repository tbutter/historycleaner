/**
 * Full-history paginated scanner and bounded-concurrency URL deleter.
 */

import { compileRules, matchUrl } from './matcher.js';
import { getRules, recordRunStats } from './storage.js';

export const DEFAULT_BATCH_SIZE = 5000;
export const DEFAULT_DELETE_CONCURRENCY = 25;
export const DEFAULT_MAX_PREVIEW_ITEMS = 200;

function resolveHistoryApi(historyApi) {
  const api = historyApi || globalThis.chrome?.history;
  if (!api) {
    throw new Error('chrome.history API is unavailable.');
  }
  return api;
}

/**
 * Fetches all unique URLs from `chrome.history.search` starting from `startTime` (default 0),
 * paginating backwards by `endTime` with strict monotonic progress guarantees.
 *
 * @param {object} historyApi
 * @param {{ batchSize?: number, startTime?: number, now?: () => number }} [options]
 * @returns {Promise<Array<{ url: string, lastVisitTime: number }>>}
 */
export async function fetchAllHistoryItems(
  historyApi,
  { batchSize = DEFAULT_BATCH_SIZE, startTime = 0, now = Date.now } = {}
) {
  const api = resolveHistoryApi(historyApi);
  const seenUrls = new Set();
  const items = [];
  let currentEndTime = now() + 1000;

  while (currentEndTime > startTime) {
    const batch = await api.search({
      text: '',
      startTime,
      endTime: currentEndTime,
      maxResults: batchSize,
    });

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    let minVisitTime = Infinity;
    for (const entry of batch) {
      if (!entry) continue;
      if (typeof entry.lastVisitTime === 'number' && Number.isFinite(entry.lastVisitTime)) {
        if (entry.lastVisitTime < minVisitTime) {
          minVisitTime = entry.lastVisitTime;
        }
      }
      if (
        typeof entry.url === 'string' &&
        entry.url.length > 0 &&
        !entry.url.startsWith('chrome-extension://') &&
        !seenUrls.has(entry.url)
      ) {
        seenUrls.add(entry.url);
        items.push({
          url: entry.url,
          lastVisitTime: typeof entry.lastVisitTime === 'number' ? entry.lastVisitTime : 0,
        });
      }
    }

    if (batch.length < batchSize || !Number.isFinite(minVisitTime)) {
      break;
    }

    const nextEndTime = minVisitTime >= currentEndTime ? currentEndTime - 1 : minVisitTime;
    if (nextEndTime <= startTime) {
      break;
    }
    currentEndTime = nextEndTime;
  }

  return items;
}

/**
 * Deletes an array of URLs from Chrome history with bounded concurrency.
 * @param {object} historyApi
 * @param {string[]} urls
 * @param {number} [concurrency=DEFAULT_DELETE_CONCURRENCY]
 */
export async function deleteUrlsBounded(
  historyApi,
  urls,
  concurrency = DEFAULT_DELETE_CONCURRENCY
) {
  const api = resolveHistoryApi(historyApi);
  if (!Array.isArray(urls) || urls.length === 0) {
    return 0;
  }

  const limit = Math.max(1, Math.min(concurrency, urls.length));
  let cursor = 0;
  let deleted = 0;

  async function worker() {
    while (cursor < urls.length) {
      const idx = cursor;
      cursor += 1;
      const url = urls[idx];
      await api.deleteUrl({ url });
      deleted += 1;
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  return deleted;
}

/**
 * Creates a history cleaner instance with single-flight execution locking.
 * @param {{
 *   historyApi?: object,
 *   storageArea?: object,
 *   now?: () => number,
 *   batchSize?: number,
 *   deleteConcurrency?: number
 * }} [deps]
 */
export function createHistoryCleaner({
  historyApi,
  storageArea,
  now = Date.now,
  batchSize = DEFAULT_BATCH_SIZE,
  deleteConcurrency = DEFAULT_DELETE_CONCURRENCY,
} = {}) {
  let activeCleanPromise = null;

  /**
   * Dry-run scan returning count and a capped sample of matching URLs + matched rule metadata.
   * Never mutates history or persists URLs to storage.
   */
  async function previewMatches({
    maxPreviewItems = DEFAULT_MAX_PREVIEW_ITEMS,
    rulesOverride = null,
  } = {}) {
    const startedAt = now();
    const rules = Array.isArray(rulesOverride) ? rulesOverride : await getRules(storageArea);
    const { compiled } = compileRules(rules);

    if (compiled.length === 0) {
      return {
        scannedCount: 0,
        matchedCount: 0,
        previewItems: [],
        truncated: false,
        activeRuleCount: 0,
        durationMs: Math.max(0, now() - startedAt),
      };
    }

    const items = await fetchAllHistoryItems(historyApi, { batchSize, now });
    const previewItems = [];
    let matchedCount = 0;

    for (const item of items) {
      const match = matchUrl(item.url, compiled);
      if (match.matched) {
        matchedCount += 1;
        if (previewItems.length < maxPreviewItems) {
          previewItems.push({
            url: item.url,
            lastVisitTime: item.lastVisitTime,
            matchedRule: match.rule,
          });
        }
      }
    }

    return {
      scannedCount: items.length,
      matchedCount,
      previewItems,
      truncated: matchedCount > previewItems.length,
      activeRuleCount: compiled.length,
      durationMs: Math.max(0, now() - startedAt),
    };
  }

  /**
   * Scans full Chrome history against active regex rules and deletes every matching URL.
   * Concurrent calls coalesce onto the active run to avoid duplicate deletions or races.
   */
  async function cleanNow({ trigger = 'manual' } = {}) {
    if (activeCleanPromise) {
      const sharedResult = await activeCleanPromise;
      return { ...sharedResult, coalesced: true };
    }

    activeCleanPromise = (async () => {
      const startedAt = now();
      const rules = await getRules(storageArea);
      const { compiled } = compileRules(rules);

      if (compiled.length === 0) {
        const timestamp = now();
        const durationMs = Math.max(0, timestamp - startedAt);
        const summary = {
          timestamp,
          trigger,
          scannedCount: 0,
          deletedCount: 0,
          activeRuleCount: 0,
          durationMs,
        };
        await recordRunStats(summary, storageArea);
        return summary;
      }

      const items = await fetchAllHistoryItems(historyApi, { batchSize, now });
      const urlsToDelete = [];

      for (const item of items) {
        const match = matchUrl(item.url, compiled);
        if (match.matched) {
          urlsToDelete.push(item.url);
        }
      }

      const deletedCount = await deleteUrlsBounded(historyApi, urlsToDelete, deleteConcurrency);
      const timestamp = now();
      const durationMs = Math.max(0, timestamp - startedAt);

      const summary = {
        timestamp,
        trigger,
        scannedCount: items.length,
        deletedCount,
        activeRuleCount: compiled.length,
        durationMs,
      };

      await recordRunStats(summary, storageArea);
      return summary;
    })();

    try {
      return await activeCleanPromise;
    } finally {
      activeCleanPromise = null;
    }
  }

  function isCleaning() {
    return activeCleanPromise !== null;
  }

  return {
    previewMatches,
    cleanNow,
    isCleaning,
  };
}
