#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CONFIG_PATH = 'config/spacecloud-sync.local.json';
const DEFAULT_EXAMPLE_CONFIG_PATH = 'config/spacecloud-sync.example.json';
const DEFAULT_STATE_PATH = 'state/spacecloud-sync-log.json';
const DEFAULT_CACHE_URL =
  'https://xn--xy1b23ggrmm5bfb82ees967e.com/calendar_set/calendar_v10/data/events.json';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const BUILTIN_ROOMS = {
  a: {
    rhythmjoyName: 'A홀',
    spacecloudSpaceId: '66056',
    spacecloudProductId: '108673',
    spacecloudName: 'A홀 20평형-외부신발금지',
  },
  b: {
    rhythmjoyName: 'B홀',
    spacecloudSpaceId: '66056',
    spacecloudProductId: '108674',
    spacecloudName: 'B홀 16평형-외부신발금지',
  },
  c: {
    rhythmjoyName: 'C홀',
    spacecloudSpaceId: '66056',
    spacecloudProductId: '108675',
    spacecloudName: 'C홀 5평형-외부신발금지',
  },
  d: {
    rhythmjoyName: 'D홀',
    spacecloudSpaceId: '66056',
    spacecloudProductId: '108989',
    spacecloudName: 'D홀 4평형-외부신발금지',
  },
  e: {
    rhythmjoyName: 'E홀',
    spacecloudSpaceId: '66056',
    spacecloudProductId: '108676',
    spacecloudName: 'E홀15평형-외부신발금지',
  },
};

