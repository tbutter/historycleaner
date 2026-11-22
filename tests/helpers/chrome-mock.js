/**
 * Realistic in-memory Chrome Extension API mock for Node.js tests.
 */

function createEventHub() {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    async emit(...args) {
      for (const fn of [...listeners]) {
        await fn(...args);
      }
    },
    listeners,
  };
}

export function createMockChrome({ initialHistory = [], now = () => 1_795_360_000_000 } = {}) {
  const store = new Map();
  const alarms = new Map();
  let historyItems = initialHistory.map((item, idx) => ({
    id: item.id || String(idx + 1),
    url: item.url,
    title: item.title || '',
    lastVisitTime: item.lastVisitTime ?? now() - idx * 1000,
    visitCount: item.visitCount ?? 1,
  }));

  const deletedUrls = [];
  const searchCalls = [];

  const onStorageChanged = createEventHub();
  const onInstalled = createEventHub();
  const onStartup = createEventHub();
  const onAlarm = createEventHub();
  const onMessage = createEventHub();

  const storageLocal = {
    async get(keys) {
      if (keys == null) {
        return Object.fromEntries(store.entries());
      }
      if (typeof keys === 'string') {
        return store.has(keys) ? { [keys]: structuredClone(store.get(keys)) } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) {
          if (store.has(k)) {
            out[k] = structuredClone(store.get(k));
          }
        }
        return out;
      }
      const out = {};
      for (const [k, fallback] of Object.entries(keys)) {
        out[k] = store.has(k) ? structuredClone(store.get(k)) : structuredClone(fallback);
      }
      return out;
    },

    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        const oldVal = store.has(k) ? structuredClone(store.get(k)) : undefined;
        const newVal = structuredClone(v);
        store.set(k, newVal);
        changes[k] = { oldValue: oldVal, newValue: structuredClone(newVal) };
      }
      await onStorageChanged.emit(changes, 'local');
    },

    async clear() {
      store.clear();
    },

    _rawMap: store,
  };

  const history = {
    async search({ text = '', startTime = now() - 86_400_000, endTime = now(), maxResults = 100 } = {}) {
      searchCalls.push({ text, startTime, endTime, maxResults });
      const needle = text.toLowerCase();
      const filtered = historyItems
        .filter((item) => {
          if (item.lastVisitTime < startTime || item.lastVisitTime > endTime) {
            return false;
          }
          if (!needle) return true;
          return (
            item.url.toLowerCase().includes(needle) ||
            (item.title || '').toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => b.lastVisitTime - a.lastVisitTime);

      return filtered.slice(0, maxResults).map((x) => structuredClone(x));
    },

    async deleteUrl({ url }) {
      deletedUrls.push(url);
      historyItems = historyItems.filter((item) => item.url !== url);
    },

    _getRemaining() {
      return structuredClone(historyItems);
    },
    _deletedUrls: deletedUrls,
    _searchCalls: searchCalls,
  };

  const alarmsApi = {
    async create(name, alarmInfo) {
      const delayMs = (alarmInfo.delayInMinutes ?? alarmInfo.periodInMinutes ?? 1) * 60_000;
      alarms.set(name, {
        name,
        scheduledTime: now() + delayMs,
        periodInMinutes: alarmInfo.periodInMinutes,
      });
    },
    async get(name) {
      return alarms.has(name) ? structuredClone(alarms.get(name)) : undefined;
    },
    async clear(name) {
      return alarms.delete(name);
    },
    onAlarm,
    _alarmsMap: alarms,
  };

  const runtime = {
    onInstalled,
    onStartup,
    onMessage,
    sendMessage(message) {
      return new Promise((resolve) => {
        for (const fn of onMessage.listeners) {
          fn(message, {}, (res) => resolve(res));
        }
      });
    },
  };

  return {
    storage: {
      local: storageLocal,
      onChanged: onStorageChanged,
    },
    history,
    alarms: alarmsApi,
    runtime,
  };
}
