import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistoryCleaner } from '../src/lib/cleaner.js';
import { saveRules } from '../src/lib/storage.js';
import { createMockChrome } from './helpers/chrome-mock.js';

test('cleaner matches full URL only and ignores matching page titles', async () => {
  const mockChrome = createMockChrome({
    initialHistory: [
      {
        url: 'https://safe-documentation.org/guide',
        title: 'https://secret.internal.corp/admin',
        lastVisitTime: 5000,
      },
      {
        url: 'https://secret.internal.corp/dashboard',
        title: 'Harmless Title',
        lastVisitTime: 4000,
      },
    ],
  });

  await saveRules(
    [{ pattern: '^https://secret\\.internal\\.corp/', flags: 'i' }],
    mockChrome.storage.local
  );

  const cleaner = createHistoryCleaner({
    historyApi: mockChrome.history,
    storageArea: mockChrome.storage.local,
    now: () => 10_000,
  });

  const result = await cleaner.cleanNow({ trigger: 'manual' });
  assert.equal(result.scannedCount, 2);
  assert.equal(result.deletedCount, 1);
  assert.deepEqual(mockChrome.history._deletedUrls, [
    'https://secret.internal.corp/dashboard',
  ]);
  assert.equal(mockChrome.history._getRemaining()[0].url, 'https://safe-documentation.org/guide');
});

test('cleaner paginates across multiple batches and handles identical-millisecond timestamp ties', async () => {
  // 12 history items, including 5 sharing exact timestamp 3000 when batchSize = 3!
  const initialHistory = [
    { url: 'https://keep.org/1', lastVisitTime: 9000 },
    { url: 'https://remove.me/1', lastVisitTime: 8000 },
    { url: 'https://keep.org/2', lastVisitTime: 7000 },
    { url: 'https://remove.me/tie-a', lastVisitTime: 3000 },
    { url: 'https://remove.me/tie-b', lastVisitTime: 3000 },
    { url: 'https://keep.org/tie-c', lastVisitTime: 3000 },
    { url: 'https://remove.me/tie-d', lastVisitTime: 3000 },
    { url: 'https://keep.org/tie-e', lastVisitTime: 3000 },
    { url: 'https://remove.me/old-1', lastVisitTime: 2000 },
    { url: 'https://keep.org/old-2', lastVisitTime: 1000 },
  ];

  const mockChrome = createMockChrome({ initialHistory });
  await saveRules([{ pattern: '^https://remove\\.me/', flags: 'i' }], mockChrome.storage.local);

  const cleaner = createHistoryCleaner({
    historyApi: mockChrome.history,
    storageArea: mockChrome.storage.local,
    now: () => 10_000,
    batchSize: 3,
    deleteConcurrency: 2,
  });

  const res = await cleaner.cleanNow({ trigger: 'scheduled' });
  assert.ok(mockChrome.history._searchCalls.length >= 3);
  assert.equal(res.deletedCount, 4);
  assert.ok(mockChrome.history._deletedUrls.includes('https://remove.me/1'));
  assert.ok(mockChrome.history._deletedUrls.includes('https://remove.me/old-1'));

  // Privacy invariant: persisted stats must NEVER contain any deleted or visited URL text
  const rawStored = JSON.stringify(await mockChrome.storage.local.get('stats'));
  assert.equal(rawStored.includes('remove.me'), false);
  assert.equal(rawStored.includes('keep.org'), false);
});

test('previewMatches performs a dry run without deleting history or mutating stats', async () => {
  const mockChrome = createMockChrome({
    initialHistory: [
      { url: 'https://localhost:3000/app', lastVisitTime: 5000 },
      { url: 'https://news.ycombinator.com/', lastVisitTime: 4000 },
    ],
  });

  await saveRules(
    [{ pattern: '^https?://localhost(:[0-9]+)?/', flags: 'i', note: 'Dev' }],
    mockChrome.storage.local
  );

  const cleaner = createHistoryCleaner({
    historyApi: mockChrome.history,
    storageArea: mockChrome.storage.local,
    now: () => 10_000,
  });

  const preview = await cleaner.previewMatches({ maxPreviewItems: 10 });
  assert.equal(preview.scannedCount, 2);
  assert.equal(preview.matchedCount, 1);
  assert.equal(preview.previewItems[0].url, 'https://localhost:3000/app');
  assert.equal(mockChrome.history._deletedUrls.length, 0);
});

test('concurrent cleanNow calls coalesce onto a single flight without double-deleting', async () => {
  const mockChrome = createMockChrome({
    initialHistory: [{ url: 'https://temp.example.com/1', lastVisitTime: 5000 }],
  });

  await saveRules([{ pattern: 'temp\\.example\\.com', flags: 'i' }], mockChrome.storage.local);

  const cleaner = createHistoryCleaner({
    historyApi: mockChrome.history,
    storageArea: mockChrome.storage.local,
    now: () => 10_000,
  });

  const [first, second] = await Promise.all([
    cleaner.cleanNow({ trigger: 'manual' }),
    cleaner.cleanNow({ trigger: 'scheduled' }),
  ]);

  assert.equal(first.deletedCount, 1);
  assert.equal(second.deletedCount, 1);
  assert.equal(second.coalesced, true);
  assert.equal(mockChrome.history._deletedUrls.length, 1);
});
