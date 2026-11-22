/**
 * Local storage layer backed exclusively by `chrome.storage.local`.
 * Never persists matched or deleted URLs—only user rules, schedule config, and aggregate counts.
 */

import { normalizeRule } from './matcher.js';

export const STORAGE_KEYS = Object.freeze({
  RULES: 'rules',
  SCHEDULE: 'schedule',
  STATS: 'stats',
});

export const DEFAULT_SCHEDULE = Object.freeze({
  enabled: true,
  intervalMinutes: 60,
  runOnStartup: false,
});

export const DEFAULT_STATS = Object.freeze({
  totalDeleted: 0,
  runCount: 0,
  lastRun: null,
});

function resolveStorage(storageArea) {
  const area = storageArea || globalThis.chrome?.storage?.local;
  if (!area) {
    throw new Error('chrome.storage.local is unavailable.');
  }
  return area;
}

/**
 * Normalizes schedule config with safe bounds (`intervalMinutes >= 1`).
 * @param {object} [raw]
 */
export function normalizeSchedule(raw = {}) {
  const parsedInterval = Number(raw?.intervalMinutes);
  const intervalMinutes =
    Number.isFinite(parsedInterval) && parsedInterval >= 1
      ? Math.min(10080, Math.round(parsedInterval))
      : DEFAULT_SCHEDULE.intervalMinutes;

  return {
    enabled: raw?.enabled !== undefined ? Boolean(raw.enabled) : DEFAULT_SCHEDULE.enabled,
    intervalMinutes,
    runOnStartup: Boolean(raw?.runOnStartup),
  };
}

/**
 * Reads regex rules from `chrome.storage.local`.
 * @param {object} [storageArea]
 * @returns {Promise<Array<object>>}
 */
export async function getRules(storageArea) {
  const area = resolveStorage(storageArea);
  const data = await area.get({ [STORAGE_KEYS.RULES]: [] });
  return Array.isArray(data[STORAGE_KEYS.RULES]) ? data[STORAGE_KEYS.RULES] : [];
}

/**
 * Saves an array of regex rules to `chrome.storage.local`.
 * @param {Array<object>} rules
 * @param {object} [storageArea]
 */
export async function saveRules(rules, storageArea) {
  const area = resolveStorage(storageArea);
  const normalized = rules.map((r) => normalizeRule(r));
  await area.set({ [STORAGE_KEYS.RULES]: normalized });
  return normalized;
}

/**
 * Appends a single new rule (rejecting exact duplicate pattern + flags).
 * @param {object} ruleInput
 * @param {object} [storageArea]
 */
export async function addRule(ruleInput, storageArea) {
  const rules = await getRules(storageArea);
  const newRule = normalizeRule(ruleInput);
  const duplicate = rules.find(
    (r) => r.pattern === newRule.pattern && (r.flags || '') === (newRule.flags || '')
  );
  if (duplicate) {
    throw new Error('A rule with this exact pattern and flags already exists.');
  }
  const next = [...rules, newRule];
  await saveRules(next, storageArea);
  return newRule;
}

/**
 * Updates an existing rule by `id`.
 * @param {string} id
 * @param {object} patch
 * @param {object} [storageArea]
 */
export async function updateRule(id, patch, storageArea) {
  const rules = await getRules(storageArea);
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) {
    throw new Error('Rule not found.');
  }
  const merged = normalizeRule({
    ...rules[idx],
    ...patch,
    id,
    createdAt: rules[idx].createdAt,
  });

  const duplicate = rules.find(
    (r, i) =>
      i !== idx && r.pattern === merged.pattern && (r.flags || '') === (merged.flags || '')
  );
  if (duplicate) {
    throw new Error('Another rule already uses this exact pattern and flags.');
  }

  const next = [...rules];
  next[idx] = merged;
  await saveRules(next, storageArea);
  return merged;
}

/**
 * Deletes a rule by `id`.
 * @param {string} id
 * @param {object} [storageArea]
 */
export async function deleteRule(id, storageArea) {
  const rules = await getRules(storageArea);
  const next = rules.filter((r) => r.id !== id);
  const area = resolveStorage(storageArea);
  await area.set({ [STORAGE_KEYS.RULES]: next });
  return next;
}