function usage() {
  return `Usage:
  node tools/spacecloud-sync.mjs plan [options]
  node tools/spacecloud-sync.mjs verify-ical [options]
  node tools/spacecloud-sync.mjs mark-uploaded --fingerprint <key> [options]

Options:
  --config <path>     Config path. Defaults to ${DEFAULT_CONFIG_PATH}.
  --state <path>      Local upload log path. Defaults to ${DEFAULT_STATE_PATH}.
  --from <date>       Start date in YYYY-MM-DD, inclusive.
  --to <date>         End date in YYYY-MM-DD, exclusive.
  --days <n>          Range length when --to is omitted. Defaults to 7.
  --rooms <keys>      Comma-separated room keys. Defaults to a,b,c,d,e.
  --fingerprint <key> Event key: room|YYYY-MM-DD|HH:mm|HH:mm.
  --source-event-id <id>
  --reservation-no <id>
  --note <text>
  --json              Print machine-readable JSON.

Examples:
  node tools/spacecloud-sync.mjs plan --from 2026-07-09 --days 1 --rooms b
  node tools/spacecloud-sync.mjs verify-ical --rooms b --from 2026-07-09 --days 1
  node tools/spacecloud-sync.mjs mark-uploaded --fingerprint 'b|2026-07-09|19:00|21:00'
`;
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'help',
    config: DEFAULT_CONFIG_PATH,
    state: DEFAULT_STATE_PATH,
    days: 7,
    rooms: null,
    json: false,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;
    if (key === 'days') {
      args.days = Number.parseInt(next, 10);
      if (!Number.isFinite(args.days) || args.days < 1) {
        throw new Error('--days must be a positive integer');
      }
    } else if (['config', 'state', 'from', 'to', 'rooms', 'fingerprint', 'source-event-id', 'reservation-no', 'note'].includes(key)) {
      args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function kstDateParts(date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function formatDateKey(date) {
  const p = kstDateParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function formatHourMinute(date) {
  const p = kstDateParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function minutesSinceStartOfKstDay(date) {
  const p = kstDateParts(date);
  return p.hour * 60 + p.minute;
}

function formatSlotTime(totalMinutes) {
  if (totalMinutes === 24 * 60) return '24:00';
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function dayDistance(startDate, endDate) {
  const startDay = parseDateOnlyKst(formatDateKey(startDate));
  const endDay = parseDateOnlyKst(formatDateKey(endDate));
  return Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS);
}

function normalizeReservationTimeRange(start, end) {
  const rawStartTime = formatHourMinute(start);
  const rawEndTime = formatHourMinute(end);
  const startMinute = minutesSinceStartOfKstDay(start);
  let endMinute = minutesSinceStartOfKstDay(end);
  const endDayDistance = dayDistance(start, end);
  const notes = [];
  const problems = [];

  if (endDayDistance === 1 && endMinute === 0) {
    endMinute = 24 * 60;
  } else if (endDayDistance === 0 && endMinute === 23 * 60 + 59) {
    endMinute = 24 * 60;
    notes.push('normalized-end-23:59-to-24:00');
  } else if (endDayDistance !== 0) {
    problems.push(`unsupported-cross-day-range:${rawStartTime}-${rawEndTime}`);
  }

  if (startMinute % 60 !== 0) {
    problems.push(`start-not-hour-unit:${rawStartTime}`);
  }

  const endIsHourUnit = endMinute % 60 === 0;
  if (!endIsHourUnit) {
    problems.push(`end-not-hour-unit:${rawEndTime}`);
  }

  if (endMinute <= startMinute) {
    problems.push(`invalid-time-range:${rawStartTime}-${rawEndTime}`);
  }

  return {
    startTime: formatSlotTime(startMinute),
    endTime: formatSlotTime(endMinute),
    rawStartTime,
    rawEndTime,
    isHourUnit: problems.length === 0,
    normalizationNotes: notes,
    timeProblems: problems,
  };
}

function parseDateOnlyKst(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error(`Expected YYYY-MM-DD date, got: ${value}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

function defaultFromDate() {
  const now = new Date(Date.now() + KST_OFFSET_MS);
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
  return new Date(monday.getTime() - KST_OFFSET_MS);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function parseRange(args) {
  const from = args.from ? parseDateOnlyKst(args.from) : defaultFromDate();
  const to = args.to ? parseDateOnlyKst(args.to) : addDays(from, args.days || 7);
  if (to <= from) {
    throw new Error('--to must be after --from');
  }
  return { from, to };
}

function roomKeysFromArgs(args, config) {
  const keys = args.rooms ? args.rooms.split(',').map((key) => key.trim()).filter(Boolean) : Object.keys(config.rooms);
  const unknown = keys.filter((key) => !config.rooms[key]);
  if (unknown.length > 0) {
    throw new Error(`Unknown room key(s): ${unknown.join(', ')}`);
  }
  return keys;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function emptyState() {
  return {
    version: 1,
    uploaded: [],
  };
}

async function loadState(statePath) {
  const state = await readJsonIfExists(statePath);
  if (!state) return emptyState();
  return {
    version: 1,
    uploaded: Array.isArray(state.uploaded) ? state.uploaded : [],
  };
}

function buildStateIndex(state) {
  const byFingerprint = new Map();
  const bySourceEventId = new Map();
  const byReservationNo = new Map();

  for (const item of state.uploaded || []) {
    if (item.fingerprint) byFingerprint.set(item.fingerprint, item);
    if (item.sourceEventId) bySourceEventId.set(item.sourceEventId, item);
    if (item.reservationNo) byReservationNo.set(item.reservationNo, item);
  }

  return { byFingerprint, bySourceEventId, byReservationNo };
}

function mergeConfig(userConfig) {
  return {
    calendarCacheUrl: userConfig?.calendarCacheUrl || DEFAULT_CACHE_URL,
    rooms: Object.fromEntries(
      Object.entries(BUILTIN_ROOMS).map(([key, room]) => [
        key,
        {
          ...room,
          ...(userConfig?.rooms?.[key] || {}),
        },
      ]),
    ),
    uploadPolicy: {
      requireReservationNumber: true,
      allowPaymentStatuses: ['결제완료'],
      ...(userConfig?.uploadPolicy || {}),
    },
  };
}

async function loadConfig(configPath) {
  const userConfig = await readJsonIfExists(configPath);
  if (userConfig) return mergeConfig(userConfig);

  const exampleConfig = await readJsonIfExists(DEFAULT_EXAMPLE_CONFIG_PATH);
  return mergeConfig(exampleConfig);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/calendar,text/plain,*/*',
      'user-agent': 'rhythmjoy-spacecloud-sync/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
  }
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function extractField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text || '').match(new RegExp(`${escaped}:\\s*([^\\n\\r]+)`));
  return match ? match[1].trim() : '';
}

function normalizeName(value) {
  return String(value || '')
    .replace(/님+$/u, '')
    .replace(/\s+/g, '')
    .trim();
}

function displayReserverName(value) {
  const normalized = normalizeName(value);
  if (!normalized) return '';
  return /[가-힣]/u.test(normalized) ? `${normalized}님` : normalized;
}

function normalizeTitleName(title) {
  return String(title || '')
    .replace(/^[A-E]홀\s*\(?\d*\s*/u, '')
    .trim();
}

function eventTimeMs(event, key) {
  const raw = event[key];
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function overlapsRange(event, from, to) {
  const startMs = eventTimeMs(event, 'start');
  const endMs = eventTimeMs(event, 'end') ?? startMs;
  if (startMs === null) return false;
  return startMs < to.getTime() && endMs > from.getTime();
}

function eventFingerprint(eventLike) {
  return [
    eventLike.roomKey,
    eventLike.date,
    eventLike.startTime,
    eventLike.endTime,
  ].join('|');
}

function compactDateKey(dateKey) {
  return String(dateKey || '').replace(/-/g, '');
}

function hourFromSlotTime(value) {
  const match = String(value || '').match(/^(\d{2}):00$/);
  if (!match) {
    throw new Error(`Expected HH:00 slot time, got: ${value}`);
  }
  return Number(match[1]);
}

function buildSpacecloudCreatePayload(candidate) {
  const ymd = compactDateKey(candidate.date);
  return {
    SDATE: ymd,
    EDATE: ymd,
    SHOUR: String(hourFromSlotTime(candidate.startTime)),
    EHOUR: String(hourFromSlotTime(candidate.endTime)),
    NAME: candidate.reserverNameDisplay || candidate.reserverName || candidate.reserverNameKey || candidate.title,
    TEL: '',
    MEMO: candidate.memo,
    REPEAT_TYPE: '-1',
    REPEAT_END_DATE: ymd,
  };
}

function buildSpacecloudUiInput(candidate) {
  const startHour = hourFromSlotTime(candidate.startTime);
  const endHour = hourFromSlotTime(candidate.endTime);
  return {
    reservationCalendarUrl: `https://partner.spacecloud.kr/reservation-calendar?product=${candidate.spacecloudProductId}&space=${candidate.spacecloudSpaceId}`,
    selectors: {
      date: '#start_day',
      startHour: '#shour',
      endHour: '#ehour',
      name: '#reserve_name',
      tel: '#reserve_tel',
      memo: '#reserve_memo',
      submit: '#_addExternalSchedule',
    },
    values: {
      date: candidate.date,
      startHourSelectValue: String(startHour - 1),
      endHourSelectValue: String(endHour - 1),
      name: candidate.reserverNameDisplay || candidate.reserverName || candidate.reserverNameKey || candidate.title,
      tel: '',
      memo: candidate.memo,
    },
  };
}

function toCandidate(event, roomConfig) {
  const description = event.description || event.extendedProps?.description || '';
  const start = new Date(event.start);
  const end = new Date(event.end || event.start);
  const reserverName = extractField(description, '예약자명') || normalizeTitleName(event.title);
  const reservationNo = extractField(description, '예약번호');
  const paymentStatus = extractField(description, '결제상태');
  const product = extractField(description, '예약상품');
  const roomKey = event.extendedProps?.roomKey || event.className || '';
  const normalizedTime = normalizeReservationTimeRange(start, end);

  const candidate = {
    source: 'rhythmjoy-google-calendar',
    googleEventId: event.extendedProps?.googleEventId || String(event.id || '').replace(/^[a-e]:/, ''),
    sourceEventId: event.id || '',
    roomKey,
    rhythmjoyRoomName: event.extendedProps?.roomName || roomConfig.rhythmjoyName,
    spacecloudSpaceId: roomConfig.spacecloudSpaceId,
    spacecloudProductId: roomConfig.spacecloudProductId,
    spacecloudRoomName: roomConfig.spacecloudName,
    title: event.title || '',
    date: formatDateKey(start),
    startTime: normalizedTime.startTime,
    endTime: normalizedTime.endTime,
    rawStartTime: normalizedTime.rawStartTime,
    rawEndTime: normalizedTime.rawEndTime,
    normalizationNotes: normalizedTime.normalizationNotes,
    timeProblems: normalizedTime.timeProblems,
    reserverName,
    reserverNameKey: normalizeName(reserverName),
    reserverNameDisplay: displayReserverName(reserverName),
    reservationNo,
    paymentStatus,
    product,
    memo: [
      'Rhythmjoy Google Calendar sync',
      `room=${event.extendedProps?.roomName || roomConfig.rhythmjoyName}`,
      `sourceEventId=${event.id || ''}`,
      event.extendedProps?.googleEventId ? `googleEventId=${event.extendedProps.googleEventId}` : '',
      reservationNo ? `naverReservationNo=${reservationNo}` : '',
    ].filter(Boolean).join(' / '),
  };
  candidate.fingerprint = eventFingerprint(candidate);
  candidate.spacecloudCreatePayload = buildSpacecloudCreatePayload(candidate);
  candidate.spacecloudUiInput = buildSpacecloudUiInput(candidate);
  return candidate;
}

function skipReason(candidate, config) {
  if (candidate.timeProblems?.length > 0) {
    return `time-not-hour-unit:${candidate.timeProblems.join(',')}`;
  }

  if (config.uploadPolicy.requireReservationNumber && !candidate.reservationNo) {
    return 'reservation-number-missing-likely-spacecloud-origin';
  }

  const allowedStatuses = config.uploadPolicy.allowPaymentStatuses || [];
  if (allowedStatuses.length > 0 && !allowedStatuses.includes(candidate.paymentStatus)) {
    return `payment-status-not-allowed:${candidate.paymentStatus || 'missing'}`;
  }

  return '';
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r?\n[ \t]/g, '');
}

function parseIcsDateValue(value) {
  const clean = String(value || '').trim();
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return null;
  const [, y, m, d, hh = '00', mm = '00', ss = '00', z] = match;
  if (z) {
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
  }
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)) - KST_OFFSET_MS);
}

function parseIcsLine(block, name) {
  const match = block.match(new RegExp(`(?:^|\\n)${name}(?:;[^:\\n]*)?:(.*)`));
  return match ? match[1].trim() : '';
}

function decodeIcsText(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseIcsEvents(text, roomKey, roomConfig) {
  const unfolded = unfoldIcs(text);
  return unfolded
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((part) => `BEGIN:VEVENT${part.split('END:VEVENT')[0]}END:VEVENT`)
    .map((block) => {
      const start = parseIcsDateValue(parseIcsLine(block, 'DTSTART'));
      const end = parseIcsDateValue(parseIcsLine(block, 'DTEND')) || start;
      if (!start) return null;
      const normalizedTime = normalizeReservationTimeRange(start, end);
      const event = {
        source: 'spacecloud-ical',
        uid: parseIcsLine(block, 'UID'),
        roomKey,
        rhythmjoyRoomName: roomConfig.rhythmjoyName,
        spacecloudProductId: roomConfig.spacecloudProductId,
        spacecloudRoomName: roomConfig.spacecloudName,
        summary: decodeIcsText(parseIcsLine(block, 'SUMMARY')),
        description: decodeIcsText(parseIcsLine(block, 'DESCRIPTION')),
        date: formatDateKey(start),
        startTime: normalizedTime.startTime,
        endTime: normalizedTime.endTime,
        rawStartTime: normalizedTime.rawStartTime,
        rawEndTime: normalizedTime.rawEndTime,
        normalizationNotes: normalizedTime.normalizationNotes,
        timeProblems: normalizedTime.timeProblems,
      };
      event.fingerprint = eventFingerprint(event);
      return event;
    })
    .filter(Boolean);
}

async function loadSpacecloudIcalEvents(config, roomKeys) {
  const byFingerprint = new Map();
  const byRoom = {};
  const failures = [];

  await Promise.all(
    roomKeys.map(async (roomKey) => {
      const room = config.rooms[roomKey];
      if (!room.icalUrl) {
        byRoom[roomKey] = [];
        return;
      }

      try {
        const events = parseIcsEvents(await fetchText(room.icalUrl), roomKey, room);
        byRoom[roomKey] = events;
        for (const event of events) {
          byFingerprint.set(event.fingerprint, event);
        }
      } catch (error) {
        failures.push({ roomKey, reason: error.message });
        byRoom[roomKey] = [];
      }
    }),
  );

  return { byFingerprint, byRoom, failures };
}

async function buildPlan(args) {
  const config = await loadConfig(args.config);
  const state = await loadState(args.state);
  const stateIndex = buildStateIndex(state);
  const roomKeys = roomKeysFromArgs(args, config);
  const range = parseRange(args);
  const cache = await fetchJson(config.calendarCacheUrl);
  const ical = await loadSpacecloudIcalEvents(config, roomKeys);
  const selectedRoomSet = new Set(roomKeys);
  const seenSourceFingerprints = new Set();
  const upload = [];
  const skipped = [];

  const sourceEvents = (cache.events || [])
    .filter((event) => selectedRoomSet.has(event.extendedProps?.roomKey))
    .filter((event) => overlapsRange(event, range.from, range.to))
    .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));

  for (const event of sourceEvents) {
    const roomKey = event.extendedProps?.roomKey;
    const roomConfig = config.rooms[roomKey];
    const candidate = toCandidate(event, roomConfig);
    const sourceDuplicate = seenSourceFingerprints.has(candidate.fingerprint);
    seenSourceFingerprints.add(candidate.fingerprint);

    const reason =
      skipReason(candidate, config) ||
      (sourceDuplicate ? 'duplicate-source-time-slot' : '') ||
      (stateIndex.bySourceEventId.has(candidate.sourceEventId) ? 'already-uploaded-local-log:source-event-id' : '') ||
      (candidate.reservationNo && stateIndex.byReservationNo.has(candidate.reservationNo) ? 'already-uploaded-local-log:reservation-no' : '') ||
      (stateIndex.byFingerprint.has(candidate.fingerprint) ? 'already-uploaded-local-log:fingerprint' : '') ||
      (ical.byFingerprint.has(candidate.fingerprint) ? 'already-in-spacecloud-ical' : '');

    if (reason) {
      skipped.push({ ...candidate, reason });
    } else {
      upload.push(candidate);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: formatDateKey(range.from),
      to: formatDateKey(range.to),
    },
    rooms: roomKeys.map((key) => ({
      key,
      rhythmjoyName: config.rooms[key].rhythmjoyName,
      spacecloudProductId: config.rooms[key].spacecloudProductId,
      hasIcalUrl: !!config.rooms[key].icalUrl,
      spacecloudIcalEventCount: ical.byRoom[key]?.length || 0,
    })),
    source: {
      calendarCacheUrl: config.calendarCacheUrl,
      generatedAt: cache.generatedAt || null,
      eventCountInRange: sourceEvents.length,
    },
    localState: {
      path: args.state,
      uploadedCount: state.uploaded.length,
    },
    upload,
    skipped,
    icalFailures: ical.failures,
  };
}

