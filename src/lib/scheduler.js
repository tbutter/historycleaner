/**
 * Periodic alarm reconciliation using `chrome.alarms`.
 */

import { getSchedule, normalizeSchedule } from './storage.js';

export const PERIODIC_ALARM_NAME = 'history-cleaner-periodic';

function resolveAlarmsApi(alarmsApi) {
  const api = alarmsApi || globalThis.chrome?.alarms;
  if (!api) {
    throw new Error('chrome.alarms API is unavailable.');
  }
  return api;
}

/**
 * Synchronizes the `chrome.alarms` periodic schedule with stored schedule settings.
 * Preserves an existing alarm if its period already matches to avoid resetting countdowns on startup.
 *
 * @param {{ alarmsApi?: object, storageArea?: object, scheduleOverride?: object | null }} [options]
 */
export async function reconcileAlarm({
  alarmsApi,
  storageArea,
  scheduleOverride = null,
} = {}) {
  const api = resolveAlarmsApi(alarmsApi);
  const schedule = scheduleOverride
    ? normalizeSchedule(scheduleOverride)
    : await getSchedule(storageArea);

  if (!schedule.enabled) {
    await api.clear(PERIODIC_ALARM_NAME);
    return {
      enabled: false,
      schedule,
      alarm: null,
      unchanged: false,
    };
  }

  const existing = await api.get(PERIODIC_ALARM_NAME);
  if (existing && existing.periodInMinutes === schedule.intervalMinutes) {
    return {
      enabled: true,
      schedule,
      alarm: existing,
      unchanged: true,
    };
  }

  await api.create(PERIODIC_ALARM_NAME, {
    delayInMinutes: schedule.intervalMinutes,
    periodInMinutes: schedule.intervalMinutes,
  });

  const created = await api.get(PERIODIC_ALARM_NAME);
  return {
    enabled: true,
    schedule,
    alarm: created || null,
    unchanged: false,
  };
}

/**
 * Retrieves current schedule settings paired with live next-alarm metadata.
 * @param {{ alarmsApi?: object, storageArea?: object }} [options]
 */
export async function getSchedulerStatus({ alarmsApi, storageArea } = {}) {
  const api = resolveAlarmsApi(alarmsApi);
  const [schedule, alarm] = await Promise.all([
    getSchedule(storageArea),
    api.get(PERIODIC_ALARM_NAME),
  ]);

  return {
    schedule,
    nextRunTimestamp: alarm?.scheduledTime || null,
    periodInMinutes: alarm?.periodInMinutes || null,
  };
}
