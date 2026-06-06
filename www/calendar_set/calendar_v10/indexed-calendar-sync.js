(() => {
  const DB_NAME = 'rhythmjoy-calendar-v10-sync';
  const DB_VERSION = 2;
  const EVENT_STORE = 'events';
  const STATE_STORE = 'syncState';
  const DEFAULT_TIME_ZONE = 'Asia/Seoul';
  const FULL_SYNC_PAST_DAYS = 120;
  const SYNC_COOLDOWN_MS = 12000;
  const REQUEST_TIMEOUT_MS = 12000;
  const REQUEST_RETRY_DELAY_MS = 700;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        let events;
        if (!db.objectStoreNames.contains(EVENT_STORE)) {
          events = db.createObjectStore(EVENT_STORE, { keyPath: 'cacheKey' });
        } else {
          events = req.transaction.objectStore(EVENT_STORE);
        }
        if (!events.indexNames.contains('startMs')) {
          events.createIndex('startMs', 'startMs', { unique: false });
        }
        if (!events.indexNames.contains('endMs')) {
          events.createIndex('endMs', 'endMs', { unique: false });
        }
        if (!events.indexNames.contains('roomKey')) {
          events.createIndex('roomKey', 'roomKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: 'roomKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function toGoogleDate(date) {
    return new Date(date).toISOString();
  }

  function eventStartValue(item) {
    return item.start?.dateTime || item.start?.date || null;
  }

  function eventEndValue(item) {
    return item.end?.dateTime || item.end?.date || eventStartValue(item);
  }

  function toEventRecord(roomKey, roomConfig, item) {
    const start = eventStartValue(item);
    const end = eventEndValue(item);
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!item.id || !start || Number.isNaN(startMs)) return null;

    const safeEndMs = Number.isNaN(endMs) ? startMs : endMs;
    return {
      cacheKey: `${roomKey}::${item.id}`,
      googleEventId: item.id,
      roomKey,
      startMs,
      endMs: safeEndMs,
      updated: item.updated || null,
      status: item.status || 'confirmed',
      event: {
        id: `${roomKey}:${item.id}`,
        title: item.summary || '',
        start,
        end,
        className: roomKey,
        color: roomConfig.color,
        textColor: '#000',
        description: item.description || '',
        location: item.location || '',
        extendedProps: {
          description: item.description || '',
          location: item.location || '',
          roomKey,
          roomName: roomConfig.name,
          googleEventId: item.id,
          updated: item.updated || null
        }
      }
    };
  }

  function buildUrl(calendarId, apiKey, params) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('key', apiKey);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  async function fetchWithTimeout(url) {
    if (typeof AbortController === 'undefined') {
      return fetch(url, { cache: 'no-store' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  function isRetryableCalendarError(error) {
    if (!error.status) return true;
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  function summarizeCalendarError(error) {
    if (!error) return 'unknown error';
    if (error.status) return `HTTP ${error.status}`;
    return error.name || error.message || 'network error';
  }

  async function fetchCalendarPage(calendarId, apiKey, params) {
    const url = buildUrl(calendarId, apiKey, params);
    let attempt = 0;

    while (true) {
      try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
          const error = new Error(`Google Calendar request failed: ${response.status}`);
          error.status = response.status;
          try {
            error.body = await response.json();
          } catch (_) {
            error.body = null;
          }
          throw error;
        }
        return response.json();
      } catch (error) {
        if (attempt >= 1 || !isRetryableCalendarError(error)) {
          throw error;
        }
        attempt++;
        await delay(REQUEST_RETRY_DELAY_MS);
      }
    }
  }

  async function fetchAllPages(calendarId, apiKey, baseParams) {
    const items = [];
    let pageToken = null;
    let nextSyncToken = null;

    do {
      const data = await fetchCalendarPage(calendarId, apiKey, {
        ...baseParams,
        pageToken
      });
      if (Array.isArray(data.items)) {
        items.push(...data.items);
      }
      pageToken = data.nextPageToken || null;
      nextSyncToken = data.nextSyncToken || nextSyncToken;
    } while (pageToken);

    return { items, nextSyncToken };
  }

  function create(options) {
    const apiKey = options.apiKey;
    const roomConfigs = options.roomConfigs;
    const roomKeys = options.roomKeys || Object.keys(roomConfigs);
    const onSyncComplete = typeof options.onSyncComplete === 'function'
      ? options.onSyncComplete
      : () => {};
    let dbPromise = null;
    let syncPromise = null;
    let queuedForceSync = false;
    let lastBackgroundNotifyAt = 0;
    let lastSyncAt = 0;
    let lastLoadSyncAttemptAt = 0;

    function db() {
      if (!dbPromise) dbPromise = openDb();
      return dbPromise;
    }

    async function getState(roomKey) {
      const database = await db();
      const tx = database.transaction(STATE_STORE, 'readonly');
      return requestToPromise(tx.objectStore(STATE_STORE).get(roomKey));
    }

    async function hasUsableCache() {
      const states = await Promise.all(roomKeys.map(roomKey => getState(roomKey)));
      return states.every(state => state?.fullSyncComplete);
    }

    async function putState(roomKey, patch) {
      const database = await db();
      const tx = database.transaction(STATE_STORE, 'readwrite');
      const store = tx.objectStore(STATE_STORE);
      const prev = await requestToPromise(store.get(roomKey));
      store.put({
        roomKey,
        ...(prev || {}),
        ...patch,
        updatedAt: Date.now()
      });
      await txDone(tx);
    }

    async function replaceRoomEvents(roomKey, records, nextSyncToken) {
      const database = await db();
      const tx = database.transaction([EVENT_STORE, STATE_STORE], 'readwrite');
      const events = tx.objectStore(EVENT_STORE);
      const roomIndex = events.index('roomKey');
      const cursorReq = roomIndex.openCursor(IDBKeyRange.only(roomKey));

      await new Promise((resolve, reject) => {
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });

      records.forEach(record => {
        if (record) events.put(record);
      });

      tx.objectStore(STATE_STORE).put({
        roomKey,
        syncToken: nextSyncToken || null,
        fullSyncComplete: !!nextSyncToken,
        lastFullSyncAt: Date.now(),
        updatedAt: Date.now()
      });
      await txDone(tx);
    }

    async function applyIncremental(roomKey, recordsToPut, keysToDelete, nextSyncToken) {
      const database = await db();
      const tx = database.transaction([EVENT_STORE, STATE_STORE], 'readwrite');
      const events = tx.objectStore(EVENT_STORE);
      keysToDelete.forEach(key => events.delete(key));
      recordsToPut.forEach(record => {
        if (record) events.put(record);
      });
      const stateStore = tx.objectStore(STATE_STORE);
      const prev = await requestToPromise(stateStore.get(roomKey));
      stateStore.put({
        roomKey,
        ...(prev || {}),
        syncToken: nextSyncToken || prev?.syncToken || null,
        fullSyncComplete: !!(nextSyncToken || prev?.syncToken),
        lastIncrementalSyncAt: Date.now(),
        updatedAt: Date.now()
      });
      await txDone(tx);
    }

    async function fullSyncRoom(roomKey) {
      const cfg = roomConfigs[roomKey];
      const timeMin = toGoogleDate(addDays(new Date(), -FULL_SYNC_PAST_DAYS));
      const { items, nextSyncToken } = await fetchAllPages(cfg.calendarId, apiKey, {
        maxResults: 2500,
        singleEvents: true,
        showDeleted: true,
        timeMin,
        timeZone: DEFAULT_TIME_ZONE
      });

      const records = items
        .filter(item => item.status !== 'cancelled')
        .map(item => toEventRecord(roomKey, cfg, item))
        .filter(Boolean);

      await replaceRoomEvents(roomKey, records, nextSyncToken);
      console.log(`✅ [v10 sync] ${cfg.name} 풀싱크 완료: ${records.length}건`);
      return { changed: records.length, fullSyncs: 1, failed: 0 };
    }

    async function incrementalSyncRoom(roomKey, syncToken) {
      const cfg = roomConfigs[roomKey];
      const { items, nextSyncToken } = await fetchAllPages(cfg.calendarId, apiKey, {
        maxResults: 2500,
        singleEvents: true,
        showDeleted: true,
        syncToken,
        timeZone: DEFAULT_TIME_ZONE
      });

      const recordsToPut = [];
      const keysToDelete = [];
      items.forEach(item => {
        const key = `${roomKey}::${item.id}`;
        if (item.status === 'cancelled') {
          keysToDelete.push(key);
          return;
        }
        const record = toEventRecord(roomKey, cfg, item);
        if (record) recordsToPut.push(record);
      });

      await applyIncremental(roomKey, recordsToPut, keysToDelete, nextSyncToken);
      const changed = recordsToPut.length + keysToDelete.length;
      if (changed > 0) {
        console.log(`✅ [v10 sync] ${cfg.name} 변경분 반영: +${recordsToPut.length} / -${keysToDelete.length}`);
      }
      return { changed, fullSyncs: 0, failed: 0 };
    }

    async function syncRoom(roomKey) {
      const state = await getState(roomKey);
      if (!state?.syncToken) {
        return fullSyncRoom(roomKey);
      }

      try {
        return incrementalSyncRoom(roomKey, state.syncToken);
      } catch (error) {
        if (error.status === 410) {
          console.warn(`⚠️ [v10 sync] ${roomConfigs[roomKey].name} syncToken 만료, 풀싱크 재시도`);
          await putState(roomKey, { syncToken: null, fullSyncComplete: false });
          return fullSyncRoom(roomKey);
        }
        throw error;
      }
    }

    function mergeStats(target, patch) {
      target.changed += patch?.changed || 0;
      target.fullSyncs += patch?.fullSyncs || 0;
      target.failed += patch?.failed || 0;
      return target;
    }

    async function runSyncPass() {
      const stats = { changed: 0, fullSyncs: 0, failed: 0 };
      for (const roomKey of roomKeys) {
        try {
          mergeStats(stats, await syncRoom(roomKey));
        } catch (error) {
          stats.failed++;
          console.warn(`⚠️ [v10 sync] ${roomConfigs[roomKey]?.name || roomKey} 동기화 실패: ${summarizeCalendarError(error)}`);
        }
        await delay(120);
      }
      lastSyncAt = Date.now();
      return stats;
    }

    async function syncAllRooms(options = {}) {
      const now = Date.now();
      if (syncPromise) {
        if (options.force) queuedForceSync = true;
        return syncPromise;
      }
      if (!options.force && now - lastSyncAt < SYNC_COOLDOWN_MS) {
        return syncPromise || Promise.resolve({ changed: 0, fullSyncs: 0, failed: 0 });
      }

      syncPromise = (async () => {
        const total = { changed: 0, fullSyncs: 0, failed: 0 };
        do {
          queuedForceSync = false;
          mergeStats(total, await runSyncPass());
        } while (queuedForceSync);
        return total;
      })().finally(() => {
        syncPromise = null;
      });

      return syncPromise;
    }

    function refresh(options = {}) {
      const reason = options.reason || '증분 동기화';
      return syncAllRooms({ force: !!options.force })
        .then((stats) => {
          if (!stats || stats.changed <= 0) return stats;
          const now = Date.now();
          if (now - lastBackgroundNotifyAt < 2500) return stats;
          lastBackgroundNotifyAt = now;
          onSyncComplete({ reason });
          return stats;
        })
        .catch(error => {
          console.warn('⚠️ [v10 sync] 백그라운드 변경분 갱신 실패', error);
          throw error;
        });
    }

    async function readEventsInRange(start, end) {
      const database = await db();
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      const upper = Number.isNaN(endMs) ? Date.now() : endMs;
      const lower = Number.isNaN(startMs) ? 0 : startMs;
      const tx = database.transaction(EVENT_STORE, 'readonly');
      const index = tx.objectStore(EVENT_STORE).index('startMs');
      const records = await requestToPromise(index.getAll(IDBKeyRange.upperBound(upper)));
      return records
        .filter(record => record.endMs >= lower)
        .map(record => record.event);
    }

    async function loadEvents(fetchInfo) {
      if (await hasUsableCache()) {
        return readEventsInRange(fetchInfo.start, fetchInfo.end);
      }

      const now = Date.now();
      if (now - lastLoadSyncAttemptAt >= SYNC_COOLDOWN_MS) {
        lastLoadSyncAttemptAt = now;
        await syncAllRooms({ force: true });
      }
      return readEventsInRange(fetchInfo.start, fetchInfo.end);
    }

    return {
      hasUsableCache,
      loadEvents,
      refresh,
      syncAllRooms,
      readEventsInRange
    };
  }

  window.RhythmjoyIndexedCalendarSync = { create };
})();
