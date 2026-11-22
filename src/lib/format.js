/**
 * Shared formatting helpers for timestamps, intervals, and countdowns.
 */

/**
 * Formats a past timestamp into a concise human-readable relative string.
 * @param {number | null | undefined} timestamp
 * @param {number} [nowMs=Date.now()]
 * @returns {string}
 */
export function formatRelativePast(timestamp, nowMs = Date.now()) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return 'Never';
  }
  const diffSec = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

/**
 * Formats a future alarm timestamp into a concise countdown string.
 * @param {number | null | undefined} targetTimestamp
 * @param {number} [nowMs=Date.now()]
 * @returns {string}
 */
export function formatCountdown(targetTimestamp, nowMs = Date.now()) {
  if (!targetTimestamp || !Number.isFinite(targetTimestamp)) {
    return 'Not scheduled';
  }
  const diffMs = targetTimestamp - nowMs;
  if (diffMs <= 0) return 'Imminent';
  const totalSec = Math.ceil(diffMs / 1000);
  if (totalSec < 60) return `in ${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `in ${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin > 0 ? `in ${hours}h ${remMin}m` : `in ${hours}h`;
}

/**
 * Formats an interval in minutes into readable label.
 * @param {number} minutes
 * @returns {string}
 */
export function formatIntervalLabel(minutes) {
  const m = Number(minutes) || 0;
  if (m <= 0) return 'Disabled';
  if (m === 60) return 'Every hour';
  if (m === 1440) return 'Daily';
  if (m % 60 === 0) return `Every ${m / 60} hours`;
  return `Every ${m} min`;
}

/**
 * Formats a regex rule into `/pattern/flags` display notation.
 * @param {{ pattern: string, flags?: string }} rule
 * @returns {string}
 */
export function formatRegexLiteral(rule) {
  const escapedSlashes = String(rule.pattern || '').replace(/(?<!\\)\//g, '\\/');
  return `/${escapedSlashes}/${rule.flags || ''}`;
}
