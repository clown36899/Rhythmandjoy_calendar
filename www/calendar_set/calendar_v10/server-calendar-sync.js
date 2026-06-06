(() => {
  const DATA_URL = './data/events.json';
  const REQUEST_TIMEOUT_MS = 8000;

  function toMs(value) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }

  function overlapsRange(event, rangeStartMs, rangeEndMs) {
    const startMs = toMs(event.start);
    const endMs = toMs(event.end) ?? startMs;
    if (startMs === null) return false;
    const safeEndMs = endMs === null ? startMs : endMs;
    return startMs <= rangeEndMs && safeEndMs >= rangeStartMs;
  }

  async function fetchWithTimeout(url) {
    if (typeof AbortController === 'undefined') {
      return fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function create(options = {}) {
    const onSyncComplete = typeof options.onSyncComplete === 'function'
      ? options.onSyncComplete
      : () => {};

    let cachedData = null;
    let refreshPromise = null;

    async function fetchCache() {
      const response = await fetchWithTimeout(DATA_URL);
      if (!response.ok) {
        const error = new Error(`Server calendar cache request failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      data.events = Array.isArray(data.events) ? data.events : [];
      return data;
    }

    function cacheStamp(data) {
      return data?.contentHash || data?.generatedAtMs || data?.generatedAt || data?.version || null;
    }

    async function refresh(options = {}) {
      const reason = options.reason || '서버 캐시 갱신';
      if (refreshPromise) return refreshPromise;

      refreshPromise = (async () => {
        const prevStamp = cacheStamp(cachedData);
        const nextData = await fetchCache();
        const nextStamp = cacheStamp(nextData);
        cachedData = nextData;

        const changed = prevStamp !== nextStamp ? 1 : 0;
        if (changed > 0 && prevStamp !== null) {
          onSyncComplete({ reason });
        }
        return { changed, failed: 0, source: 'server-cache' };
      })().finally(() => {
        refreshPromise = null;
      });

      return refreshPromise;
    }

    async function ensureCache() {
      if (cachedData) return cachedData;
      await refresh({ reason: '서버 캐시 초기 로드', force: true });
      return cachedData;
    }

    async function loadEvents(fetchInfo) {
      const data = await ensureCache();
      const rangeStartMs = toMs(fetchInfo.start) ?? 0;
      const rangeEndMs = toMs(fetchInfo.end) ?? Date.now();

      return data.events.filter(event => overlapsRange(event, rangeStartMs, rangeEndMs));
    }

    async function hasUsableCache() {
      await ensureCache();
      return !!cachedData;
    }

    return {
      hasUsableCache,
      loadEvents,
      refresh,
      syncAllRooms: refresh,
      readEventsInRange: async (start, end) => {
        const data = await ensureCache();
        const rangeStartMs = toMs(start) ?? 0;
        const rangeEndMs = toMs(end) ?? Date.now();
        return data.events.filter(event => overlapsRange(event, rangeStartMs, rangeEndMs));
      }
    };
  }

  window.RhythmjoyServerCalendarSync = { create };
})();