async function markUploaded(args) {
  if (!args.fingerprint) {
    throw new Error('mark-uploaded requires --fingerprint');
  }

  const state = await loadState(args.state);
  const index = buildStateIndex(state);
  const now = new Date().toISOString();
  const existing = index.byFingerprint.get(args.fingerprint);

  const item = {
    fingerprint: args.fingerprint,
    sourceEventId: args.sourceEventId || existing?.sourceEventId || '',
    reservationNo: args.reservationNo || existing?.reservationNo || '',
    note: args.note || existing?.note || '',
    uploadedAt: existing?.uploadedAt || now,
    updatedAt: now,
  };

  const uploaded = (state.uploaded || []).filter((entry) => entry.fingerprint !== args.fingerprint);
  uploaded.push(item);
  uploaded.sort((a, b) => String(a.fingerprint).localeCompare(String(b.fingerprint)));
  const nextState = {
    version: 1,
    updatedAt: now,
    uploaded,
  };
  await writeJson(args.state, nextState);
  return {
    statePath: args.state,
    uploadedCount: uploaded.length,
    marked: item,
  };
}

function compactEvent(event) {
  const normalized = event.normalizationNotes?.length > 0
    ? ` [${event.normalizationNotes.join(',')}]`
    : '';
  return `${event.date} ${event.startTime}-${event.endTime} ${event.rhythmjoyRoomName} ${event.reserverName || event.title}${normalized}`;
}

