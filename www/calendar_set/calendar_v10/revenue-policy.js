(() => {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

  const ROOM_PRICING = {
    a: {
      name: "A홀",
      size: "20평",
      color: "#f6bf26",
      before16: 13000,
      after16: 20000,
      dawnHourly: 7000,
      overnight: 30000
    },
    b: {
      name: "B홀",
      size: "16평",
      color: "#5796c8",
      before16: 8000,
      after16: 12000,
      dawnHourly: 5000,
      overnight: 20000
    },
    c: {
      name: "C홀",
      size: "5평",
      color: "#81b4ba",
      before16: 4000,
      after16: 6000,
      dawnHourly: 4000,
      overnight: 15000
    },
    d: {
      name: "D홀",
      size: "4평",
      color: "#7d9d6a",
      before16: 3000,
      after16: 5000,
      dawnHourly: 3000,
      overnight: 15000
    },
    e: {
      name: "E홀",
      size: "15평",
      color: "#4c4c4c",
      before16: 8000,
      after16: 12000,
      dawnHourly: 5000,
      overnight: 20000
    }
  };

  const ROOM_KEYS = Object.keys(ROOM_PRICING);

  // 사이트 안내의 "주말/공휴일" 요금 판정용. 필요 시 운영 기준에 맞춰 이 목록만 갱신하면 됩니다.
  const HOLIDAYS_BY_YEAR = {
    2024: [
      "2024-01-01",
      "2024-02-09", "2024-02-10", "2024-02-11", "2024-02-12",
      "2024-03-01",
      "2024-04-10",
      "2024-05-05", "2024-05-06", "2024-05-15",
      "2024-06-06",
      "2024-08-15",
      "2024-09-16", "2024-09-17", "2024-09-18",
      "2024-10-01", "2024-10-03", "2024-10-09",
      "2024-12-25"
    ],
    2025: [
      "2025-01-01",
      "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30",
      "2025-03-01", "2025-03-03",
      "2025-05-05", "2025-05-06",
      "2025-06-03", "2025-06-06",
      "2025-08-15",
      "2025-10-03", "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09",
      "2025-12-25"
    ],
    2026: [
      "2026-01-01",
      "2026-02-16", "2026-02-17", "2026-02-18",
      "2026-03-01", "2026-03-02",
      "2026-05-05", "2026-05-24", "2026-05-25",
      "2026-06-03", "2026-06-06",
      "2026-08-15", "2026-08-17",
      "2026-09-24", "2026-09-25", "2026-09-26",
      "2026-10-03", "2026-10-05", "2026-10-09",
      "2026-12-25"
    ]
  };

  function toMs(value) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }

  function toKstDate(ms) {
    return new Date(ms + KST_OFFSET_MS);
  }

  function getKstDateString(value) {
    const ms = typeof value === "number" ? value : toMs(value);
    if (ms === null) return "";
    return toKstDate(ms).toISOString().slice(0, 10);
  }

  function getKstMonthKey(value) {
    return getKstDateString(value).slice(0, 7);
  }

  function getKstHour(ms) {
    return toKstDate(ms).getUTCHours();
  }

  function getKstDay(ms) {
    return toKstDate(ms).getUTCDay();
  }

  function getKstYear(ms) {
    return Number(getKstDateString(ms).slice(0, 4));
  }

  function makeHolidaySet(years) {
    const set = new Set();
    years.forEach((year) => {
      (HOLIDAYS_BY_YEAR[year] || []).forEach((date) => set.add(date));
    });
    return set;
  }

  function hasHolidayDataForYear(year) {
    return Array.isArray(HOLIDAYS_BY_YEAR[year]);
  }

  function isHoliday(ms, holidaySet) {
    return holidaySet.has(getKstDateString(ms));
  }

  function isWeekendOrHoliday(ms, holidaySet) {
    const day = getKstDay(ms);
    return day === 0 || day === 6 || isHoliday(ms, holidaySet);
  }

  function nextKstHourBoundaryMs(ms) {
    const kst = toKstDate(ms);
    kst.setUTCMinutes(0, 0, 0);
    kst.setUTCHours(kst.getUTCHours() + 1);
    return kst.getTime() - KST_OFFSET_MS;
  }

  function normalizeRoomKey(roomKey) {
    if (!roomKey) return "";
    const normalized = String(roomKey).toLowerCase().trim();
    if (ROOM_PRICING[normalized]) return normalized;
    const match = normalized.match(/[a-e]/);
    return match ? match[0] : "";
  }

  function isNaverBooking(description) {
    return /예약번호\s*:\s*\S+/.test(description || "");
  }

  function getBookingChannel(event) {
    return isNaverBooking(event.description || event.extendedProps?.description || "")
      ? "naver"
      : "spacecloud";
  }

  function isExactOvernight(startMs, endMs) {
    const durationHours = (endMs - startMs) / (60 * 60 * 1000);
    return durationHours === 6 && getKstHour(startMs) === 0 && getKstHour(endMs) === 6;
  }

  function getSegmentRate(ms, roomPrice, holidaySet) {
    const hour = getKstHour(ms);
    if (hour >= 0 && hour < 6) {
      return { rate: roomPrice.dawnHourly, type: "새벽" };
    }

    if (isWeekendOrHoliday(ms, holidaySet)) {
      return { rate: roomPrice.after16, type: "주말/공휴일" };
    }

    if (hour < 16) {
      return { rate: roomPrice.before16, type: "평일 낮" };
    }

    return { rate: roomPrice.after16, type: "16시후" };
  }

  function calculateEventPrice(event, options = {}) {
    const roomKey = normalizeRoomKey(event.roomKey || event.extendedProps?.roomKey || event.className);
    const roomPrice = ROOM_PRICING[roomKey];
    const startMs = toMs(event.start);
    const endMs = toMs(event.end) ?? startMs;
    const holidaySet = options.holidaySet || makeHolidaySet([getKstYear(startMs || Date.now())]);

    if (!roomPrice || startMs === null || endMs === null || endMs <= startMs) {
      return {
        ok: false,
        roomKey,
        guideAmount: 0,
        paymentAmount: 0,
        durationHours: 0,
        channel: getBookingChannel(event),
        priceType: "계산불가",
        segments: []
      };
    }

    let guideAmount = 0;
    let priceType = "";
    const segments = [];

    if (isExactOvernight(startMs, endMs)) {
      guideAmount = roomPrice.overnight;
      priceType = "새벽통대관";
      segments.push({
        start: startMs,
        end: endMs,
        hours: 6,
        rate: roomPrice.overnight,
        type: "새벽통대관"
      });
    } else {
      let cursor = startMs;
      const typeTotals = {};

      while (cursor < endMs) {
        const next = Math.min(endMs, nextKstHourBoundaryMs(cursor));
        const hours = (next - cursor) / (60 * 60 * 1000);
        const segment = getSegmentRate(cursor, roomPrice, holidaySet);
        const amount = segment.rate * hours;

        guideAmount += amount;
        typeTotals[segment.type] = (typeTotals[segment.type] || 0) + amount;
        segments.push({
          start: cursor,
          end: next,
          hours,
          rate: segment.rate,
          type: segment.type
        });

        cursor = next;
      }

      priceType = Object.entries(typeTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([type]) => type)[0] || "일반";
    }

    const channel = getBookingChannel(event);
    const roundedGuideAmount = Math.round(guideAmount);
    const paymentAmount = roundedGuideAmount;

    return {
      ok: true,
      roomKey,
      guideAmount: roundedGuideAmount,
      paymentAmount,
      durationHours: (endMs - startMs) / (60 * 60 * 1000),
      channel,
      priceType,
      segments
    };
  }

  function normalizeCalendarEvent(event, roomKey) {
    const normalizedRoomKey = normalizeRoomKey(roomKey || event.roomKey || event.extendedProps?.roomKey || event.className);
    const start = event.start?.dateTime || event.start?.date || event.start;
    const end = event.end?.dateTime || event.end?.date || event.end || start;
    const description = event.description || event.extendedProps?.description || "";

    return {
      id: event.id || `${normalizedRoomKey}:${start}:${event.summary || event.title || ""}`,
      title: event.summary || event.title || "",
      start,
      end,
      description,
      roomKey: normalizedRoomKey
    };
  }

  function createEmptyMonthlyData() {
    return Array.from({ length: 12 }, (_, index) => {
      const byRoom = {};
      ROOM_KEYS.forEach((roomKey) => {
        byRoom[roomKey] = { guideAmount: 0, paymentAmount: 0, count: 0, hours: 0 };
      });
      return {
        month: index + 1,
        guideAmount: 0,
        paymentAmount: 0,
        count: 0,
        hours: 0,
        byRoom
      };
    });
  }

  function createRoomTotals() {
    const roomTotals = {};
    ROOM_KEYS.forEach((roomKey) => {
      roomTotals[roomKey] = { guideAmount: 0, paymentAmount: 0, count: 0, hours: 0 };
    });
    return roomTotals;
  }

  function addAmount(target, calculation) {
    target.guideAmount += calculation.guideAmount;
    target.paymentAmount += calculation.paymentAmount;
    target.count += 1;
    target.hours += calculation.durationHours;
  }

  function calculateStats(events, options = {}) {
    const selectedMonth = Number(options.month || 0);
    const amountMode = options.amountMode === "payment" ? "paymentAmount" : "guideAmount";
    const years = new Set();
    events.forEach((event) => {
      const startMs = toMs(event.start?.dateTime || event.start?.date || event.start);
      if (startMs !== null) years.add(getKstYear(startMs));
    });

    const holidaySet = options.holidaySet || makeHolidaySet(Array.from(years));
    const monthly = createEmptyMonthlyData();
    const roomTotals = createRoomTotals();
    const daily = {};
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, guideAmount: 0, paymentAmount: 0 }));
    const rows = [];

    const totals = {
      guideAmount: 0,
      paymentAmount: 0,
      count: 0,
      hours: 0,
      naverCount: 0,
      spacecloudCount: 0
    };

    events.forEach((rawEvent) => {
      const event = normalizeCalendarEvent(rawEvent);
      const startMs = toMs(event.start);
      if (startMs === null) return;

      const month = Number(getKstDateString(startMs).slice(5, 7));
      if (selectedMonth && selectedMonth !== month) return;

      const calculation = calculateEventPrice(event, { holidaySet });
      if (!calculation.ok) return;

      const roomKey = calculation.roomKey;
      const monthBucket = monthly[month - 1];
      const dayKey = getKstDateString(startMs);
      const hour = getKstHour(startMs);

      addAmount(totals, calculation);
      addAmount(monthBucket, calculation);
      addAmount(monthBucket.byRoom[roomKey], calculation);
      addAmount(roomTotals[roomKey], calculation);

      if (!daily[dayKey]) {
        daily[dayKey] = { guideAmount: 0, paymentAmount: 0, count: 0, hours: 0 };
      }
      addAmount(daily[dayKey], calculation);

      hourly[hour].count += 1;
      hourly[hour].guideAmount += calculation.guideAmount;
      hourly[hour].paymentAmount += calculation.paymentAmount;

      if (calculation.channel === "naver") totals.naverCount += 1;
      else totals.spacecloudCount += 1;

      rows.push({
        id: event.id,
        roomKey,
        roomName: ROOM_PRICING[roomKey].name,
        title: event.title,
        start: event.start,
        end: event.end,
        dayKey,
        month,
        priceType: calculation.priceType,
        channel: calculation.channel,
        guideAmount: calculation.guideAmount,
        paymentAmount: calculation.paymentAmount,
        durationHours: calculation.durationHours,
        segments: calculation.segments
      });
    });

    rows.sort((a, b) => toMs(a.start) - toMs(b.start));

    return {
      amountMode,
      totals,
      monthly,
      roomTotals,
      daily,
      hourly,
      rows
    };
  }

  async function fetchServerCacheEvents() {
    const response = await fetch("./data/events.json", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`서버 캐시 조회 실패: ${response.status}`);
    }

    const data = await response.json();
    return {
      meta: data,
      events: (data.events || []).map((event) => normalizeCalendarEvent(event))
    };
  }

  const api = {
    ROOM_KEYS,
    ROOM_PRICING,
    HOLIDAYS_BY_YEAR,
    makeHolidaySet,
    hasHolidayDataForYear,
    getKstDateString,
    getKstMonthKey,
    getKstHour,
    isNaverBooking,
    calculateEventPrice,
    calculateStats,
    fetchServerCacheEvents,
    normalizeCalendarEvent
  };

  if (typeof window !== "undefined") {
    window.RhythmjoyRevenuePolicy = api;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