/**
 * Reads schedule configuration from `chrome.storage.local`.
 * @param {object} [storageArea]
 */
export async function getSchedule(storageArea) {
  const area = resolveStorage(storageArea);
  const data = await area.get({ [STORAGE_KEYS.SCHEDULE]: DEFAULT_SCHEDULE });
  return normalizeSchedule(data[STORAGE_KEYS.SCHEDULE]);
}

/**
 * Saves schedule configuration to `chrome.storage.local`.
 * @param {object} scheduleInput
 * @param {object} [storageArea]
 */
export async function saveSchedule(scheduleInput, storageArea) {
  const area = resolveStorage(storageArea);
  const current = await getSchedule(storageArea);
  const next = normalizeSchedule({ ...current, ...scheduleInput });
  await area.set({ [STORAGE_KEYS.SCHEDULE]: next });
  return next;
}

/**
 * Reads aggregate cleanup statistics from `chrome.storage.local`.
 * @param {object} [storageArea]
 */
export async function getStats(storageArea) {
  const area = resolveStorage(storageArea);
  const data = await area.get({ [STORAGE_KEYS.STATS]: DEFAULT_STATS });
  const raw = data[STORAGE_KEYS.STATS] || {};
  return {
    totalDeleted: Number(raw.totalDeleted) || 0,
    runCount: Number(raw.runCount) || 0,
    lastRun: raw.lastRun
      ? {
          timestamp: Number(raw.lastRun.timestamp) || 0,
          trigger: String(raw.lastRun.trigger || 'manual'),
          scannedCount: Number(raw.lastRun.scannedCount) || 0,
          deletedCount: Number(raw.lastRun.deletedCount) || 0,
          durationMs: Number(raw.lastRun.durationMs) || 0,
        }
      : null,
  };
}

/**
 * Records aggregate run statistics, strictly stripping any non-numeric/URL fields for privacy.
 * @param {{ timestamp: number, trigger: string, scannedCount: number, deletedCount: number, durationMs: number }} summary
 * @param {object} [storageArea]
 */
export async function recordRunStats(summary, storageArea) {
  const area = resolveStorage(storageArea);
  const current = await getStats(storageArea);
  const deletedCount = Math.max(0, Math.trunc(Number(summary.deletedCount) || 0));
  const scannedCount = Math.max(0, Math.trunc(Number(summary.scannedCount) || 0));
  const durationMs = Math.max(0, Math.round(Number(summary.durationMs) || 0));
  const timestamp = Number(summary.timestamp) || Date.now();
  const trigger = String(summary.trigger || 'manual');

  const next = {
    totalDeleted: current.totalDeleted + deletedCount,
    runCount: current.runCount + 1,
    lastRun: {
      timestamp,
      trigger,
      scannedCount,
      deletedCount,
      durationMs,
    },
  };

  await area.set({ [STORAGE_KEYS.STATS]: next });
  return next;
}

/**
 * Ensures storage defaults are initialized without overwriting existing data.
 * @param {object} [storageArea]
 */
export async function ensureStorageDefaults(storageArea) {
  const area = resolveStorage(storageArea);
  const existing = await area.get([
    STORAGE_KEYS.RULES,
    STORAGE_KEYS.SCHEDULE,
    STORAGE_KEYS.STATS,
  ]);

  const updates = {};
  if (!Array.isArray(existing[STORAGE_KEYS.RULES])) {
    updates[STORAGE_KEYS.RULES] = [];
  }
  if (!existing[STORAGE_KEYS.SCHEDULE] || typeof existing[STORAGE_KEYS.SCHEDULE] !== 'object') {
    updates[STORAGE_KEYS.SCHEDULE] = { ...DEFAULT_SCHEDULE };
  }
  if (!existing[STORAGE_KEYS.STATS] || typeof existing[STORAGE_KEYS.STATS] !== 'object') {
    updates[STORAGE_KEYS.STATS] = { ...DEFAULT_STATS };
  }

  if (Object.keys(updates).length > 0) {
    await area.set(updates);
  }
}