function printPlan(plan) {
  console.log(`SpaceCloud upload plan`);
  console.log(`Range: ${plan.range.from} <= date < ${plan.range.to}`);
  console.log(`Rooms: ${plan.rooms.map((room) => `${room.key}:${room.spacecloudProductId}`).join(', ')}`);
  console.log(`Source events in range: ${plan.source.eventCountInRange}`);
  console.log(`Upload candidates: ${plan.upload.length}`);
  console.log(`Skipped: ${plan.skipped.length}`);
  if (plan.icalFailures.length > 0) {
    console.log(`iCal failures: ${plan.icalFailures.map((failure) => `${failure.roomKey}:${failure.reason}`).join('; ')}`);
  }
  console.log('');

  if (plan.upload.length > 0) {
    console.log('[UPLOAD]');
    for (const event of plan.upload) {
      console.log(`- ${compactEvent(event)} / product=${event.spacecloudProductId} / reservation=${event.reservationNo || '-'}`);
    }
    console.log('');
  }

  if (plan.skipped.length > 0) {
    console.log('[SKIP]');
    for (const event of plan.skipped) {
      console.log(`- ${compactEvent(event)} / reason=${event.reason}`);
    }
  }
}

async function verifyIcal(args) {
  const config = await loadConfig(args.config);
  const roomKeys = roomKeysFromArgs(args, config);
  const range = parseRange(args);
  const ical = await loadSpacecloudIcalEvents(config, roomKeys);
  const rows = [];

  for (const roomKey of roomKeys) {
    for (const event of ical.byRoom[roomKey] || []) {
      const start = parseDateOnlyKst(event.date);
      if (start >= range.from && start < range.to) {
        rows.push(event);
      }
    }
  }

  rows.sort((a, b) => `${a.date} ${a.startTime} ${a.roomKey}`.localeCompare(`${b.date} ${b.startTime} ${b.roomKey}`));
  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: formatDateKey(range.from),
      to: formatDateKey(range.to),
    },
    eventCount: rows.length,
    events: rows,
    icalFailures: ical.failures,
  };
}

function printIcalVerify(result) {
  console.log(`SpaceCloud iCal verification`);
  console.log(`Range: ${result.range.from} <= date < ${result.range.to}`);
  console.log(`Events: ${result.eventCount}`);
  if (result.icalFailures.length > 0) {
    console.log(`iCal failures: ${result.icalFailures.map((failure) => `${failure.roomKey}:${failure.reason}`).join('; ')}`);
  }
  console.log('');
  for (const event of result.events) {
    const normalized = event.normalizationNotes?.length > 0
      ? ` [${event.normalizationNotes.join(',')}]`
      : '';
    console.log(`- ${event.date} ${event.startTime}-${event.endTime} ${event.rhythmjoyRoomName} ${event.summary}${normalized}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    console.log(usage());
    return;
  }

  if (args.command === 'plan') {
    const plan = await buildPlan(args);
    if (args.json) console.log(JSON.stringify(plan, null, 2));
    else printPlan(plan);
    return;
  }

  if (args.command === 'verify-ical') {
    const result = await verifyIcal(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printIcalVerify(result);
    return;
  }

  if (args.command === 'mark-uploaded') {
    const result = await markUploaded(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Marked uploaded: ${result.marked.fingerprint}`);
      console.log(`State: ${result.statePath}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
