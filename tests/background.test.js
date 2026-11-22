import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MESSAGE_TYPES,
  setupBackgroundServiceWorker,
} from '../src/background.js';
import { PERIODIC_ALARM_NAME } from '../src/lib/scheduler.js';
import { saveRules, saveSchedule } from '../src/lib/storage.js';
import { createMockChrome } from './helpers/chrome-mock.js';

test('background initializes defaults and schedules periodic alarm on install', async () => {
  const mockChrome = createMockChrome();
  setupBackgroundServiceWorker(mockChrome, { now: () => 100_000 });

  await mockChrome.runtime.onInstalled.emit({ reason: 'install' });

  const alarm = await mockChrome.alarms.get(PERIODIC_ALARM_NAME);
  assert.ok(alarm);
  assert.equal(alarm.periodInMinutes, 60);

  const statusResp = await mockChrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_STATUS,
  });
  assert.equal(statusResp.ok, true);
  assert.equal(statusResp.result.scheduler.schedule.enabled, true);
  assert.equal(statusResp.result.scheduler.schedule.intervalMinutes, 60);
});

test('periodic alarm and manual CLEAN_NOW messages trigger history cleanup', async () => {
  const mockChrome = createMockChrome({
    initialHistory: [
      { url: 'https://track.example.net/?utm_source=ads', lastVisitTime: 9000 },
      { url: 'https://wikipedia.org/wiki/Regex', lastVisitTime: 8000 },
      { url: 'https://localhost:8080/debug', lastVisitTime: 7000 },
    ],
  });

  const bg = setupBackgroundServiceWorker(mockChrome, { now: () => 20_000 });
  await bg.handleInstalled();

  await saveRules(
    [{ pattern: 'utm_source=', flags: 'i' }],
    mockChrome.storage.local
  );

  // Unrelated alarm is ignored
  await bg.handleAlarm({ name: 'some-other-alarm' });
  assert.equal(mockChrome.history._deletedUrls.length, 0);

  // Periodic alarm cleans matching URL
  const alarmRes = await bg.handleAlarm({ name: PERIODIC_ALARM_NAME });
  assert.equal(alarmRes.deletedCount, 1);
  assert.deepEqual(mockChrome.history._deletedUrls, [
    'https://track.example.net/?utm_source=ads',
  ]);

  // Add second rule and trigger manual CLEAN_NOW message
  await saveRules(
    [
      { pattern: 'utm_source=', flags: 'i' },
      { pattern: '^https://localhost:8080/', flags: 'i' },
    ],
    mockChrome.storage.local
  );

  const manualResp = await mockChrome.runtime.sendMessage({
    type: MESSAGE_TYPES.CLEAN_NOW,
    trigger: 'manual',
  });
  assert.equal(manualResp.ok, true);
  assert.equal(manualResp.result.deletedCount, 1);
  assert.equal(mockChrome.history._getRemaining().length, 1);
});

test('updating schedule in chrome.storage.local updates or clears chrome.alarms automatically', async () => {
  const mockChrome = createMockChrome();
  const bg = setupBackgroundServiceWorker(mockChrome, { now: () => 50_000 });
  await bg.handleInstalled();

  await saveSchedule({ enabled: true, intervalMinutes: 15 }, mockChrome.storage.local);
  const updatedAlarm = await mockChrome.alarms.get(PERIODIC_ALARM_NAME);
  assert.equal(updatedAlarm.periodInMinutes, 15);

  await saveSchedule({ enabled: false }, mockChrome.storage.local);
  const clearedAlarm = await mockChrome.alarms.get(PERIODIC_ALARM_NAME);
  assert.equal(clearedAlarm, undefined);
});

test('onStartup respects runOnStartup setting', async () => {
  const mockChrome = createMockChrome({
    initialHistory: [{ url: 'https://ephemeral.test/session', lastVisitTime: 5000 }],
  });
  const bg = setupBackgroundServiceWorker(mockChrome, { now: () => 10_000 });
  await bg.handleInstalled();
  await saveRules([{ pattern: 'ephemeral\\.test', flags: 'i' }], mockChrome.storage.local);

  // Default runOnStartup is false -> startup does not delete
  await bg.handleStartup();
  assert.equal(mockChrome.history._deletedUrls.length, 0);

  // Enable runOnStartup -> startup cleans matching URL
  await saveSchedule({ runOnStartup: true }, mockChrome.storage.local);
  await bg.handleStartup();
  assert.equal(mockChrome.history._deletedUrls.length, 1);
});
