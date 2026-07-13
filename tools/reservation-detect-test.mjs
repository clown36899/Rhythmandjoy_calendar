#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const DEFAULT_WORK_DIR = 'state/platform-detect-test';
const DEFAULT_PROFILE_DIR = path.join(DEFAULT_WORK_DIR, 'chrome-profile');
const DEFAULT_NAVER_BUSINESS_ID = '1257912';
const DEFAULT_DAYS = 14;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SPACECLOUD_ROOMS = {
  a: { name: 'A홀', spaceId: '66056', productId: '108673' },
  b: { name: 'B홀', spaceId: '66056', productId: '108674' },
  c: { name: 'C홀', spaceId: '66056', productId: '108675' },
  d: { name: 'D홀', spaceId: '66056', productId: '108989' },
  e: { name: 'E홀', spaceId: '66056', productId: '108676' },
};

function usage() {
  return `Usage:
  node tools/reservation-detect-test.mjs login --platform <naver|spacecloud|both> [options]
  node tools/reservation-detect-test.mjs scan --platform <naver|spacecloud|both> [options]
  node tools/reservation-detect-test.mjs watch --platform <naver|spacecloud|both> [options]
  node tools/reservation-detect-test.mjs self-test

This is a read-only proof-of-concept. It does not read email, write DB rows,
send SMS, or change Naver/SpaceCloud availability.

Options:
  --platform <name>       naver, spacecloud, or both. Defaults to both.
  --profile-dir <path>    Dedicated Chrome profile. Defaults to ${DEFAULT_PROFILE_DIR}.
  --work-dir <path>       Output directory. Defaults to ${DEFAULT_WORK_DIR}.
  --from <YYYY-MM-DD>     Start date. Defaults to today in KST.
  --to <YYYY-MM-DD>       End date, exclusive. Defaults to --from + --days.
  --days <n>              Range length when --to is omitted. Defaults to ${DEFAULT_DAYS}.
  --rooms <keys>          SpaceCloud room keys. Defaults to a,b,c,d,e.
  --naver-business-id <id>
                          Defaults to ${DEFAULT_NAVER_BUSINESS_ID}.
  --interval-seconds <n>  Watch interval. Defaults to 60.
  --cycles <n>            Watch cycle count. Defaults to 1. Use 0 for infinite.
  --settle-ms <n>         Wait after navigation. Defaults to 2500.
  --headless              Run headless.
  --keep-open             Keep login browser open until Ctrl+C.
  --json                  Print machine-readable JSON.

Examples:
  node tools/reservation-detect-test.mjs login --platform both --keep-open
  node tools/reservation-detect-test.mjs scan --platform both --from 2026-07-14 --days 7
  node tools/reservation-detect-test.mjs watch --platform both --interval-seconds 60 --cycles 3
  node tools/reservation-detect-test.mjs self-test
`;
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'help',
    platform: 'both',
    profileDir: DEFAULT_PROFILE_DIR,
    workDir: DEFAULT_WORK_DIR,
    days: DEFAULT_DAYS,
    rooms: 'a,b,c,d,e',
    naverBusinessId: DEFAULT_NAVER_BUSINESS_ID,
    intervalSeconds: 60,
    cycles: 1,
    settleMs: 2500,
    headless: false,
    keepOpen: false,
    json: false,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--headless') {
      args.headless = true;
      continue;
    }
    if (arg === '--keep-open') {
      args.keepOpen = true;
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;

    if (['days', 'interval-seconds', 'cycles', 'settle-ms'].includes(key)) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${arg} must be a non-negative integer`);
      args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = parsed;
    } else if (['platform', 'from', 'to', 'rooms'].includes(key)) {
      args[key] = next;
    } else if (key === 'profile-dir') {
      args.profileDir = next;
    } else if (key === 'work-dir') {
      args.workDir = next;
    } else if (key === 'naver-business-id') {
      args.naverBusinessId = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['naver', 'spacecloud', 'both'].includes(args.platform)) {
    throw new Error('--platform must be naver, spacecloud, or both');
  }
  return args;
}

function kstToday() {
  const now = new Date(Date.now() + KST_OFFSET_MS);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`Expected YYYY-MM-DD date, got: ${value}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

function formatDateOnly(date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function parseRange(args) {
  const fromText = args.from || kstToday();
  const from = parseDateOnly(fromText);
  const to = args.to ? parseDateOnly(args.to) : addDays(from, args.days || DEFAULT_DAYS);
  if (to <= from) throw new Error('--to must be after --from');
  return {
    from,
    to,
    fromText: formatDateOnly(from),
    toText: formatDateOnly(to),
  };
}

function monthKeysInRange(from, to) {
  const keys = [];
  const start = new Date(Date.UTC(
    Number(formatDateOnly(from).slice(0, 4)),
    Number(formatDateOnly(from).slice(5, 7)) - 1,
    1,
  ) - KST_OFFSET_MS);
  for (let cursor = start; cursor < to; cursor = new Date(Date.UTC(
    Number(formatDateOnly(cursor).slice(0, 4)),
    Number(formatDateOnly(cursor).slice(5, 7)),
    1,
  ) - KST_OFFSET_MS)) {
    keys.push(formatDateOnly(cursor).slice(0, 7));
  }
  return keys;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, '');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeName(value) {
  return String(value || '').replace(/님+$/u, '').replace(/\s+/g, '').trim();
}

function parseDateText(value) {
  const text = String(value || '');
  const full = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (full) {
    return `${full[1]}-${String(Number(full[2])).padStart(2, '0')}-${String(Number(full[3])).padStart(2, '0')}`;
  }
  return '';
}

function timeToText(hour, minute = 0, { isEnd = false } = {}) {
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  if (isEnd && hour === 23 && minute >= 55) return '24:00';
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return '';
  if (hour === 24 && minute !== 0) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeTokenToParts(hourRaw, minuteRaw, meridiemRaw = '') {
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw || '0');
  const meridiem = String(meridiemRaw || '').trim();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (meridiem === '오후' && hour < 12) hour += 12;
  if (meridiem === '오전' && hour === 12) hour = 0;
  return { hour, minute };
}

function parseTimeRangeText(value) {
  const text = String(value || '');
  const matches = [...text.matchAll(/(?:^|[^\d])(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?\s*[~\-–]\s*(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?(?!\d)/g)];
  const match = matches.find((candidate) => {
    const raw = candidate[0];
    const numberOffset = raw.search(/(오전|오후)?\s*\d/);
    const candidateStart = candidate.index + Math.max(0, numberOffset);
    const numericRange = `${candidate[2]}-${candidate[5]}`;
    const isDashOnlyNumeric = !candidate[1] && !candidate[3] && !candidate[4] && !candidate[6] && raw.includes('-');
    const isMonthDayDateFragment = isDashOnlyNumeric
      && /^\d{1,2}-\d{1,2}$/.test(numericRange)
      && /20\d{2}\s*-$/.test(text.slice(Math.max(0, candidateStart - 8), candidateStart));
    return !isMonthDayDateFragment;
  });
  if (!match) return { startTime: '', endTime: '' };
  const start = timeTokenToParts(match[2], match[3], match[1]);
  const end = timeTokenToParts(match[5], match[6], match[4] || match[1]);
  if (!start || !end) return { startTime: '', endTime: '' };
  return {
    startTime: timeToText(start.hour, start.minute),
    endTime: timeToText(end.hour, end.minute, { isEnd: true }),
  };
}

function parseSingleTimeText(value, { isEnd = false } = {}) {
  const text = String(value || '');
  const dateTimeMatch = text.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?(?:[.+-]\d{2}:?\d{2}|Z)?/);
  if (dateTimeMatch) {
    return timeToText(Number(dateTimeMatch[1]), Number(dateTimeMatch[2]), { isEnd });
  }
  const match = text.match(/(?:^|[^\d])(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?(?!\d)/);
  if (!match) return '';
  const parsed = timeTokenToParts(match[2], match[3], match[1]);
  if (!parsed) return '';
  return timeToText(parsed.hour, parsed.minute, { isEnd });
}

function pickByKeyList(flat, regex) {
  return Object.entries(flat)
    .filter(([key, value]) => regex.test(key) && value != null && String(value).trim())
    .map(([key, value]) => ({ key, value: String(value).trim() }));
}

function parseReservationTiming(flat, joined) {
  const startCandidates = pickByKeyList(flat, /(^|\.)(start(Date|Time|At|Hour|Ymd|Dt|Dtm)?|start.*(date|time|at|hour|ymd|dt|dtm)|useStart.*|reservationStart.*|reserveStart.*|bookingStart.*|begin.*|from)$/i);
  const endCandidates = pickByKeyList(flat, /(^|\.)(end(Date|Time|At|Hour|Ymd|Dt|Dtm)?|end.*(date|time|at|hour|ymd|dt|dtm)|useEnd.*|reservationEnd.*|reserveEnd.*|bookingEnd.*|finish.*|until|to)$/i);
  const dateCandidates = pickByKeyList(flat, /(^|\.)(date|day|ymd|useDate|reservationDate|reserveDate|bookingDate|visitDate|useYmd)$/i);
  const timeRangeCandidates = pickByKeyList(flat, /(^|\.)(time|timeRange|useTime|reservationTime|reserveTime|bookingTime|slot|hour)$/i);

  const firstParsedDate = [...startCandidates, ...dateCandidates, ...endCandidates]
    .map((row) => parseDateText(row.value))
    .find(Boolean) || parseDateText(joined);

  const directRange = [...timeRangeCandidates, ...startCandidates]
    .map((row) => parseTimeRangeText(row.value))
    .find((row) => row.startTime && row.endTime)
    || parseTimeRangeText(joined);

  let startTime = directRange.startTime || '';
  let endTime = directRange.endTime || '';

  if (!startTime) {
    startTime = startCandidates
      .map((row) => parseSingleTimeText(row.value))
      .find(Boolean) || '';
  }
  if (!endTime) {
    endTime = endCandidates
      .map((row) => parseSingleTimeText(row.value, { isEnd: true }))
      .find(Boolean) || '';
  }

  return {
    date: firstParsedDate,
    startTime,
    endTime,
    timingKeys: {
      start: startCandidates.slice(0, 5).map((row) => row.key),
      end: endCandidates.slice(0, 5).map((row) => row.key),
      date: dateCandidates.slice(0, 5).map((row) => row.key),
    },
  };
}

function flattenObject(value, {
  prefix = '',
  depth = 0,
  output = {},
  maxDepth = 5,
  maxFields = 180,
} = {}) {
  if (Object.keys(output).length >= maxFields) return output;
  if (value == null || depth > maxDepth) return output;

  if (typeof value !== 'object') {
    output[prefix || 'value'] = value;
    return output;
  }

  if (Array.isArray(value)) {
    value.slice(0, 30).forEach((entry, index) => {
      flattenObject(entry, {
        prefix: prefix ? `${prefix}.${index}` : String(index),
        depth: depth + 1,
        output,
        maxDepth,
        maxFields,
      });
    });
    return output;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object') {
      flattenObject(entry, {
        prefix: nextPrefix,
        depth: depth + 1,
        output,
        maxDepth,
        maxFields,
      });
    } else {
      output[nextPrefix] = entry;
    }
    if (Object.keys(output).length >= maxFields) break;
  }
  return output;
}

function pickByKey(flat, regex) {
  for (const [key, value] of Object.entries(flat)) {
    if (regex.test(key) && value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function pickAnyString(flat, regex) {
  for (const value of Object.values(flat)) {
    if (value == null) continue;
    const text = String(value);
    const match = text.match(regex);
    if (match) return match[0];
  }
  return '';
}

function normalizeJsonReservation({
  platform,
  roomKey = '',
  object,
  source,
  pathHint,
}) {
  const flat = flattenObject(object);
  const joined = Object.values(flat).map((value) => String(value ?? '')).join(' ');
  const keys = Object.keys(flat).join(' ');
  const dateRaw = pickByKey(flat, /(date|day|ymd|useDate|startDate|endDate|reservationDate|reserveDate|bookingDate|visitDate)/i)
    || pickAnyString(flat, /20\d{2}[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}/);
  const timeRaw = pickByKey(flat, /(time|startAt|endAt|startHour|endHour|hour|slot)/i)
    || pickAnyString(flat, /\d{1,2}(?::\d{2})?\s*[~\-–]\s*\d{1,2}(?::\d{2})?/);
  const reservationNo = pickByKey(flat, /(reservationNo|reservationNumber|reserveNo|bookingNo|bookingId|reservationId|reserveId|orderNo|orderId|bizBookingId)$/i)
    || pickByKey(flat, /(reservation|reserve|booking|order).*id$/i);
  const name = pickByKey(flat, /(reserver|booker|userName|visitorName|customerName|memberName|guestName|applicantName|예약자|이용자)/i);
  const phone = normalizePhone(pickByKey(flat, /(phone|tel|mobile|cell)/i) || pickAnyString(flat, /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/));
  const status = pickByKey(flat, /(status|state|bookingStatus|reservationStatus|useStatus|paymentStatus)/i);
  const product = pickByKey(flat, /(product|item|bizItem|room|space|goods|service).*name/i)
    || pickByKey(flat, /(productName|itemName|bizItemName|roomName|spaceName|goodsName|serviceName|title)$/i);
  const parsedTiming = parseReservationTiming(flat, joined);
  const parsedDate = parsedTiming.date || parseDateText(dateRaw) || parseDateText(joined);
  const parsedTimes = parseTimeRangeText(timeRaw);
  const startTime = parsedTiming.startTime || parsedTimes.startTime || '';
  const endTime = parsedTiming.endTime || parsedTimes.endTime || '';

  let score = 0;
  if (reservationNo) score += 2;
  if (parsedDate || /date|day|ymd/i.test(keys)) score += 1;
  if (startTime || /time|hour|slot/i.test(keys)) score += 1;
  if (name || phone) score += 1;
  if (status) score += 1;
  if (product) score += 1;
  if (!/(reservation|reserve|booking|order|calendar|schedule|bizItem|space|room|예약|이용|취소|확정)/i.test(keys) && !/(예약|확정|취소|이용|결제)/.test(joined)) return null;
  if (!reservationNo && !parsedDate && !startTime) return null;
  if (score < 3) return null;

  return {
    platform,
    source: 'network-json',
    roomKey,
    reservationNo,
    status,
    name,
    nameKey: normalizeName(name),
    phoneLast4: phone ? phone.slice(-4) : '',
    product,
    date: parsedDate,
    startTime,
    endTime,
    responseUrl: source.url,
    responseStatus: source.status,
    pathHint,
    fieldCount: Object.keys(flat).length,
    keySample: Object.keys(flat).slice(0, 24),
    timingKeys: parsedTiming.timingKeys,
    textSample: normalizeSpace(joined).slice(0, 260),
  };
}

function extractReservationsFromJson(json, meta, {
  platform,
  roomKey = '',
} = {}) {
  const rows = [];
  const seen = new Set();
  const stack = [{ value: json, pathHint: '$' }];
  while (stack.length) {
    const { value, pathHint } = stack.pop();
    if (!value || typeof value !== 'object') continue;

    if (Array.isArray(value)) {
      value.slice(0, 1000).forEach((entry, index) => {
        stack.push({ value: entry, pathHint: `${pathHint}[${index}]` });
      });
      continue;
    }

    const reservation = normalizeJsonReservation({
      platform,
      roomKey,
      object: value,
      source: meta,
      pathHint,
    });
    if (reservation) {
      const key = JSON.stringify([
        reservation.platform,
        reservation.reservationNo,
        reservation.roomKey,
        reservation.date,
        reservation.startTime,
        reservation.endTime,
        reservation.nameKey,
        reservation.status,
        reservation.responseUrl,
        reservation.pathHint,
      ]);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(reservation);
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      if (entry && typeof entry === 'object') {
        stack.push({ value: entry, pathHint: `${pathHint}.${key}` });
      }
    }
  }
  return rows;
}

function reservationIdentity(row) {
  const strongId = row.reservationNo ? `no:${row.reservationNo}` : '';
  const fallback = [
    row.roomKey || row.product || '',
    row.date || '',
    row.startTime || '',
    row.endTime || '',
    row.nameKey || row.name || '',
  ].join('|');
  return [
    row.platform,
    strongId || `fallback:${fallback}`,
  ].join('|');
}

function uniqueReservations(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = reservationIdentity(row);
    const previous = map.get(id);
    if (!previous) {
      map.set(id, { ...row, identity: id, evidenceCount: 1, sources: [row.source] });
      continue;
    }
    map.set(id, {
      ...previous,
      reservationNo: previous.reservationNo || row.reservationNo,
      status: previous.status || row.status,
      name: previous.name || row.name,
      nameKey: previous.nameKey || row.nameKey,
      phoneLast4: previous.phoneLast4 || row.phoneLast4,
      product: previous.product || row.product,
      date: previous.date || row.date,
      startTime: previous.startTime || row.startTime,
      endTime: previous.endTime || row.endTime,
      evidenceCount: previous.evidenceCount + 1,
      sources: [...new Set([...(previous.sources || []), row.source])],
    });
  }
  return [...map.values()].sort((a, b) => reservationSortKey(a).localeCompare(reservationSortKey(b)));
}

function reservationSortKey(row) {
  return [row.date || '9999-99-99', row.startTime || '99:99', row.roomKey || '', row.nameKey || '', row.reservationNo || ''].join('|');
}

function shouldCaptureResponse(url, platform) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  const text = `${parsed.pathname}?${parsed.searchParams}`.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|woff|woff2|ttf|ico|map)$/i.test(parsed.pathname)) return false;
  if (platform === 'naver') {
    if (![
      'partner.booking.naver.com',
      'prod-partner.io.naver.com',
      'api.booking.naver.com',
      'booking.naver.com',
      'new.smartplace.naver.com',
    ].some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`))) return false;
    return /(booking|reservation|reserve|biz|order|calendar|schedule|graphql|api)/i.test(text);
  }
  if (platform === 'spacecloud') {
    if (!/(^|\.)spacecloud\.kr$/.test(host)) return false;
    return /(reservation|reserve|calendar|schedule|booking|api|ajax|partner)/i.test(text);
  }
  return false;
}

function attachNetworkCollector(page, platform) {
  const responses = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!shouldCaptureResponse(url, platform)) return;
    const headers = response.headers();
    const contentType = headers['content-type'] || '';
    const meta = {
      platform,
      url,
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      contentType,
      capturedAt: new Date().toISOString(),
    };
    try {
      const text = await response.text();
      meta.byteLength = Buffer.byteLength(text);
      meta.textPreview = normalizeSpace(text).slice(0, 240);
      if (contentType.includes('json') || /^[\s\n\r]*[\[{]/.test(text)) {
        try {
          meta.json = JSON.parse(text);
        } catch {
          meta.parseError = 'json-parse-failed';
        }
      }
    } catch (error) {
      meta.error = String(error?.message || error);
    }
    responses.push(meta);
  });
  return responses;
}

async function loadPlaywright() {
  const roots = [
    process.cwd(),
    process.env.PLAYWRIGHT_NODE_MODULES || '',
    ...String(process.env.NODE_PATH || '').split(path.delimiter),
    '/Users/inteyeo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
    '/Users/inteyeo/Rhythmjoy2025555-5/node_modules',
    '/Users/inteyeo/web_crawling/node_modules',
  ].filter(Boolean);

  for (const root of roots) {
    try {
      const resolved = require.resolve('playwright', { paths: [root] });
      const mod = await import(pathToFileURL(resolved));
      return mod.default || mod;
    } catch {}
  }
  throw new Error('playwright dependency not found. Install Playwright or set NODE_PATH/PLAYWRIGHT_NODE_MODULES.');
}

async function openContext(args) {
  const { chromium } = await loadPlaywright();
  await fs.mkdir(args.profileDir, { recursive: true });
  const launchOptions = {
    headless: args.headless,
    viewport: { width: 1440, height: 1000 },
    locale: 'ko-KR',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  };
  try {
    return await chromium.launchPersistentContext(args.profileDir, {
      ...launchOptions,
      channel: 'chrome',
    });
  } catch (error) {
    if (!/channel|executable|Chrome/i.test(String(error?.message || error))) throw error;
    return chromium.launchPersistentContext(args.profileDir, launchOptions);
  }
}

async function pageForContext(context) {
  const pages = context.pages();
  return pages[0] || context.newPage();
}

async function waitForSettledPage(page, settleMs) {
  await page.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
}

function isNaverLoginUrl(url) {
  return /nid\.naver\.com|login/i.test(String(url || ''));
}

function isSpacecloudLoginUrl(url) {
  return /nid\.naver\.com|login|auth/i.test(String(url || ''));
}

function naverListUrl(args, range) {
  const params = new URLSearchParams({
    dateDropdownType: 'DIRECT',
    startDateTime: range.fromText,
    endDateTime: range.toText,
    dateFilter: 'USEDATE',
    searchValueCode: 'USER_NAME',
  });
  return `https://partner.booking.naver.com/bizes/${args.naverBusinessId}/booking-list-view?${params}`;
}

function naverCalendarUrl(args) {
  return `https://partner.booking.naver.com/bizes/${args.naverBusinessId}/booking-calendar-view`;
}

function spacecloudCalendarUrl(roomKey) {
  const room = SPACECLOUD_ROOMS[roomKey];
  if (!room) throw new Error(`Unknown SpaceCloud room key: ${roomKey}`);
  return `https://partner.spacecloud.kr/reservation-calendar?product=${room.productId}&space=${room.spaceId}`;
}

async function extractDomBlocks(page, platform, {
  roomKey = '',
  limit = 240,
} = {}) {
  return page.evaluate(({ platform, roomKey, limit }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const selectors = platform === 'naver'
      ? [
        'tr',
        'li',
        'article',
        '[class*="Booking"]',
        '[class*="booking"]',
        '[class*="Reservation"]',
        '[class*="reservation"]',
        '[class*="List"]',
      ]
      : [
        '.booking_wrap a',
        '.booking_wrap button',
        '.booking_wrap [onclick]',
        '.booking_wrap [role="button"]',
        '.type1',
        '.type2',
        '.type3',
        '.type4',
        '.type5',
        '.type6',
        '[class*="reservation"]',
        '[class*="reserve"]',
      ];
    const nodes = [...document.querySelectorAll([...new Set(selectors)].join(','))];
    const rows = [];
    const seen = new Set();
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const text = normalize(el.innerText || el.textContent || '');
      if (!text || text.length < 3) continue;
      const compact = text.replace(/\s+/g, '');
      const looksRelevant = platform === 'naver'
        ? /(예약|확정|취소|신청|이용|결제|[0-2]?\d[:~\-][0-5]?\d?|\d{4}[.\-]\d{1,2}[.\-]\d{1,2})/.test(compact)
        : /(예약|확정|취소|승인|결제|이용완료|추|[0-2]?\d[:~\-][0-5]?\d?)/.test(compact);
      if (!looksRelevant) continue;
      const className = String(el.getAttribute('class') || '');
      const href = String(el.getAttribute('href') || '');
      const key = `${text}|${className}|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rect = el.getBoundingClientRect();
      rows.push({
        platform,
        source: 'dom',
        roomKey,
        tagName: String(el.tagName || '').toLowerCase(),
        className: className.slice(0, 180),
        href: href.slice(0, 220),
        text: text.slice(0, 500),
        date: '',
        startTime: '',
        endTime: '',
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }, { platform, roomKey, limit });
}

function domBlocksToReservations(blocks) {
  return blocks.map((block) => {
    const date = parseDateText(block.text);
    const { startTime, endTime } = parseTimeRangeText(block.text);
    if (!date && !startTime) return null;
    return {
      platform: block.platform,
      source: 'dom-text',
      roomKey: block.roomKey,
      reservationNo: '',
      status: statusFromText(block.text),
      name: '',
      nameKey: '',
      phoneLast4: '',
      product: '',
      date,
      startTime,
      endTime,
      textSample: block.text.slice(0, 220),
    };
  }).filter(Boolean);
}

function statusFromText(text) {
  const compact = compactText(text);
  if (/취소|cancel/i.test(compact)) return 'canceled';
  if (/확정|결제완료|예약확정|confirmed/i.test(compact)) return 'confirmed';
  if (/신청|승인대기|대기|pending/i.test(compact)) return 'pending';
  if (/이용완료|완료/i.test(compact)) return 'completed';
  return '';
}

async function calendarMonth(page) {
  const text = await page.evaluate(() => {
    const title = document.querySelector('.calendar_tit.short strong')
      || document.querySelector('.calendar_tit.short')
      || document.querySelector('.calendar_tit strong')
      || document.querySelector('.calendar_tit');
    return title?.innerText || title?.textContent || '';
  });
  const match = String(text).match(/(20\d{2})\s*\.\s*(\d{1,2})/);
  if (!match) throw new Error(`SpaceCloud calendar month not found: ${String(text).slice(0, 120)}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function ymIndex(value) {
  return value.year * 12 + value.month;
}

function ymFromText(value) {
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

async function gotoSpacecloudMonth(page, ym) {
  const target = ymFromText(ym);
  for (let i = 0; i < 36; i += 1) {
    const current = await calendarMonth(page);
    const diff = ymIndex(target) - ymIndex(current);
    if (diff === 0) return current;
    const selector = diff > 0 ? '.calendar_tit.short .btn_next, .calendar_tit .btn_next' : '.calendar_tit.short .btn_prev, .calendar_tit .btn_prev';
    const button = page.locator(selector).filter({ visible: true });
    const count = await button.count();
    if (count < 1) throw new Error(`SpaceCloud month control not found: ${selector}`);
    await button.first().click({ timeout: 8000 });
    await page.waitForTimeout(900);
  }
  throw new Error(`SpaceCloud month navigation failed: ${ym}`);
}

function summarizeResponses(responses, platform, roomKey = '') {
  const jsonResponses = responses.filter((row) => row.json);
  const reservations = [];
  for (const response of jsonResponses) {
    reservations.push(...extractReservationsFromJson(response.json, response, { platform, roomKey }));
  }
  return {
    responseCount: responses.length,
    jsonResponseCount: jsonResponses.length,
    responses: responses.map((row) => ({
      platform: row.platform,
      url: row.url,
      status: row.status,
      method: row.method,
      resourceType: row.resourceType,
      contentType: row.contentType,
      byteLength: row.byteLength,
      parseError: row.parseError || '',
      error: row.error || '',
      textPreview: row.textPreview || '',
    })),
    reservations,
  };
}

async function scanNaver(context, args, range) {
  const page = await pageForContext(context);
  const responses = attachNetworkCollector(page, 'naver');
  const url = naverListUrl(args, range);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettledPage(page, args.settleMs);
  const currentUrl = page.url();
  const domBlocks = await extractDomBlocks(page, 'naver');
  const network = summarizeResponses(responses, 'naver');
  const domReservations = domBlocksToReservations(domBlocks);
  return {
    platform: 'naver',
    ok: !isNaverLoginUrl(currentUrl),
    loginRequired: isNaverLoginUrl(currentUrl),
    url,
    currentUrl,
    range: { from: range.fromText, to: range.toText },
    network,
    dom: {
      blockCount: domBlocks.length,
      blocks: domBlocks.slice(0, 80),
      reservations: domReservations,
    },
    reservations: uniqueReservations([...network.reservations, ...domReservations]),
  };
}

async function scanSpacecloud(context, args, range) {
  const page = await pageForContext(context);
  const roomKeys = args.rooms.split(',').map((room) => room.trim()).filter(Boolean);
  const unknown = roomKeys.filter((roomKey) => !SPACECLOUD_ROOMS[roomKey]);
  if (unknown.length > 0) throw new Error(`Unknown SpaceCloud room key(s): ${unknown.join(', ')}`);

  const months = monthKeysInRange(range.from, range.to);
  const roomResults = [];
  const allReservations = [];
  let loginRequired = false;

  for (const roomKey of roomKeys) {
    const room = SPACECLOUD_ROOMS[roomKey];
    const responses = attachNetworkCollector(page, 'spacecloud');
    const roomUrl = spacecloudCalendarUrl(roomKey);
    await page.goto(roomUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForSettledPage(page, args.settleMs);
    if (isSpacecloudLoginUrl(page.url())) {
      loginRequired = true;
      roomResults.push({
        roomKey,
        roomName: room.name,
        ok: false,
        loginRequired: true,
        url: roomUrl,
        currentUrl: page.url(),
        months: [],
        network: summarizeResponses(responses, 'spacecloud', roomKey),
        reservations: [],
      });
      continue;
    }

    const monthResults = [];
    for (const ym of months) {
      await gotoSpacecloudMonth(page, ym);
      await waitForSettledPage(page, args.settleMs);
      const domBlocks = await extractDomBlocks(page, 'spacecloud', { roomKey });
      const domReservations = domBlocksToReservations(domBlocks).map((row) => ({
        ...row,
        roomKey,
        product: room.name,
      }));
      monthResults.push({
        ym,
        currentUrl: page.url(),
        dom: {
          blockCount: domBlocks.length,
          blocks: domBlocks.slice(0, 80),
          reservations: domReservations,
        },
      });
    }

    const network = summarizeResponses(responses, 'spacecloud', roomKey);
    const roomReservations = uniqueReservations([
      ...network.reservations.map((row) => ({ ...row, roomKey: row.roomKey || roomKey, product: row.product || room.name })),
      ...monthResults.flatMap((month) => month.dom.reservations),
    ]);
    allReservations.push(...roomReservations);
    roomResults.push({
      roomKey,
      roomName: room.name,
      ok: true,
      loginRequired: false,
      url: roomUrl,
      currentUrl: page.url(),
      months: monthResults,
      network,
      reservations: roomReservations,
    });
  }

  return {
    platform: 'spacecloud',
    ok: !loginRequired,
    loginRequired,
    range: { from: range.fromText, to: range.toText },
    rooms: roomResults,
    reservations: uniqueReservations(allReservations),
  };
}

function diffSnapshots(previous, current) {
  const previousRows = uniqueReservations(previous?.reservations || []);
  const currentRows = uniqueReservations(current?.reservations || []);
  const prevMap = new Map(previousRows.map((row) => [reservationIdentity(row), row]));
  const currMap = new Map(currentRows.map((row) => [reservationIdentity(row), row]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, row] of currMap.entries()) {
    const prev = prevMap.get(key);
    if (!prev) {
      added.push(row);
      continue;
    }
    const watchedFields = ['status', 'date', 'startTime', 'endTime', 'roomKey', 'nameKey', 'product'];
    const changes = watchedFields
      .filter((field) => String(prev[field] || '') !== String(row[field] || ''))
      .map((field) => ({ field, before: prev[field] || '', after: row[field] || '' }));
    if (changes.length > 0) changed.push({ identity: key, before: prev, after: row, changes });
  }

  for (const [key, row] of prevMap.entries()) {
    if (!currMap.has(key)) removed.push(row);
  }

  return {
    added,
    removed,
    changed,
    counts: {
      previous: previousRows.length,
      current: currentRows.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    },
  };
}

async function saveSnapshot(args, snapshot) {
  const snapshotPath = path.join(args.workDir, 'snapshots', `${timestampForFile()}.json`);
  const latestPath = path.join(args.workDir, 'latest.json');
  const previous = await readJson(latestPath);
  const diff = diffSnapshots(previous, snapshot);
  const withDiff = { ...snapshot, diff };
  await writeJson(snapshotPath, withDiff);
  await writeJson(latestPath, withDiff);
  return { snapshotPath, latestPath, diff };
}

async function runScan(context, args) {
  const range = parseRange(args);
  const startedAt = new Date().toISOString();
  const results = {};
  const reservations = [];

  if (args.platform === 'naver' || args.platform === 'both') {
    results.naver = await scanNaver(context, args, range);
    reservations.push(...results.naver.reservations);
  }
  if (args.platform === 'spacecloud' || args.platform === 'both') {
    results.spacecloud = await scanSpacecloud(context, args, range);
    reservations.push(...results.spacecloud.reservations);
  }

  const snapshot = {
    version: 1,
    mode: 'email-free-detection-test',
    startedAt,
    finishedAt: new Date().toISOString(),
    range: { from: range.fromText, to: range.toText },
    profileDir: args.profileDir,
    workDir: args.workDir,
    results,
    reservations: uniqueReservations(reservations),
  };
  const saved = await saveSnapshot(args, snapshot);
  return { ...snapshot, saved };
}

async function runLogin(context, args) {
  const page = await pageForContext(context);
  if (args.platform === 'naver') {
    await page.goto(naverCalendarUrl(args), { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (args.platform === 'spacecloud') {
    await page.goto(spacecloudCalendarUrl('b'), { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    await page.goto(naverCalendarUrl(args), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.context().newPage().then((spacecloudPage) => spacecloudPage.goto(spacecloudCalendarUrl('b'), { waitUntil: 'domcontentloaded', timeout: 30000 }));
  }
  const result = {
    platform: args.platform,
    profileDir: args.profileDir,
    message: 'Login browser opened. Log in manually, then run scan.',
    urls: context.pages().map((p) => p.url()),
  };
  if (args.keepOpen) {
    console.log(JSON.stringify(result, null, 2));
    await new Promise(() => {});
  }
  return result;
}

function printHumanSummary(result) {
  console.log(`테스트 감지 완료: ${result.reservations.length}개 후보`);
  console.log(`범위: ${result.range.from} ~ ${result.range.to} (종료일 제외)`);
  if (result.results.naver) {
    console.log(`네이버: ${result.results.naver.loginRequired ? '로그인 필요' : '접속 OK'} / 후보 ${result.results.naver.reservations.length}개 / 네트워크 JSON ${result.results.naver.network.jsonResponseCount}개`);
  }
  if (result.results.spacecloud) {
    console.log(`스페이스클라우드: ${result.results.spacecloud.loginRequired ? '로그인 필요' : '접속 OK'} / 후보 ${result.results.spacecloud.reservations.length}개`);
    for (const room of result.results.spacecloud.rooms || []) {
      console.log(`  - ${room.roomKey}/${room.roomName}: ${room.loginRequired ? '로그인 필요' : 'OK'} / 후보 ${room.reservations.length}개 / 네트워크 JSON ${room.network.jsonResponseCount}개`);
    }
  }
  console.log(`변경감지: +${result.saved.diff.counts.added} / -${result.saved.diff.counts.removed} / 변경 ${result.saved.diff.counts.changed}`);
  console.log(`저장: ${result.saved.snapshotPath}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}\nexpected: ${expectedJson}\nactual:   ${actualJson}`);
  }
}

function runSelfTest() {
  assertDeepEqual(
    parseTimeRangeText('오후 1:00 ~ 오후 2:00'),
    { startTime: '13:00', endTime: '14:00' },
    'Korean PM range',
  );
  assertDeepEqual(
    parseTimeRangeText('2026-07-14'),
    { startTime: '', endTime: '' },
    'Date fragment should not become time range',
  );
  assertDeepEqual(
    parseTimeRangeText('23:00-23:59'),
    { startTime: '23:00', endTime: '24:00' },
    '23:59 end should normalize to 24:00',
  );
  assertDeepEqual(
    parseSingleTimeText('2026-07-14T19:00:00+09:00'),
    '19:00',
    'ISO start time',
  );
  assertDeepEqual(
    parseReservationTiming({
      startDateTime: '2026-07-14T23:00:00+09:00',
      endDateTime: '2026-07-14T23:59:00+09:00',
    }, ''),
    {
      date: '2026-07-14',
      startTime: '23:00',
      endTime: '24:00',
      timingKeys: {
        start: ['startDateTime'],
        end: ['endDateTime'],
        date: [],
      },
    },
    'Separate ISO start/end fields',
  );
  console.log('self-test ok');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    console.log(usage());
    return;
  }
  if (args.command === 'self-test') {
    runSelfTest();
    return;
  }
  if (!['login', 'scan', 'watch'].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
  }

  const context = await openContext(args);
  try {
    if (args.command === 'login') {
      const result = await runLogin(context, args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else console.log(result.message);
      return;
    }

    const cycles = args.command === 'watch' ? args.cycles : 1;
    let index = 0;
    do {
      index += 1;
      const result = await runScan(context, args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else printHumanSummary(result);
      if (args.command !== 'watch') break;
      if (cycles > 0 && index >= cycles) break;
      await sleep(args.intervalSeconds * 1000);
    } while (true);
  } finally {
    if (!args.keepOpen) await context.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[reservation-detect-test] ${error?.stack || error}`);
  process.exit(1);
});
