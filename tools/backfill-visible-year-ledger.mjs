#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const DEFAULT_PROFILE_DIR = '/Users/inteyeo/.spacecloud-automation';
const DEFAULT_WORK_DIR = 'state/year-ledger-backfill';
const DEFAULT_NAVER_BUSINESS_ID = '1257912';
const DEFAULT_SSH_KEY = path.join(process.env.HOME || '', '.ssh/swingenjoy_cafe24_ed25519');
const DEFAULT_CAFE24_HOST = 'root@1.234.23.64';
const DEFAULT_ENV_FILE = '/home/clown313python/myapp/.env';
const DEFAULT_PYTHON = '/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const CALENDAR_BY_ROOM = {
  a: 'Ahall',
  b: 'Bhall',
  c: 'Chall',
  d: 'Dhall',
  e: 'Ehall',
};

function usage() {
  return `Usage:
  node tools/backfill-visible-year-ledger.mjs run [options]
  node tools/backfill-visible-year-ledger.mjs self-test

Reads visible Naver SmartPlace and SpaceCloud reservation lists for one year,
compares them with rhythmjoy_booking_ledger, and optionally backfills missing
or stale ledger rows. It does not call hidden booking APIs and does not change
the booking platforms.

Options:
  --profile-dir <path>       Defaults to ${DEFAULT_PROFILE_DIR}
  --work-dir <path>          Defaults to ${DEFAULT_WORK_DIR}
  --year <yyyy>              Defaults to current KST year.
  --naver-business-id <id>   Defaults to ${DEFAULT_NAVER_BUSINESS_ID}
  --spacecloud-pages <n>     Max pages per status. Defaults to 220.
  --settle-ms <n>            Wait after navigation. Defaults to 1100.
  --page-delay-ms <n>        Delay between SpaceCloud pages. Defaults to 350.
  --apply                    Write plan to DB. Without this, dry-run only.
  --headless                 Run browser headless. Defaults to true.
  --headed                   Show browser window.
  --json                     Print JSON report.
`;
}

function parseArgs(argv) {
  const nowYear = kstDate().getUTCFullYear();
  const args = {
    command: argv[2] || 'help',
    profileDir: DEFAULT_PROFILE_DIR,
    workDir: DEFAULT_WORK_DIR,
    year: nowYear,
    naverBusinessId: DEFAULT_NAVER_BUSINESS_ID,
    spacecloudPages: 220,
    settleMs: 1100,
    pageDelayMs: 350,
    apply: false,
    headless: true,
    json: false,
    sshKey: DEFAULT_SSH_KEY,
    cafe24Host: DEFAULT_CAFE24_HOST,
    envFile: DEFAULT_ENV_FILE,
    pythonBin: DEFAULT_PYTHON,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--headless') {
      args.headless = true;
      continue;
    }
    if (arg === '--headed') {
      args.headless = false;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;
    if (['year', 'spacecloud-pages', 'settle-ms', 'page-delay-ms'].includes(key)) {
      const value = Number.parseInt(next, 10);
      if (!Number.isFinite(value) || value < 0) throw new Error(`${arg} must be a non-negative integer`);
      args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    } else if (key === 'profile-dir') {
      args.profileDir = next;
    } else if (key === 'work-dir') {
      args.workDir = next;
    } else if (key === 'naver-business-id') {
      args.naverBusinessId = next;
    } else if (key === 'ssh-key') {
      args.sshKey = next;
    } else if (key === 'cafe24-host') {
      args.cafe24Host = next;
    } else if (key === 'env-file') {
      args.envFile = next;
    } else if (key === 'python-bin') {
      args.pythonBin = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['run', 'self-test', 'help'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  if (args.year < 2000 || args.year > 2100) throw new Error('--year must be a four digit year');
  return args;
}

function kstDate(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function monthWindows(year) {
  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(Date.UTC(year, index, 1));
    const end = new Date(Date.UTC(year, index + 1, 0));
    return [formatDateOnly(start), formatDateOnly(end)];
  });
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeNameKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/님+$/g, '')
    .trim();
}

function roomKey(value) {
  const match = String(value || '').match(/([A-E])\s*홀/i);
  return match ? match[1].toLowerCase() : '';
}

function hourText(value) {
  const hour = Number.parseInt(String(value), 10);
  if (!Number.isFinite(hour)) return '';
  return `${String(hour).padStart(2, '0')}:00`;
}

function dbTime(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}:00`;
}

function shortTime(value) {
  return dbTime(value).slice(0, 5);
}

function priceText(value) {
  return String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
}

function amountNumber(value) {
  return Number(String(value || '').replace(/\D+/g, '') || 0);
}

function statusToCurrent(platform, status) {
  if (platform === 'naver') {
    if (status === '취소') return 'canceled';
    if (['확정', '완료'].includes(status)) return 'confirmed';
    return '';
  }
  if (status === '취소환불') return 'canceled';
  if (['예약확정', '이용완료'].includes(status)) return 'confirmed';
  return '';
}

function naverStatusPayment(status) {
  if (status === '취소') return '취소';
  if (status === '완료') return '이용완료';
  if (status === '확정') return '결제완료';
  return status || '';
}

function spacecloudStatusPayment(status) {
  if (status === '취소환불') return '취소환불';
  if (status === '이용완료') return '이용완료';
  if (status === '예약확정') return '예약완료';
  return status || '';
}

function to24Hour(ampm, hourValue, minuteValue) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (ampm === '오후' && hour !== 12) hour += 12;
  if (ampm === '오전' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function inferNaverEndAmpm(startAmpm, startHourValue, endAmpm, endHourValue) {
  if (endAmpm) return endAmpm;
  const startHour = Number(startHourValue);
  const endHour = Number(endHourValue);
  if (startAmpm === '오전' && endHour === 12 && startHour < 12) return '오후';
  if (startAmpm === '오전' && endHour < startHour) return '오후';
  return startAmpm;
}

function parseNaverUseRange(useRange) {
  const match = String(useRange || '').match(/(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\([^)]*\)\s*(오전|오후)\s*(\d{1,2}):(\d{2})\s*~\s*(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let year = Number(match[1]);
  if (year < 100) year += 2000;
  const date = `${year}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  const startTime = `${to24Hour(match[4], match[5], match[6])}:00`;
  const endAmpm = inferNaverEndAmpm(match[4], match[5], match[7], match[8]);
  const endTime = `${to24Hour(endAmpm, match[8], match[9])}:00`;
  return { date, startTime, endTime };
}

