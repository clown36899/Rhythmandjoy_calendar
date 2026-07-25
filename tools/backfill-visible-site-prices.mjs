#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DEFAULT_PROFILE_DIR = '/Users/inteyeo/.spacecloud-automation';
const DEFAULT_WORK_DIR = 'state/price-backfill';
const DEFAULT_NAVER_BUSINESS_ID = '1257912';
const DEFAULT_SSH_KEY = path.join(process.env.HOME || '', '.ssh/swingenjoy_cafe24_ed25519');
const DEFAULT_CAFE24_HOST = 'root@1.234.23.64';
const DEFAULT_ENV_FILE = '/home/clown313python/myapp/.env';
const DEFAULT_PYTHON = '/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function usage() {
  return `Usage:
  node tools/backfill-visible-site-prices.mjs run [options]

Reads Naver SmartPlace and SpaceCloud visible reservation screens, matches missing
DB actual payment amounts, and optionally writes matched amounts back to the ledger.
It does not read email and does not call hidden platform APIs.

Options:
  --profile-dir <path>       Defaults to ${DEFAULT_PROFILE_DIR}
  --work-dir <path>          Defaults to ${DEFAULT_WORK_DIR}
  --days-back <n>            Missing DB window start = KST today - n days. Defaults to 7.
  --naver-business-id <id>   Defaults to ${DEFAULT_NAVER_BUSINESS_ID}
  --spacecloud-pages <n>     Confirmed reservation pages to scan. Defaults to 40.
  --apply                    Write matched prices to DB. Without this, dry-run only.
  --headless                 Run browser headless. Defaults to headed=false? Actually defaults to true.
  --headed                   Show browser window.
  --json                     Print JSON report.
`;
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'help',
    profileDir: DEFAULT_PROFILE_DIR,
    workDir: DEFAULT_WORK_DIR,
    daysBack: 7,
    naverBusinessId: DEFAULT_NAVER_BUSINESS_ID,
    spacecloudPages: 40,
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
    if (['days-back', 'spacecloud-pages'].includes(key)) {
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

  if (!['run', 'help'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  return args;
}

function kstDate(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function priceText(value) {
  return String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
}

function priceAmount(value) {
  return Number(priceText(value).replace(/\D+/g, '') || 0);
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

function parseSpacecloudUseRange(useRange) {
  const match = String(useRange || '').match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})\([^)]*\)\s*(\d{1,2})\s*~\s*(\d{1,2})\s*시/);
  if (!match) return null;
  return {
    date: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`,
    startTime: hourText(match[4]),
    endTime: hourText(match[5]),
  };
}

function siteKey({ date, room, startTime, endTime }) {
  return `${date}|${room}|${startTime}|${endTime}`;
}

function normalizeDbTime(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function dbKey(row) {
  return siteKey({
    date: row.reservation_date,
    room: row.room_key,
    startTime: normalizeDbTime(row.start_time),
    endTime: normalizeDbTime(row.end_time),
  });
}

function runRemotePython(args, code, env = {}) {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');
  const remote = `${envPrefix ? `${envPrefix} ` : ''}RHYTHMJOY_ENV_FILE=${shellQuote(args.envFile)} ${shellQuote(args.pythonBin)} -`;
  const result = spawnSync(
    'ssh',
    ['-i', args.sshKey, args.cafe24Host, remote],
    { input: `${code}`, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`remote python failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function fetchCandidates(args) {
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
                id,
                source_platform,
                source_mode,
                reservation_number,
                room_key,
                reserver_name,
                CAST(reservation_date AS CHAR) AS reservation_date,
                CONCAT(LPAD(HOUR(start_time), 2, '0'), ':', LPAD(MINUTE(start_time), 2, '0')) AS start_time,
                CONCAT(LPAD(HOUR(end_time), 2, '0'), ':', LPAD(MINUTE(end_time), 2, '0')) AS end_time,
                current_status,
                price,
                payment_status
            FROM rhythmjoy_booking_ledger
            WHERE current_status <> 'canceled'
              AND reservation_date >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
              AND COALESCE(gross_amount, 0)=0
            ORDER BY reservation_date, start_time, room_key, id
        """, (int(os.environ.get('BACKFILL_DAYS_BACK', '7')),))
        rows = cur.fetchall()
    print(json.dumps(rows, ensure_ascii=False, default=str))
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, { BACKFILL_DAYS_BACK: Number(args.daysBack) }) || '[]');
}

async function applyUpdates(args, updates) {
  if (!updates.length) return { updated: 0, rows: [] };
  const payload = JSON.stringify(updates);
  const code = String.raw`
import json
import os
import sys
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
updates = json.loads(os.environ['BACKFILL_UPDATES_JSON'])
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
        for item in updates:
            cur.execute("""
                UPDATE rhythmjoy_booking_ledger
                SET
                    price=%s,
                    gross_amount=%s,
                    amount_source=CASE
                        WHEN amount_source IS NULL OR amount_source='' THEN 'visible-site-price'
                        ELSE amount_source
                    END,
                    payment_status=CASE
                        WHEN payment_status IS NULL OR payment_status='' THEN %s
                        ELSE payment_status
                    END,
                    reservation_number=CASE
                        WHEN (reservation_number IS NULL OR reservation_number='') AND %s <> '' THEN %s
                        ELSE reservation_number
                    END,
                    updated_at=NOW()
                WHERE id=%s
                  AND COALESCE(gross_amount, 0)=0
            """, (
                item['price'],
                int(item.get('priceAmount') or 0) or None,
                item.get('paymentStatus') or '',
                item.get('reservationNumber') or '',
                item.get('reservationNumber') or '',
                int(item['id']),
            ))
            if cur.rowcount:
                changed.append(item)
    conn.commit()
    print(json.dumps({'updated': len(changed), 'rows': changed}, ensure_ascii=False, default=str))
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, { BACKFILL_UPDATES_JSON: payload }) || '{"updated":0,"rows":[]}');
}

async function loadPlaywright() {
  const { chromium } = require('playwright');
  return chromium;
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

async function waitPage(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);
}

async function extractNaverRows(page) {
  return page.evaluate(() => {
    const compactLocal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const priceTextLocal = (value) => String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
    const priceAmountLocal = (value) => Number(priceTextLocal(value).replace(/\D+/g, '') || 0);
    const rows = [];
    for (const anchor of document.querySelectorAll('a[href*="booking-list-view/bookings/"]')) {
      const href = anchor.getAttribute('href') || '';
      const bookingNo = href.match(/bookings\/(\d+)/)?.[1] || '';
      const text = compactLocal(anchor.innerText);
      const priceTextValue = priceTextLocal(text);
      if (!bookingNo || !priceTextValue) continue;
      const status = text.match(/^(확정|완료|취소|신청|노쇼)/)?.[1] || '';
      rows.push({
        platform: 'naver',
        reservationNumber: bookingNo,
        status,
        price: priceTextValue,
        priceAmount: priceAmountLocal(text),
        text,
      });
    }
    return rows;
  });
}

async function collectNaverRows(page, args, candidates) {
  const dates = candidates
    .filter((row) => row.reservation_number)
    .map((row) => row.reservation_date)
    .sort();
  if (!dates.length) return [];

  const start = new Date(`${dates[0]}T00:00:00.000Z`);
  const end = new Date(`${dates[dates.length - 1]}T00:00:00.000Z`);
  const byNo = new Map();
  const windows = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 31)) {
    const windowEnd = new Date(Math.min(addDays(cursor, 30).getTime(), end.getTime()));
    windows.push([formatDateOnly(cursor), formatDateOnly(windowEnd)]);
  }

  for (const [startDate, endDate] of windows) {
    await page.goto(naverUseDateUrl(args, startDate, endDate));
    await waitPage(page);

    let lastTop = -1;
    let stable = 0;
    for (let step = 0; step < 80; step += 1) {
      for (const row of await extractNaverRows(page)) {
        const existing = byNo.get(row.reservationNumber);
        if (!existing || row.text.length > existing.text.length) byNo.set(row.reservationNumber, row);
      }
      const state = await page.evaluate(() => {
        const el = document.querySelector('[class*="booking-list-table-wrap"]');
        if (!el) return null;
        return { top: el.scrollTop, client: el.clientHeight, height: el.scrollHeight };
      });
      if (!state) break;
      if (state.top + state.client >= state.height - 8) break;
      if (state.top === lastTop) stable += 1;
      else stable = 0;
      if (stable >= 3) break;
      lastTop = state.top;
      await page.evaluate(() => {
        const el = document.querySelector('[class*="booking-list-table-wrap"]');
        if (el) el.scrollTop += Math.max(320, el.clientHeight - 80);
      });
      await page.waitForTimeout(350);
    }
  }

  return Array.from(byNo.values());
}

function spacecloudStatusUrl(statusCode, pageNo) {
  return `https://partner.spacecloud.kr/reservation?RSV_STAT_CD=${encodeURIComponent(statusCode)}&page=${pageNo}`;
}

async function extractSpacecloudRows(page) {
  return page.evaluate(() => {
    const compactLocal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const priceTextLocal = (value) => String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
    const priceAmountLocal = (value) => Number(priceTextLocal(value).replace(/\D+/g, '') || 0);
    return Array.from(document.querySelectorAll('a[href^="/reservation/"]')).map((anchor) => {
      const text = compactLocal(anchor.innerText);
      const href = anchor.getAttribute('href') || '';
      const reservationNumber = href.match(/reservation\/(\d+)/)?.[1] || text.match(/예약번호\s*(\d+)/)?.[1] || '';
      const status = text.match(/^(예약확정|취소환불|이용완료|승인대기|결제대기)/)?.[1] || '';
      const useRange = text.match(/20\d{2}\.\d{2}\.\d{2}\([^)]*\)\s*\d{1,2}~\d{1,2}\s*시/)?.[0] || '';
      const room = text.match(/[A-E]홀[^,\s]*/)?.[0] || '';
      const price = priceTextLocal(text);
      if (!reservationNumber || !price) return null;
      return {
        platform: 'spacecloud',
        reservationNumber,
        status,
        useRange,
        room,
        roomKey: (room.match(/([A-E])홀/)?.[1] || '').toLowerCase(),
        price,
        priceAmount: priceAmountLocal(text),
        text,
      };
    }).filter(Boolean);
  });
}

async function collectSpacecloudRows(page, args) {
  const byNo = new Map();
  for (let pageNo = 1; pageNo <= args.spacecloudPages; pageNo += 1) {
    await page.goto(spacecloudStatusUrl('RSCMP', pageNo));
    await waitPage(page);
    const rows = await extractSpacecloudRows(page);
    if (!rows.length && pageNo > 2) break;
    for (const row of rows) byNo.set(row.reservationNumber, row);
  }
  return Array.from(byNo.values());
}

function buildUpdates(candidates, naverRows, spacecloudRows) {
  const naverByNo = new Map(naverRows.map((row) => [row.reservationNumber, row]));
  const scByNo = new Map(spacecloudRows.map((row) => [row.reservationNumber, row]));
  const scByKey = new Map();
  for (const row of spacecloudRows) {
    const parsed = parseSpacecloudUseRange(row.useRange);
    if (!parsed || !row.roomKey) continue;
    const key = siteKey({ ...parsed, room: row.roomKey });
    const list = scByKey.get(key) || [];
    list.push(row);
    scByKey.set(key, list);
  }

  const matched = [];
  const skipped = [];

  for (const candidate of candidates) {
    const reservationNo = String(candidate.reservation_number || '').trim();
    const sourcePlatform = String(candidate.source_platform || '').toLowerCase();
    const sourceMode = String(candidate.source_mode || '').toLowerCase();
    const isSpacecloud = sourcePlatform === 'spacecloud'
      || sourceMode.includes('spacecloud')
      || (sourceMode === 'visible-site-year-backfill' && /^\d{8}$/.test(reservationNo));

    if (reservationNo && !isSpacecloud) {
      const site = naverByNo.get(reservationNo);
      if (!site) {
        skipped.push({ id: candidate.id, reason: 'naver-not-found', reservationNo });
        continue;
      }
      if (!['확정', '완료'].includes(site.status)) {
        skipped.push({ id: candidate.id, reason: 'naver-status-not-active', reservationNo, status: site.status });
        continue;
      }
      matched.push({
        id: candidate.id,
        platform: 'naver',
        reservationNumber: reservationNo,
        price: site.price,
        priceAmount: site.priceAmount || priceAmount(site.price),
        paymentStatus: '결제완료',
        match: 'reservation-number',
        date: candidate.reservation_date,
        room: candidate.room_key,
        startTime: candidate.start_time,
        endTime: candidate.end_time,
      });
      continue;
    }

    if (reservationNo && isSpacecloud) {
      const site = scByNo.get(reservationNo);
      if (!site) {
        skipped.push({ id: candidate.id, reason: 'spacecloud-reservation-not-found', reservationNo });
        continue;
      }
      if (!['예약확정', '이용완료'].includes(site.status)) {
        skipped.push({ id: candidate.id, reason: 'spacecloud-status-not-active', reservationNo, status: site.status });
        continue;
      }
      matched.push({
        id: candidate.id,
        platform: 'spacecloud',
        reservationNumber: reservationNo,
        price: site.price,
        priceAmount: site.priceAmount || priceAmount(site.price),
        paymentStatus: site.status === '이용완료' ? '이용완료' : '예약완료',
        match: 'reservation-number',
        date: candidate.reservation_date,
        room: candidate.room_key,
        startTime: candidate.start_time,
        endTime: candidate.end_time,
      });
      continue;
    }

    const key = dbKey(candidate);
    const scMatches = (scByKey.get(key) || []).filter((row) => ['예약확정', '이용완료'].includes(row.status));
    if (scMatches.length !== 1) {
      skipped.push({
        id: candidate.id,
        reason: scMatches.length ? 'spacecloud-ambiguous' : 'spacecloud-not-found',
        key,
        matches: scMatches.map((row) => row.reservationNumber),
      });
      continue;
    }
    const site = scMatches[0];
    matched.push({
      id: candidate.id,
      platform: 'spacecloud',
      reservationNumber: site.reservationNumber,
      price: site.price,
      priceAmount: site.priceAmount || priceAmount(site.price),
      paymentStatus: site.status === '이용완료' ? '이용완료' : '예약완료',
      match: 'date-room-time',
      date: candidate.reservation_date,
      room: candidate.room_key,
      startTime: candidate.start_time,
      endTime: candidate.end_time,
    });
  }

  return { matched, skipped };
}

async function run(args) {
  await fs.mkdir(args.workDir, { recursive: true });
  const candidates = await fetchCandidates(args);
  const chromium = await loadPlaywright();
  const context = await chromium.launchPersistentContext(args.profileDir, {
    channel: 'chrome',
    headless: args.headless,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  let naverRows = [];
  let spacecloudRows = [];
  try {
    naverRows = await collectNaverRows(page, args, candidates);
    spacecloudRows = await collectSpacecloudRows(page, args);
  } finally {
    await context.close().catch(() => {});
  }

  const { matched, skipped } = buildUpdates(candidates, naverRows, spacecloudRows);
  const applyResult = args.apply ? await applyUpdates(args, matched) : { updated: 0, rows: [] };
  const report = {
    generatedAt: new Date().toISOString(),
    applied: args.apply,
    candidates: candidates.length,
    naverRows: naverRows.length,
    spacecloudRows: spacecloudRows.length,
    matchedCount: matched.length,
    skippedCount: skipped.length,
    updated: applyResult.updated,
    skippedByReason: skipped.reduce((acc, row) => {
      acc[row.reason] = (acc[row.reason] || 0) + 1;
      return acc;
    }, {}),
    matchedByPlatform: matched.reduce((acc, row) => {
      acc[row.platform] = (acc[row.platform] || 0) + 1;
      return acc;
    }, {}),
    matched,
    skipped,
  };
  const reportPath = path.join(args.workDir, `visible-price-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  report.reportPath = reportPath;
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(args.workDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'help') {
    console.log(usage());
    return;
  }
  const report = await run(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`candidates ${report.candidates}, matched ${report.matchedCount}, updated ${report.updated}, skipped ${report.skippedCount}`);
  console.log(`report ${report.reportPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
