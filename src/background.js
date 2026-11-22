/**
 * Manifest V3 Background Service Worker for History Cleaner.
 * Registers all event listeners synchronously at module evaluation time.
 */

import { createHistoryCleaner } from './lib/cleaner.js';
import {
  PERIODIC_ALARM_NAME,
  getSchedulerStatus,
  reconcileAlarm,
} from './lib/scheduler.js';
import {
  STORAGE_KEYS,
  ensureStorageDefaults,
  getRules,
  getSchedule,
  getStats,
} from './lib/storage.js';

export const MESSAGE_TYPES = Object.freeze({
  CLEAN_NOW: 'CLEAN_NOW',
  PREVIEW_MATCHES: 'PREVIEW_MATCHES',
  GET_STATUS: 'GET_STATUS',
  RECONCILE_ALARM: 'RECONCILE_ALARM',
});

/**
 * Wires background listeners against a `chrome`-compatible API object.
 * @param {object} chromeApi
 * @param {{ now?: () => number, batchSize?: number, deleteConcurrency?: number }} [options]
 */
export function setupBackgroundServiceWorker(chromeApi, options = {}) {
  const storageArea = chromeApi.storage.local;
  const historyApi = chromeApi.history;
  const alarmsApi = chromeApi.alarms;

  const cleaner = createHistoryCleaner({
    historyApi,
    storageArea,
    now: options.now,
    batchSize: options.batchSize,
    deleteConcurrency: options.deleteConcurrency,
  });

  async function handleInstalled() {
    await ensureStorageDefaults(storageArea);
    await reconcileAlarm({ alarmsApi, storageArea });
  }

  async function handleStartup() {
    await ensureStorageDefaults(storageArea);
    const schedule = await getSchedule(storageArea);
    await reconcileAlarm({ alarmsApi, storageArea, scheduleOverride: schedule });
    if (schedule.runOnStartup) {
      await cleaner.cleanNow({ trigger: 'startup' });
    }
  }

  async function handleAlarm(alarm) {
    if (alarm?.name !== PERIODIC_ALARM_NAME) {
      return null;
    }
    return cleaner.cleanNow({ trigger: 'scheduled' });
  }

  async function handleStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes || !changes[STORAGE_KEYS.SCHEDULE]) {
      return null;
    }
    return reconcileAlarm({
      alarmsApi,
      storageArea,
      scheduleOverride: changes[STORAGE_KEYS.SCHEDULE].newValue,
    });
  }

  async function dispatchMessage(message) {
    const type = message?.type;

    switch (type) {
      case MESSAGE_TYPES.CLEAN_NOW: {
        const result = await cleaner.cleanNow({
          trigger: message?.trigger || 'manual',
        });
        return { ok: true, result };
      }

      case MESSAGE_TYPES.PREVIEW_MATCHES: {
        const result = await cleaner.previewMatches({
          maxPreviewItems: message?.maxPreviewItems,
          rulesOverride: message?.rulesOverride || null,
        });
        return { ok: true, result };
      }

      case MESSAGE_TYPES.RECONCILE_ALARM: {
        const result = await reconcileAlarm({ alarmsApi, storageArea });
        return { ok: true, result };
      }

      case MESSAGE_TYPES.GET_STATUS: {
        const [rules, stats, scheduler] = await Promise.all([
          getRules(storageArea),
          getStats(storageArea),
          getSchedulerStatus({ alarmsApi, storageArea }),
        ]);
        const activeRuleCount = rules.filter((r) => r && r.enabled !== false).length;
        return {
          ok: true,
          result: {
            totalRuleCount: rules.length,
            activeRuleCount,
            stats,
            scheduler,
            isCleaning: cleaner.isCleaning(),
          },
        };
      }

      default:
        return { ok: false, error: `Unknown message type: ${String(type)}` };
    }
  }

  function handleMessage(message, _sender, sendResponse) {
    dispatchMessage(message)
      .then((res) => sendResponse(res))
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return true;
  }

  chromeApi.runtime.onInstalled.addListener((details) => {
    handleInstalled(details).catch((err) => {
      console.error('[HistoryCleaner] onInstalled error:', err);
    });
  });

  chromeApi.runtime.onStartup.addListener(() => {
    handleStartup().catch((err) => {
      console.error('[HistoryCleaner] onStartup error:', err);
    });
  });

  chromeApi.alarms.onAlarm.addListener((alarm) => {
    handleAlarm(alarm).catch((err) => {
      console.error('[HistoryCleaner] onAlarm error:', err);
    });
  });

  chromeApi.storage.onChanged.addListener((changes, areaName) => {
    handleStorageChanged(changes, areaName).catch((err) => {
      console.error('[HistoryCleaner] storage.onChanged error:', err);
    });
  });

  chromeApi.runtime.onMessage.addListener(handleMessage);

  return {
    cleaner,
    handleInstalled,
    handleStartup,
    handleAlarm,
    handleStorageChanged,
    dispatchMessage,
  };
}

if (
  globalThis.chrome &&
  globalThis.chrome.runtime?.onInstalled &&
  globalThis.chrome.alarms?.onAlarm
) {
  setupBackgroundServiceWorker(globalThis.chrome);
}