function parseSpacecloudUseRange(useRange) {
  const match = String(useRange || '').match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})\([^)]*\)\s*(\d{1,2})\s*~\s*(\d{1,2})\s*시/);
  if (!match) return null;
  return {
    date: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`,
    startTime: `${hourText(match[4])}:00`,
    endTime: `${hourText(match[5])}:00`,
  };
}

function parseKoreanShortDateTime(value, fallbackYear) {
  const match = String(value || '').match(/(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\([^)]*\)\s*(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!match) return '';
  let year = Number(match[1] || fallbackYear);
  if (year < 100) year += 2000;
  const time = to24Hour(match[4], match[5], match[6]);
  return `${year}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')} ${time}:00`;
}

function slotKey(event) {
  return [event.date, event.roomKey, shortTime(event.startTime), shortTime(event.endTime)].join('|');
}

function ledgerKey(platform, event) {
  let rawKey = '';
  if (platform !== 'spacecloud' && event.reservationNumber) {
    rawKey = `${platform}|reservation|${event.reservationNumber}`;
  } else if (platform === 'spacecloud' && event.nameKey) {
    rawKey = [
      platform,
      event.targetCalendar || '',
      event.date || '',
      shortTime(event.startTime),
      shortTime(event.endTime),
      event.nameKey || '',
    ].join('|');
  } else if (event.reservationNumber) {
    rawKey = `${platform}|visible|reservation|${event.reservationNumber}`;
  } else {
    rawKey = [
      platform,
      event.targetCalendar || '',
      event.date || '',
      shortTime(event.startTime),
      shortTime(event.endTime),
      event.nameKey || '',
    ].join('|');
  }
  return `${platform}|${createHash('sha256').update(rawKey).digest('hex')}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runRemotePython(args, code, env = {}) {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');
  const remote = `${envPrefix ? `${envPrefix} ` : ''}RHYTHMJOY_ENV_FILE=${shellQuote(args.envFile)} ${shellQuote(args.pythonBin)} -`;
  const result = spawnSync(
    'ssh',
    ['-i', args.sshKey, args.cafe24Host, remote],
    { input: code, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`remote python failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
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
  throw new Error('playwright dependency not found. Set NODE_PATH or PLAYWRIGHT_NODE_MODULES.');
}

async function settle(page, args) {
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(args.settleMs);
}

function naverUseDateUrl(args, startDate, endDate) {
  const params = new URLSearchParams({
    dateDropdownType: 'DIRECT',
    startDateTime: startDate,
    endDateTime: endDate,
    dateFilter: 'USEDATE',
    searchValueCode: 'USER_NAME',
  });
  return `https://partner.booking.naver.com/bizes/${args.naverBusinessId}/booking-list-view?${params}`;
}

async function extractNaverVisibleRows(page) {
  return page.evaluate(() => {
    const compactLocal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizePhoneLocal = (value) => String(value || '').replace(/\D+/g, '');
    const priceTextLocal = (value) => String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
    const rows = [];
    for (const anchor of document.querySelectorAll('a[href*="booking-list-view/bookings/"]')) {
      const rect = anchor.getBoundingClientRect();
      if (!rect.height || rect.height < 12) continue;
      const href = anchor.getAttribute('href') || '';
      const reservationNumber = href.match(/bookings\/(\d+)/)?.[1] || '';
      const text = compactLocal(anchor.innerText);
      if (!reservationNumber || !text) continue;
      const status = text.match(/^(확정|취소|완료|신청|노쇼)/)?.[1] || '';
      const phoneRaw = text.match(/010-\d{3,4}-\d{4}/)?.[0] || '';
      const maskedPhone = text.match(/\*{3,}\d{4}/)?.[0] || '';
      const reservationIndex = text.indexOf(reservationNumber);
      const beforeReservationNo = reservationIndex >= 0 ? text.slice(status.length, reservationIndex).trim() : '';
      const name = beforeReservationNo
        .replace(phoneRaw || maskedPhone, '')
        .replace(/\s+/g, ' ')
        .trim();
      const useRange = text.match(/\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}\.\([^)]*\)\s*(오전|오후)\s*\d{1,2}:\d{2}\s*~\s*(오전|오후)?\s*\d{1,2}:\d{2}/)?.[0] || '';
      const room = text.match(/(A홀|B홀|C홀|D홀|E홀)[^ ]*/)?.[0] || '';
      const dateTimes = text.match(/\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}\.\([^)]*\)\s*(오전|오후)\s*\d{1,2}:\d{2}/g) || [];
      rows.push({
        platform: 'naver',
        reservationNumber,
        status,
        name,
        phoneLast4: normalizePhoneLocal(phoneRaw || maskedPhone).slice(-4),
        useRange,
        room,
        appliedAtText: dateTimes[1] || '',
        confirmedAtText: dateTimes[2] || '',
        canceledAtText: dateTimes[3] || '',
        price: priceTextLocal(text),
        sourceHref: href,
        rawText: text,
      });
    }
    return rows;
  });
}

async function scrollNaverList(page, byNo) {
  const byNoThisPage = new Set();
  let stable = 0;
  let lastCount = 0;
  let lastHeight = 0;
  let lastTop = -1;
  for (let step = 0; step < 220; step += 1) {
    for (const row of await extractNaverVisibleRows(page)) {
      const current = byNo.get(row.reservationNumber);
      if (!current || row.rawText.length > current.rawText.length) byNo.set(row.reservationNumber, row);
      byNoThisPage.add(row.reservationNumber);
    }
    const state = await page.evaluate(() => {
      const compactLocal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const candidates = [
        document.querySelector('[class*="booking-list-table-wrap"]'),
        document.scrollingElement,
      ].filter(Boolean);
      const el = candidates.find((item) => item.scrollHeight > item.clientHeight + 20) || document.scrollingElement;
      const expected = Number((compactLocal(document.body.innerText).match(/예약\s*([\d,]+)\s*건/)?.[1] || '0').replace(/,/g, ''));
      return {
        top: el.scrollTop,
        client: el.clientHeight,
        height: el.scrollHeight,
        expected,
      };
    });
    if (state.expected && byNoThisPage.size >= state.expected) break;
    if (byNoThisPage.size === lastCount && state.top === lastTop && state.height === lastHeight) stable += 1;
    else stable = 0;
    if (stable >= 8) break;
    lastCount = byNoThisPage.size;
    lastHeight = state.height;
    lastTop = state.top;
    await page.evaluate((atBottom) => {
      const candidates = [
        document.querySelector('[class*="booking-list-table-wrap"]'),
        document.scrollingElement,
      ].filter(Boolean);
      const el = candidates.find((item) => item.scrollHeight > item.clientHeight + 20) || document.scrollingElement;
      el.scrollTop = atBottom ? el.scrollHeight : el.scrollTop + Math.max(420, el.clientHeight - 120);
    }, state.top + state.client >= state.height - 8);
    await page.waitForTimeout(state.top + state.client >= state.height - 8 ? 900 : 320);
  }
}

async function collectNaverYear(page, args) {
  const byNo = new Map();
  const windows = monthWindows(args.year);
  for (const [startDate, endDate] of windows) {
    await page.goto(naverUseDateUrl(args, startDate, endDate));
    await settle(page, args);
    await scrollNaverList(page, byNo);
  }

  const events = [];
  const skipped = [];
  for (const row of byNo.values()) {
    const parsed = parseNaverUseRange(row.useRange);
    const currentStatus = statusToCurrent('naver', row.status);
    const parsedRoom = roomKey(row.room);
    if (!parsed || !parsedRoom || !currentStatus) {
      skipped.push({ platform: 'naver', reservationNumber: row.reservationNumber, reason: 'parse-or-status', status: row.status, useRange: row.useRange, room: row.room });
      continue;
    }
    if (!parsed.date.startsWith(`${args.year}-`)) continue;
    const eventAt = currentStatus === 'canceled'
      ? parseKoreanShortDateTime(row.canceledAtText, args.year)
      : parseKoreanShortDateTime(row.confirmedAtText || row.appliedAtText, args.year);
    events.push({
      platform: 'naver',
      status: row.status,
      currentStatus,
      reservationNumber: row.reservationNumber,
      reserverName: row.name,
      nameKey: normalizeNameKey(row.name),
      phoneLast4: row.phoneLast4,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      roomKey: parsedRoom,
      targetCalendar: CALENDAR_BY_ROOM[parsedRoom] || '',
      product: row.room || `${parsedRoom.toUpperCase()}홀`,
      paymentStatus: naverStatusPayment(row.status),
      price: row.price,
      grossAmount: amountNumber(row.price),
      feeAmount: 0,
      netAmount: 0,
      amountSource: 'visible-site-year-backfill',
      paymentMethod: '',
      eventAt,
      sourceHref: row.sourceHref,
      sourceMode: 'visible-site-year-backfill',
    });
  }
  return { events, skipped };
}

function spacecloudStatusUrl(statusCode, pageNo) {
  return `https://partner.spacecloud.kr/reservation?RSV_STAT_CD=${encodeURIComponent(statusCode)}&page=${pageNo}`;
}

async function extractSpacecloudVisibleRows(page) {
  return page.evaluate(() => {
    const compactLocal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizePhoneLocal = (value) => String(value || '').replace(/\D+/g, '');
    const priceTextLocal = (value) => String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
    const rows = [];
    for (const anchor of document.querySelectorAll('a[href^="/reservation/"]')) {
      const text = compactLocal(anchor.innerText);
      const href = anchor.getAttribute('href') || '';
      const reservationNumber = href.match(/reservation\/(\d+)/)?.[1] || text.match(/예약번호\s*(\d+)/)?.[1] || '';
      if (!reservationNumber || !text) continue;
      const status = text.match(/^(예약확정|취소환불|이용완료|승인대기|결제대기)/)?.[1] || '';
      const phoneRaw = text.match(/010-\d{3,4}-\d{4}/)?.[0] || '';
      const beforePhone = phoneRaw ? text.slice(0, text.indexOf(phoneRaw)).trim() : '';
      const name = beforePhone.match(/시간\s+(.+)$/)?.[1] || '';
      rows.push({
        platform: 'spacecloud',
        reservationNumber,
        status,
        name,
        phoneLast4: normalizePhoneLocal(phoneRaw).slice(-4),
        useRange: text.match(/20\d{2}\.\d{1,2}\.\d{1,2}\([^)]*\)\s*\d{1,2}\s*~\s*\d{1,2}\s*시/)?.[0] || '',
        room: text.match(/[A-E]홀[^,\s]*/)?.[0] || '',
        price: priceTextLocal(text),
        sourceHref: href,
        rawText: text,
      });
    }
    return rows;
  });
}

async function collectSpacecloudStatus(page, args, statusCode) {
  const rowsByNo = new Map();
  let emptyPages = 0;
  let outOfYearPages = 0;

  for (let pageNo = 1; pageNo <= args.spacecloudPages; pageNo += 1) {
    await page.goto(spacecloudStatusUrl(statusCode, pageNo));
    await settle(page, args);
    const rows = await extractSpacecloudVisibleRows(page);
    if (!rows.length) {
      emptyPages += 1;
      if (emptyPages >= 3) break;
    } else {
      emptyPages = 0;
    }
    let yearRowsOnPage = 0;
    for (const row of rows) {
      const parsed = parseSpacecloudUseRange(row.useRange);
      if (parsed?.date?.startsWith(`${args.year}-`)) yearRowsOnPage += 1;
      const existing = rowsByNo.get(row.reservationNumber);
      if (!existing || row.rawText.length > existing.rawText.length) rowsByNo.set(row.reservationNumber, row);
    }
    if (pageNo > 10 && yearRowsOnPage === 0) outOfYearPages += 1;
    else outOfYearPages = 0;
    if (outOfYearPages >= 30) break;
    await page.waitForTimeout(args.pageDelayMs);
  }
  return Array.from(rowsByNo.values());
}

async function collectSpacecloudYear(page, args) {
  const rows = [
    ...(await collectSpacecloudStatus(page, args, 'RSCMP')),
    ...(await collectSpacecloudStatus(page, args, 'RCCMP')),
  ];
  const events = [];
  const skipped = [];
  const byNo = new Map();
  for (const row of rows) {
    if (byNo.has(row.reservationNumber)) continue;
    byNo.set(row.reservationNumber, row);
    const parsed = parseSpacecloudUseRange(row.useRange);
    const currentStatus = statusToCurrent('spacecloud', row.status);
    const parsedRoom = roomKey(row.room);
    if (!parsed || !parsedRoom || !currentStatus) {
      skipped.push({ platform: 'spacecloud', reservationNumber: row.reservationNumber, reason: 'parse-or-status', status: row.status, useRange: row.useRange, room: row.room });
      continue;
    }
    if (!parsed.date.startsWith(`${args.year}-`)) continue;
    events.push({
      platform: 'spacecloud',
      status: row.status,
      currentStatus,
      reservationNumber: row.reservationNumber,
      reserverName: row.name,
      nameKey: normalizeNameKey(row.name),
      phoneLast4: row.phoneLast4,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      roomKey: parsedRoom,
      targetCalendar: CALENDAR_BY_ROOM[parsedRoom] || '',
      product: row.room || `${parsedRoom.toUpperCase()}홀`,
      paymentStatus: spacecloudStatusPayment(row.status),
      price: row.price,
      grossAmount: amountNumber(row.price),
      feeAmount: 0,
      netAmount: 0,
      amountSource: 'visible-site-year-backfill',
      paymentMethod: '',
      eventAt: '',
      sourceHref: row.sourceHref,
      sourceMode: 'visible-site-year-backfill',
    });
  }
  return { events, skipped };
}

async function collectVisibleEvents(args) {
  const { chromium } = await loadPlaywright();
  const context = await chromium.launchPersistentContext(args.profileDir, {
    channel: 'chrome',
    headless: args.headless,
    viewport: { width: 1440, height: 1000 },
    locale: 'ko-KR',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    const naver = await collectNaverYear(page, args);
    const spacecloud = await collectSpacecloudYear(page, args);
    return {
      events: [...naver.events, ...spacecloud.events],
      skipped: [...naver.skipped, ...spacecloud.skipped],
      counts: {
        naver: naver.events.length,
        spacecloud: spacecloud.events.length,
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function fetchLedgerRows(args) {
  const code = String.raw`
import json
import os
from pathlib import Path
import pymysql

def load_env(path):
    for raw in Path(path).read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
year = int(os.environ['BACKFILL_YEAR'])
conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'],
    port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'],
    password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'],
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                id, ledger_key, source_platform, source_mode, current_status,
                target_calendar, room_key, reservation_number, reserver_name, reserver_name_key,
                product, CAST(reservation_date AS CHAR) AS reservation_date,
                CAST(start_time AS CHAR) AS start_time,
                CAST(end_time AS CHAR) AS end_time,
                payment_status, price,
                CAST(confirmed_email_received_at AS CHAR) AS confirmed_email_received_at,
                CAST(canceled_email_received_at AS CHAR) AS canceled_email_received_at,
                CAST(last_event_at AS CHAR) AS last_event_at
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date BETWEEN %s AND %s
            ORDER BY reservation_date, start_time, room_key, id
        """, (f"{year}-01-01", f"{year}-12-31"))
        rows = cur.fetchall()
    print(json.dumps(rows, ensure_ascii=False, default=str))
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, { BACKFILL_YEAR: String(args.year) }) || '[]');
}

function indexLedgerRows(rows) {
  const byReservation = new Map();
  const bySlot = new Map();
  for (const row of rows) {
    const reservationNo = String(row.reservation_number || '').trim();
    if (reservationNo) {
      const list = byReservation.get(reservationNo) || [];
      list.push(row);
      byReservation.set(reservationNo, list);
    }
    const key = [
      row.reservation_date,
      row.room_key,
      shortTime(row.start_time),
      shortTime(row.end_time),
    ].join('|');
    const slotRows = bySlot.get(key) || [];
    slotRows.push(row);
    bySlot.set(key, slotRows);
  }
  return { byReservation, bySlot };
}

function platformCompatible(existing, event) {
  if (!existing) return false;
  if (existing.source_platform === event.platform) return true;
  if (existing.source_platform === 'google-backfill') return true;
  if (!existing.source_platform) return true;
  return false;
}

function chooseExisting(event, indexes, visibleSlotStats) {
  if (event.reservationNumber) {
    const byNo = indexes.byReservation.get(event.reservationNumber) || [];
    if (byNo.length === 1) return { row: byNo[0], match: 'reservation-number' };
    if (byNo.length > 1) return { conflict: 'duplicate-reservation-number', candidates: byNo.map((row) => row.id) };
  }

  const slotRows = indexes.bySlot.get(slotKey(event)) || [];
  const compatible = slotRows.filter((row) => platformCompatible(row, event));
  if (event.currentStatus === 'canceled') {
    const samePlatform = compatible.filter((row) => row.source_platform === event.platform);
    if (samePlatform.length === 1) return { row: samePlatform[0], match: 'slot-platform-cancel' };
    const stats = visibleSlotStats.get(slotKey(event)) || { confirmed: 0, canceled: 0 };
    const googleBackfill = compatible.filter((row) => row.source_platform === 'google-backfill' && !String(row.reservation_number || '').trim());
    if (googleBackfill.length === 1 && stats.confirmed === 0 && stats.canceled === 1) {
      return { row: googleBackfill[0], match: 'slot-google-cancel-unique' };
    }
    if (samePlatform.length > 1 || googleBackfill.length > 1) {
      return { conflict: 'ambiguous-canceled-slot', candidates: compatible.map((row) => row.id) };
    }
    return { row: null, match: 'new-canceled' };
  }
  if (compatible.length === 1 && compatible[0].current_status !== 'canceled') {
    return { row: compatible[0], match: 'slot-unique' };
  }
  if (compatible.length > 1) return { conflict: 'ambiguous-slot', candidates: compatible.map((row) => row.id) };
  return { row: null, match: 'new' };
}

function buildAction(existing, event, match) {
  const payload = {
    source: 'visible-site-year-backfill',
    platform: event.platform,
    status: event.status,
    reservation_number: event.reservationNumber,
    name: event.reserverName,
    phone_last4: event.phoneLast4,
    product: event.product,
    date: event.date,
    start_time: shortTime(event.startTime),
    end_time: shortTime(event.endTime),
    room_key: event.roomKey,
    target_calendar: event.targetCalendar,
    payment_status: event.paymentStatus,
    price: event.price,
    gross_amount: event.grossAmount || 0,
    fee_amount: event.feeAmount || 0,
    net_amount: event.netAmount || 0,
    amount_source: event.amountSource || '',
    payment_method: event.paymentMethod || '',
    source_href: event.sourceHref,
    observed_at: new Date().toISOString(),
  };
  return {
    operation: existing ? 'update' : 'insert',
    match,
    id: existing?.id || null,
    preserveSourcePlatform: !!existing,
    ledgerKey: existing?.ledger_key || ledgerKey(event.platform, event),
    sourcePlatform: existing?.source_platform || event.platform,
    sourceMode: event.sourceMode,
    currentStatus: event.currentStatus,
    targetCalendar: existing?.target_calendar || event.targetCalendar,
    roomKey: event.roomKey,
    reservationNumber: event.reservationNumber,
    reserverName: event.reserverName,
    reserverNameKey: event.nameKey,
    product: event.product,
    reservationDate: event.date,
    startTime: dbTime(event.startTime),
    endTime: dbTime(event.endTime),
    paymentStatus: event.paymentStatus,
    price: event.price,
    grossAmount: event.grossAmount || 0,
    feeAmount: event.feeAmount || 0,
    netAmount: event.netAmount || 0,
    amountSource: event.amountSource || '',
    paymentMethod: event.paymentMethod || '',
    eventAt: event.eventAt || null,
    payload,
    slotKey: slotKey(event),
  };
}

function buildPlan(existingRows, events) {
  const indexes = indexLedgerRows(existingRows);
  const actions = [];
  const skipped = [];
  const plannedExistingIds = new Set();
  const finalActiveSlots = new Map();
  const visibleSlotStats = new Map();

  for (const event of events) {
    const key = slotKey(event);
    const stats = visibleSlotStats.get(key) || { confirmed: 0, canceled: 0 };
    if (event.currentStatus === 'confirmed') stats.confirmed += 1;
    if (event.currentStatus === 'canceled') stats.canceled += 1;
    visibleSlotStats.set(key, stats);
  }

  for (const row of existingRows) {
    if (row.current_status === 'canceled') continue;
    const key = [
      row.reservation_date,
      row.room_key,
      shortTime(row.start_time),
      shortTime(row.end_time),
    ].join('|');
    finalActiveSlots.set(key, { type: 'existing', id: row.id, reservationNumber: row.reservation_number || '', sourcePlatform: row.source_platform || '' });
  }

  const sorted = [...events].sort((a, b) => {
    const aStatus = a.currentStatus === 'canceled' ? 1 : 0;
    const bStatus = b.currentStatus === 'canceled' ? 1 : 0;
    if (aStatus !== bStatus) return aStatus - bStatus;
    return String(a.reservationNumber).localeCompare(String(b.reservationNumber));
  });

  for (const event of sorted) {
    const existingChoice = chooseExisting(event, indexes, visibleSlotStats);
    if (existingChoice.conflict) {
      skipped.push({
        platform: event.platform,
        reservationNumber: event.reservationNumber,
        status: event.currentStatus,
        date: event.date,
        roomKey: event.roomKey,
        startTime: shortTime(event.startTime),
        endTime: shortTime(event.endTime),
        reason: existingChoice.conflict,
        candidates: existingChoice.candidates,
      });
      continue;
    }
    const existing = existingChoice.row;
    if (existing && plannedExistingIds.has(existing.id)) {
      skipped.push({
        platform: event.platform,
        reservationNumber: event.reservationNumber,
        status: event.currentStatus,
        date: event.date,
        roomKey: event.roomKey,
        startTime: shortTime(event.startTime),
        endTime: shortTime(event.endTime),
        reason: 'existing-row-already-planned',
        existing: { id: existing.id, sourcePlatform: existing.source_platform || '', reservationNumber: existing.reservation_number || '' },
      });
      continue;
    }
    const key = slotKey(event);
    if (event.currentStatus === 'confirmed') {
      const active = finalActiveSlots.get(key);
      if (active && (!existing || active.id !== existing.id)) {
        skipped.push({
          platform: event.platform,
          reservationNumber: event.reservationNumber,
          status: event.currentStatus,
          date: event.date,
          roomKey: event.roomKey,
          startTime: shortTime(event.startTime),
          endTime: shortTime(event.endTime),
          reason: 'active-slot-conflict',
          existing: active,
        });
        continue;
      }
    }
    const action = buildAction(existing, event, existingChoice.match);
    actions.push(action);
    if (existing) plannedExistingIds.add(existing.id);
    if (event.currentStatus === 'confirmed') {
      finalActiveSlots.set(key, {
        type: action.operation,
        id: action.id,
        reservationNumber: action.reservationNumber,
        sourcePlatform: event.platform,
      });
    } else if (existing) {
      const active = finalActiveSlots.get(key);
      if (active?.id === existing.id) finalActiveSlots.delete(key);
    }
  }

  return { actions, skipped };
}

function applyActions(args, actions) {
  const encodedPayload = Buffer.from(JSON.stringify({ actions }), 'utf8').toString('base64');
  const code = `
import base64
import json
import os
from pathlib import Path
import pymysql

PAYLOAD_B64 = ${JSON.stringify(encodedPayload)}

def load_env(path):
    for raw in Path(path).read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
payload = json.loads(base64.b64decode(PAYLOAD_B64).decode('utf-8'))
actions = payload['actions']
conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'],
    port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'],
    password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'],
    charset='utf8mb4',
    autocommit=False,
    cursorclass=pymysql.cursors.DictCursor,
)
changed = []

def ensure_column(cur, table, column, definition):
    cur.execute("SHOW TABLES LIKE %s", (table,))
    if not cur.fetchone():
        return
    cur.execute("SHOW COLUMNS FROM " + table + " LIKE %s", (column,))
    if cur.fetchone():
        return
    cur.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition)

try:
    with conn.cursor() as cur:
        ensure_column(cur, 'rhythmjoy_booking_ledger', 'gross_amount', 'INT UNSIGNED NULL AFTER price')
        ensure_column(cur, 'rhythmjoy_booking_ledger', 'fee_amount', 'INT UNSIGNED NULL AFTER gross_amount')
        ensure_column(cur, 'rhythmjoy_booking_ledger', 'net_amount', 'INT UNSIGNED NULL AFTER fee_amount')
        ensure_column(cur, 'rhythmjoy_booking_ledger', 'amount_source', "VARCHAR(64) NOT NULL DEFAULT '' AFTER net_amount")
        ensure_column(cur, 'rhythmjoy_booking_ledger', 'payment_method', "VARCHAR(64) NOT NULL DEFAULT '' AFTER amount_source")
        for item in actions:
            payload_json = json.dumps(item['payload'], ensure_ascii=False, separators=(',', ':'))
            event_at = item.get('eventAt') or None
            if item['operation'] == 'update':
                cur.execute("""
                    UPDATE rhythmjoy_booking_ledger
                    SET
                        source_mode=%s,
                        current_status=%s,
                        target_calendar=IF(COALESCE(target_calendar, '')='', %s, target_calendar),
                        room_key=%s,
                        reservation_number=IF(%s <> '', %s, reservation_number),
                        reserver_name=IF(COALESCE(reserver_name, '')='' OR COALESCE(source_mode, '') LIKE 'visible-site%%', %s, reserver_name),
                        reserver_name_key=IF(COALESCE(reserver_name_key, '')='' OR COALESCE(source_mode, '') LIKE 'visible-site%%', %s, reserver_name_key),
                        product=IF(%s <> '', %s, product),
                        reservation_date=%s,
                        start_time=%s,
                        end_time=%s,
                        payment_status=IF(%s <> '', %s, payment_status),
                        price=IF(%s <> '', %s, price),
                        gross_amount=COALESCE(%s, gross_amount),
                        fee_amount=COALESCE(%s, fee_amount),
                        net_amount=COALESCE(%s, net_amount),
                        amount_source=IF(%s <> '', %s, amount_source),
                        payment_method=IF(%s <> '', %s, payment_method),
                        confirmed_email_received_at=CASE
                            WHEN %s='confirmed' AND %s IS NOT NULL THEN %s
                            ELSE confirmed_email_received_at
                        END,
                        canceled_email_received_at=CASE
                            WHEN %s='canceled' AND %s IS NOT NULL THEN %s
                            ELSE canceled_email_received_at
                        END,
                        last_event_at=COALESCE(%s, last_event_at, NOW()),
                        payload_json=CASE WHEN %s='confirmed' THEN %s ELSE payload_json END,
                        cancel_payload_json=CASE WHEN %s='canceled' THEN %s ELSE cancel_payload_json END,
                        updated_at=NOW()
                    WHERE id=%s
                """, (
                    item['sourceMode'],
                    item['currentStatus'],
                    item['targetCalendar'],
                    item['roomKey'],
                    item['reservationNumber'],
                    item['reservationNumber'],
                    item['reserverName'],
                    item['reserverNameKey'],
                    item['product'],
                    item['product'],
                    item['reservationDate'],
                    item['startTime'],
                    item['endTime'],
                    item['paymentStatus'],
                    item['paymentStatus'],
                    item['price'],
                    item['price'],
                    item['grossAmount'] or None,
                    item['feeAmount'] or None,
                    item['netAmount'] or None,
                    item['amountSource'],
                    item['amountSource'],
                    item['paymentMethod'],
                    item['paymentMethod'],
                    item['currentStatus'],
                    event_at,
                    event_at,
                    item['currentStatus'],
                    event_at,
                    event_at,
                    event_at,
                    item['currentStatus'],
                    payload_json,
                    item['currentStatus'],
                    payload_json,
                    int(item['id']),
                ))
                if cur.rowcount:
                    changed.append({'operation': 'update', 'id': item['id'], 'reservationNumber': item['reservationNumber'], 'status': item['currentStatus']})
            else:
                cur.execute("""
                    INSERT INTO rhythmjoy_booking_ledger (
                        ledger_key, source_platform, source_mode, current_status,
                        target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                        reservation_date, start_time, end_time,
                        payment_status, price,
                        gross_amount, fee_amount, net_amount, amount_source, payment_method,
                        confirmed_email_received_at, canceled_email_received_at, last_event_at,
                        payload_json, cancel_payload_json, created_at, updated_at
                    )
                    VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s,
                        %s, %s, %s, %s, %s,
                        IF(%s='confirmed', %s, NULL),
                        IF(%s='canceled', %s, NULL),
                        COALESCE(%s, NOW()),
                        IF(%s='confirmed', %s, NULL),
                        IF(%s='canceled', %s, NULL),
                        NOW(), NOW()
                    )
                    ON DUPLICATE KEY UPDATE
                        source_mode=VALUES(source_mode),
                        current_status=VALUES(current_status),
                        room_key=VALUES(room_key),
                        reservation_number=IF(VALUES(reservation_number) <> '', VALUES(reservation_number), reservation_number),
                        product=VALUES(product),
                        reservation_date=VALUES(reservation_date),
                        start_time=VALUES(start_time),
                        end_time=VALUES(end_time),
                        payment_status=VALUES(payment_status),
                        price=IF(VALUES(price) <> '', VALUES(price), price),
                        gross_amount=COALESCE(VALUES(gross_amount), gross_amount),
                        fee_amount=COALESCE(VALUES(fee_amount), fee_amount),
                        net_amount=COALESCE(VALUES(net_amount), net_amount),
                        amount_source=IF(VALUES(amount_source) <> '', VALUES(amount_source), amount_source),
                        payment_method=IF(VALUES(payment_method) <> '', VALUES(payment_method), payment_method),
                        last_event_at=VALUES(last_event_at),
                        payload_json=IF(VALUES(payload_json) IS NOT NULL, VALUES(payload_json), payload_json),
                        cancel_payload_json=IF(VALUES(cancel_payload_json) IS NOT NULL, VALUES(cancel_payload_json), cancel_payload_json),
                        updated_at=NOW()
                """, (
                    item['ledgerKey'],
                    item['sourcePlatform'],
                    item['sourceMode'],
                    item['currentStatus'],
                    item['targetCalendar'],
                    item['roomKey'],
                    item['reservationNumber'],
                    item['reserverName'],
                    item['reserverNameKey'],
                    item['product'],
                    item['reservationDate'],
                    item['startTime'],
                    item['endTime'],
                    item['paymentStatus'],
                    item['price'],
                    item['grossAmount'] or None,
                    item['feeAmount'] or None,
                    item['netAmount'] or None,
                    item['amountSource'],
                    item['paymentMethod'],
                    item['currentStatus'], event_at,
                    item['currentStatus'], event_at,
                    event_at,
                    item['currentStatus'], payload_json,
                    item['currentStatus'], payload_json,
                ))
                if cur.rowcount:
                    changed.append({'operation': 'insert', 'id': cur.lastrowid, 'reservationNumber': item['reservationNumber'], 'status': item['currentStatus']})
    conn.commit()
    print(json.dumps({'changed': len(changed), 'rows': changed}, ensure_ascii=False, default=str))
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code) || '{"changed":0,"rows":[]}');
}

function verifyLedger(args) {
  const code = String.raw`
import json
import os
from pathlib import Path
import pymysql

def load_env(path):
    for raw in Path(path).read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
year = int(os.environ['BACKFILL_YEAR'])
conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'],
    port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'],
    password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'],
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT source_platform, current_status, COUNT(*) AS count,
                   SUM(CASE WHEN COALESCE(price, '') <> '' THEN 1 ELSE 0 END) AS priced
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date BETWEEN %s AND %s
            GROUP BY source_platform, current_status
            ORDER BY source_platform, current_status
        """, (f"{year}-01-01", f"{year}-12-31"))
        summary = cur.fetchall()
        cur.execute("""
            SELECT reservation_date, room_key, start_time, end_time, COUNT(*) AS count,
                   GROUP_CONCAT(CONCAT(id, ':', source_platform, ':', reservation_number) ORDER BY id SEPARATOR ',') AS rows
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date BETWEEN %s AND %s
              AND current_status <> 'canceled'
            GROUP BY reservation_date, room_key, start_time, end_time
            HAVING COUNT(*) > 1
            ORDER BY reservation_date, start_time, room_key
            LIMIT 30
        """, (f"{year}-01-01", f"{year}-12-31"))
        duplicate_slots = cur.fetchall()
        cur.execute("""
            SELECT reservation_number, COUNT(*) AS count,
                   GROUP_CONCAT(id ORDER BY id SEPARATOR ',') AS ids
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date BETWEEN %s AND %s
              AND reservation_number <> ''
            GROUP BY reservation_number
            HAVING COUNT(*) > 1
            ORDER BY count DESC, reservation_number
            LIMIT 30
        """, (f"{year}-01-01", f"{year}-12-31"))
        duplicate_numbers = cur.fetchall()
    print(json.dumps({
        'summary': summary,
        'duplicateActiveSlots': duplicate_slots,
        'duplicateReservationNumbers': duplicate_numbers,
    }, ensure_ascii=False, default=str))
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, { BACKFILL_YEAR: String(args.year) }) || '{}');
}

function summarize(actions) {
  return actions.reduce((acc, action) => {
    const key = `${action.operation}:${action.currentStatus}:${action.sourcePlatform}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function run(args) {
  await fs.mkdir(args.workDir, { recursive: true });
  const beforeRows = fetchLedgerRows(args);
  const visible = await collectVisibleEvents(args);
  const { actions, skipped } = buildPlan(beforeRows, visible.events);
  const applyResult = args.apply ? applyActions(args, actions) : { changed: 0, rows: [] };
  const verification = verifyLedger(args);
  const report = {
    generatedAt: new Date().toISOString(),
    applied: args.apply,
    year: args.year,
    existingRows: beforeRows.length,
    visibleCounts: visible.counts,
    visibleEvents: visible.events.length,
    visibleSkipped: visible.skipped.length,
    planActions: actions.length,
    planByType: summarize(actions),
    skippedByPlanner: skipped.reduce((acc, row) => {
      acc[row.reason] = (acc[row.reason] || 0) + 1;
      return acc;
    }, {}),
    changed: applyResult.changed,
    verification,
    actions,
    skipped: [...visible.skipped, ...skipped],
  };
  const reportPath = path.join(args.workDir, `visible-year-ledger-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  report.reportPath = reportPath;
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(args.workDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
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
    parseNaverUseRange('2026. 6. 18.(목) 오전 10:00~12:00'),
    { date: '2026-06-18', startTime: '10:00:00', endTime: '12:00:00' },
    'Naver implicit noon end range',
  );
  assertDeepEqual(
    parseNaverUseRange('2026. 6. 18.(목) 오전 11:00~1:00'),
    { date: '2026-06-18', startTime: '11:00:00', endTime: '13:00:00' },
    'Naver implicit PM rollover range',
  );
  assertDeepEqual(
    parseNaverUseRange('2026. 6. 18.(목) 오후 11:00~오후 11:59'),
    { date: '2026-06-18', startTime: '23:00:00', endTime: '23:59:00' },
    'Naver explicit PM late range',
  );
  console.log('self-test ok');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'help') {
    console.log(usage());
    return;
  }
  if (args.command === 'self-test') {
    runSelfTest();
    return;
  }
  const report = await run(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`visible ${report.visibleEvents}, actions ${report.planActions}, changed ${report.changed}`);
  console.log(`report ${report.reportPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
