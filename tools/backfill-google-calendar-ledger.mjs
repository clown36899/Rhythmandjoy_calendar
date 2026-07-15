#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const policy = require('../www/calendar_set/calendar_v10/revenue-policy.js');

const DEFAULT_WORK_DIR = 'state/google-ledger-backfill';
const DEFAULT_SSH_KEY = path.join(process.env.HOME || '', '.ssh/swingenjoy_cafe24_ed25519');
const DEFAULT_CAFE24_HOST = 'root@1.234.23.64';
const DEFAULT_ENV_FILE = '/home/clown313python/myapp/.env';
const DEFAULT_PYTHON = '/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const TARGET_CALENDAR_BY_ROOM = {
  a: 'Ahall',
  b: 'Bhall',
  c: 'Chall',
  d: 'Dhall',
  e: 'Ehall',
};

function usage() {
  return `Usage:
  node tools/backfill-google-calendar-ledger.mjs run [options]

Reads Rhythmjoy Google Calendar events for a year and inserts only missing
ledger rows as google-backfill. Existing DB rows for the same or overlapping
slot are preserved.

Options:
  --year <yyyy>          Defaults to current KST year.
  --from <yyyy-mm-dd>    Optional start date, inclusive.
  --to <yyyy-mm-dd>      Optional end date, exclusive.
  --work-dir <path>      Defaults to ${DEFAULT_WORK_DIR}
  --apply                Write inserts to DB. Without this, dry-run only.
  --json                 Print JSON report.
  --ssh-key <path>       Defaults to ${DEFAULT_SSH_KEY}
  --cafe24-host <host>   Defaults to ${DEFAULT_CAFE24_HOST}
  --env-file <path>      Defaults to ${DEFAULT_ENV_FILE}
  --python-bin <path>    Defaults to ${DEFAULT_PYTHON}
`;
}

function parseArgs(argv) {
  const now = new Date(Date.now() + KST_OFFSET_MS);
  const args = {
    command: argv[2] || 'help',
    year: now.getUTCFullYear(),
    from: '',
    to: '',
    workDir: DEFAULT_WORK_DIR,
    apply: false,
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
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;
    if (key === 'year') {
      args.year = Number.parseInt(next, 10);
    } else if (key === 'work-dir') {
      args.workDir = next;
    } else if (key === 'ssh-key') {
      args.sshKey = next;
    } else if (key === 'cafe24-host') {
      args.cafe24Host = next;
    } else if (key === 'env-file') {
      args.envFile = next;
    } else if (key === 'python-bin') {
      args.pythonBin = next;
    } else if (key === 'from' || key === 'to') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new Error(`${arg} must be YYYY-MM-DD`);
      args[key] = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['run', 'help'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  if (args.year < 2000 || args.year > 2100) throw new Error('--year must be a four digit year');
  return args;
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
    { input: code, encoding: 'utf8', maxBuffer: 120 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`remote python failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
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

function minutesSinceKstDayStart(date) {
  const p = kstDateParts(date);
  return p.hour * 60 + p.minute;
}

function parseDateOnlyKst(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
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

function normalizeTimeRange(event) {
  const start = new Date(event.start);
  const end = new Date(event.end || event.start);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, reason: 'invalid-date' };
  }

  const startMinute = minutesSinceKstDayStart(start);
  let endMinute = minutesSinceKstDayStart(end);
  const endDayDistance = dayDistance(start, end);
  const rawStartTime = formatHourMinute(start);
  const rawEndTime = formatHourMinute(end);
  const notes = [];

  if (endDayDistance === 1 && endMinute === 0) {
    endMinute = 24 * 60;
  } else if (endDayDistance === 0 && endMinute === 23 * 60 + 59) {
    endMinute = 24 * 60;
    notes.push('normalized-end-23:59-to-24:00');
  } else if (endDayDistance !== 0) {
    return { ok: false, reason: `unsupported-cross-day:${rawStartTime}-${rawEndTime}` };
  }

  if (startMinute % 60 !== 0) {
    return { ok: false, reason: `start-not-hour:${rawStartTime}` };
  }
  if (endMinute % 60 !== 0) {
    return { ok: false, reason: `end-not-hour:${rawEndTime}` };
  }
  if (endMinute <= startMinute) {
    return { ok: false, reason: `invalid-range:${rawStartTime}-${rawEndTime}` };
  }

  return {
    ok: true,
    date: formatDateKey(start),
    startTime: formatSlotTime(startMinute),
    endTime: formatSlotTime(endMinute),
    notes,
  };
}

function shortTime(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function dbTime(value) {
  const time = shortTime(value);
  if (time === '24:00') return '00:00:00';
  return `${time}:00`;
}

function slotKey(item) {
  return [item.date, item.roomKey, shortTime(item.startTime), shortTime(item.endTime)].join('|');
}

function normalizeNameKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/님+$/g, '')
    .trim();
}

function fieldFromDescription(description, label) {
  const pattern = new RegExp(`${label}\\s*:\\s*([^\\n\\r]+)`);
  return String(description || '').match(pattern)?.[1]?.trim() || '';
}

function priceText(value) {
  return String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
}

function fallbackName(event) {
  const title = String(event.title || '').trim();
  if (!title) return '구글수기';
  return title
    .replace(/^[A-E]\s*홀\s*/i, '')
    .replace(/^\([^)]*\)\s*/, '')
    .trim() || title;
}

function productName(roomKey) {
  const room = policy.ROOM_PRICING[roomKey];
  return room ? room.name : `${String(roomKey || '').toUpperCase()}홀`;
}

const HISTORICAL_ROOM_PRICING = {
  2025: {
    a: { before16: 10000, after16: 12000, dawnHourly: 10000, overnight: 30000 },
    b: { before16: 8000, after16: 10000, dawnHourly: 8000, overnight: 20000 },
    c: { before16: 4000, after16: 6000, dawnHourly: 4000, overnight: 15000 },
    d: { before16: 3000, after16: 5000, dawnHourly: 3000, overnight: 15000 },
    e: { before16: 8000, after16: 10000, dawnHourly: 8000, overnight: 20000 },
  },
};

function dateYear(dateKey) {
  return Number.parseInt(String(dateKey || '').slice(0, 4), 10);
}

function getPricingForDate(roomKey, dateKey) {
  const year = dateYear(dateKey);
  const historical = HISTORICAL_ROOM_PRICING[year]?.[roomKey];
  if (historical) {
    return {
      roomPrice: historical,
      source: `${year}-price-table`,
      year,
    };
  }
  return {
    roomPrice: policy.ROOM_PRICING[roomKey],
    source: 'current-price-table',
    year,
  };
}

function kstDate(ms) {
  return new Date(ms + KST_OFFSET_MS);
}

function kstHour(ms) {
  return kstDate(ms).getUTCHours();
}

function kstDay(ms) {
  return kstDate(ms).getUTCDay();
}

function kstDateString(ms) {
  return kstDate(ms).toISOString().slice(0, 10);
}

function isWeekendOrHolidayMs(ms, holidaySet) {
  const day = kstDay(ms);
  return day === 0 || day === 6 || holidaySet.has(kstDateString(ms));
}

function nextKstHourBoundaryMs(ms) {
  const date = kstDate(ms);
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() + 1);
  return date.getTime() - KST_OFFSET_MS;
}

function isExactOvernightMs(startMs, endMs) {
  return (endMs - startMs) / (60 * 60 * 1000) === 6
    && kstHour(startMs) === 0
    && kstHour(endMs) === 6;
}

function calculateBackfillGuidePrice(event, normalized) {
  const roomKey = event.roomKey;
  const { roomPrice, source, year } = getPricingForDate(roomKey, normalized.date);
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end || event.start);
  if (!roomPrice || Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return { ok: false, guideAmount: 0, source };
  }

  const holidaySet = policy.makeHolidaySet([year]);
  if (isExactOvernightMs(startMs, endMs)) {
    return { ok: true, guideAmount: roomPrice.overnight, source };
  }

  let cursor = startMs;
  let guideAmount = 0;
  while (cursor < endMs) {
    const next = Math.min(endMs, nextKstHourBoundaryMs(cursor));
    const hours = (next - cursor) / (60 * 60 * 1000);
    const hour = kstHour(cursor);
    const rate = hour >= 0 && hour < 6
      ? roomPrice.dawnHourly
      : (isWeekendOrHolidayMs(cursor, holidaySet) || hour >= 16 ? roomPrice.after16 : roomPrice.before16);
    guideAmount += rate * hours;
    cursor = next;
  }

  return {
    ok: true,
    guideAmount: Math.round(guideAmount),
    source,
  };
}

function mysqlDateTimeFromIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function ledgerKey(event) {
  const raw = [
    'google-backfill',
    event.googleEventId || '',
    event.targetCalendar || '',
    event.date,
    shortTime(event.startTime),
    shortTime(event.endTime),
    event.nameKey || '',
  ].join('|');
  return `google-backfill|${createHash('sha256').update(raw).digest('hex')}`;
}

function buildGoogleLedgerEvent(rawEvent) {
  const event = policy.normalizeCalendarEvent(rawEvent);
  const roomKey = policy.ROOM_PRICING[event.roomKey] ? event.roomKey : '';
  if (!roomKey) return { skipped: { reason: 'missing-room', title: event.title || '' } };

  const normalized = normalizeTimeRange(event);
  if (!normalized.ok) {
    return {
      skipped: {
        reason: normalized.reason,
        roomKey,
        title: event.title || '',
        start: event.start || '',
        end: event.end || '',
      },
    };
  }

  const description = event.description || '';
  const reserverName = fieldFromDescription(description, '예약자명') || fallbackName(event);
  const reservationNumber = fieldFromDescription(description, '예약번호');
  const describedPrice = fieldFromDescription(description, '결제금액');
  const calculation = calculateBackfillGuidePrice(event, normalized);
  const fallbackPrice = calculation.ok && calculation.guideAmount > 0
    ? `${calculation.guideAmount.toLocaleString('ko-KR')}원`
    : '';
  const price = priceText(describedPrice) || fallbackPrice;
  const paymentStatus = fieldFromDescription(description, '결제상태')
    || (price ? '구글캘린더 계산' : '구글캘린더 수기');
  const googleEventId = event.id || '';
  const updated = rawEvent?.extendedProps?.updated || rawEvent?.updated || '';

  const built = {
    sourcePlatform: 'google-backfill',
    sourceMode: 'google-calendar-backfill',
    currentStatus: 'confirmed',
    targetCalendar: TARGET_CALENDAR_BY_ROOM[roomKey],
    roomKey,
    reservationNumber,
    reserverName,
    reserverNameKey: normalizeNameKey(reserverName),
    product: productName(roomKey),
    date: normalized.date,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    paymentStatus,
    price,
    eventAt: mysqlDateTimeFromIso(updated),
    googleEventId,
    googleTitle: event.title || '',
    description,
    normalizationNotes: normalized.notes,
    priceSource: describedPrice ? 'description' : (fallbackPrice ? calculation.source : 'missing'),
  };
  built.ledgerKey = ledgerKey(built);
  built.slotKey = slotKey(built);
  return { event: built };
}

function fetchLedgerRows(args, startDate, endDate) {
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
start_date = os.environ['BACKFILL_START_DATE']
end_date = os.environ['BACKFILL_END_DATE']
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
                CAST(last_event_at AS CHAR) AS last_event_at
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date >= %s AND reservation_date < %s
            ORDER BY reservation_date, start_time, room_key, id
        """, (start_date, end_date))
        rows = cur.fetchall()
    print(json.dumps(rows, ensure_ascii=False, default=str))
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, {
    BACKFILL_START_DATE: startDate,
    BACKFILL_END_DATE: endDate,
  }) || '[]');
}

function indexLedgerRows(rows) {
  const exactActive = new Map();
  const byReservation = new Map();
  const activeRows = [];
  for (const row of rows) {
    const reservationNo = String(row.reservation_number || '').trim();
    if (reservationNo) {
      const list = byReservation.get(reservationNo) || [];
      list.push(row);
      byReservation.set(reservationNo, list);
    }
    if (row.current_status === 'canceled') continue;
    const start = shortTime(row.start_time);
    const end = shortTime(row.end_time) === '00:00' ? '24:00' : shortTime(row.end_time);
    const key = [row.reservation_date, row.room_key, start, end].join('|');
    const exact = exactActive.get(key) || [];
    exact.push(row);
    exactActive.set(key, exact);
    activeRows.push({
      ...row,
      startMinute: timeToMinute(start),
      endMinute: timeToMinute(end),
    });
  }
  return { exactActive, byReservation, activeRows };
}

function timeToMinute(value) {
  if (value === '24:00') return 24 * 60;
  const [hour, minute] = shortTime(value).split(':').map(Number);
  return hour * 60 + minute;
}

function overlappingActiveRows(indexes, event) {
  const start = timeToMinute(event.startTime);
  const end = timeToMinute(event.endTime);
  return indexes.activeRows.filter((row) => (
    row.reservation_date === event.date
    && row.room_key === event.roomKey
    && row.startMinute < end
    && row.endMinute > start
  ));
}

function buildPlan(existingRows, googleEvents) {
  const indexes = indexLedgerRows(existingRows);
  const actions = [];
  const skipped = [];
  const covered = [];

  for (const event of googleEvents) {
    const existingByNo = event.reservationNumber ? (indexes.byReservation.get(event.reservationNumber) || []) : [];
    if (existingByNo.some((row) => row.current_status !== 'canceled')) {
      covered.push({
        reason: 'reservation-number-covered',
        date: event.date,
        roomKey: event.roomKey,
        startTime: event.startTime,
        endTime: event.endTime,
        reservationNumber: event.reservationNumber,
        existingIds: existingByNo.map((row) => row.id),
      });
      continue;
    }

    const exact = indexes.exactActive.get(event.slotKey) || [];
    if (exact.length > 0) {
      covered.push({
        reason: 'slot-covered',
        date: event.date,
        roomKey: event.roomKey,
        startTime: event.startTime,
        endTime: event.endTime,
        title: event.googleTitle,
        existingIds: exact.map((row) => row.id),
      });
      continue;
    }

    const overlap = overlappingActiveRows(indexes, event);
    if (overlap.length > 0) {
      skipped.push({
        reason: 'active-overlap-conflict',
        date: event.date,
        roomKey: event.roomKey,
        startTime: event.startTime,
        endTime: event.endTime,
        title: event.googleTitle,
        overlap: overlap.map((row) => ({
          id: row.id,
          sourcePlatform: row.source_platform || '',
          reservationNumber: row.reservation_number || '',
          startTime: shortTime(row.start_time),
          endTime: shortTime(row.end_time) === '00:00' ? '24:00' : shortTime(row.end_time),
        })),
      });
      continue;
    }

    actions.push(event);
    indexes.activeRows.push({
      id: null,
      source_platform: event.sourcePlatform,
      reservation_number: event.reservationNumber,
      reservation_date: event.date,
      room_key: event.roomKey,
      start_time: event.startTime,
      end_time: event.endTime,
      startMinute: timeToMinute(event.startTime),
      endMinute: timeToMinute(event.endTime),
    });
    indexes.exactActive.set(event.slotKey, [{ id: null, source_platform: event.sourcePlatform }]);
  }

  return { actions, skipped, covered };
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
try:
    with conn.cursor() as cur:
        for item in actions:
            payload_json = json.dumps({
                'source': 'google-calendar-backfill',
                'google_event_id': item['googleEventId'],
                'google_title': item['googleTitle'],
                'description': item['description'],
                'normalization_notes': item['normalizationNotes'],
                'price_source': item['priceSource'],
            }, ensure_ascii=False, separators=(',', ':'))
            event_at = item.get('eventAt') or None
            cur.execute("""
                INSERT INTO rhythmjoy_booking_ledger (
                    ledger_key, source_platform, source_mode, current_status,
                    target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                    reservation_date, start_time, end_time,
                    payment_status, price,
                    confirmed_email_received_at, canceled_email_received_at, last_event_at,
                    payload_json, cancel_payload_json, created_at, updated_at
                )
                VALUES (
                    %s, 'google-backfill', 'google-calendar-backfill', 'confirmed',
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    COALESCE(%s, NOW()), NULL, COALESCE(%s, NOW()),
                    %s, NULL, NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    current_status='confirmed',
                    target_calendar=VALUES(target_calendar),
                    room_key=VALUES(room_key),
                    reservation_number=VALUES(reservation_number),
                    reserver_name=VALUES(reserver_name),
                    reserver_name_key=VALUES(reserver_name_key),
                    product=VALUES(product),
                    reservation_date=VALUES(reservation_date),
                    start_time=VALUES(start_time),
                    end_time=VALUES(end_time),
                    payment_status=VALUES(payment_status),
                    price=IF(VALUES(price) <> '', VALUES(price), price),
                    confirmed_email_received_at=COALESCE(VALUES(confirmed_email_received_at), confirmed_email_received_at),
                    last_event_at=COALESCE(VALUES(last_event_at), last_event_at, NOW()),
                    payload_json=VALUES(payload_json),
                    updated_at=NOW()
            """, (
                item['ledgerKey'],
                item['targetCalendar'],
                item['roomKey'],
                item['reservationNumber'],
                item['reserverName'],
                item['reserverNameKey'],
                item['product'],
                item['date'],
                item['startTime'],
                item['endTime'] == '24:00' and '00:00:00' or item['endTime'] + ':00',
                item['paymentStatus'],
                item['price'],
                event_at,
                event_at,
                payload_json,
            ))
            if cur.rowcount:
                changed.append({
                    'id': cur.lastrowid,
                    'date': item['date'],
                    'roomKey': item['roomKey'],
                    'startTime': item['startTime'],
                    'endTime': item['endTime'],
                    'name': item['reserverName'],
                    'price': item['price'],
                })
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

function verifyLedger(args, startDate, endDate) {
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
start_date = os.environ['BACKFILL_START_DATE']
end_date = os.environ['BACKFILL_END_DATE']
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
            WHERE reservation_date >= %s AND reservation_date < %s
            GROUP BY source_platform, current_status
            ORDER BY source_platform, current_status
        """, (start_date, end_date))
        summary = cur.fetchall()
        cur.execute("""
            SELECT reservation_date, room_key, start_time, end_time, COUNT(*) AS count,
                   GROUP_CONCAT(CONCAT(id, ':', source_platform, ':', reservation_number) ORDER BY id SEPARATOR ',') AS rows
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date >= %s AND reservation_date < %s
              AND current_status <> 'canceled'
            GROUP BY reservation_date, room_key, start_time, end_time
            HAVING COUNT(*) > 1
            ORDER BY reservation_date, start_time, room_key
            LIMIT 30
        """, (start_date, end_date))
        duplicate_slots = cur.fetchall()
    print(json.dumps({
        'summary': summary,
        'duplicateActiveSlots': duplicate_slots,
    }, ensure_ascii=False, default=str))
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, {
    BACKFILL_START_DATE: startDate,
    BACKFILL_END_DATE: endDate,
  }) || '{}');
}

function summarize(actions) {
  return actions.reduce((acc, action) => {
    const key = `${action.roomKey}:${action.priceSource}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function countReasons(rows) {
  return rows.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1;
    return acc;
  }, {});
}

async function collectGoogleEvents(args, startDate, endDate) {
  const rawEvents = await policy.fetchGoogleCalendarEvents({ year: args.year });
  const events = [];
  const skipped = [];
  for (const raw of rawEvents) {
    const built = buildGoogleLedgerEvent(raw);
    if (built.skipped) {
      skipped.push(built.skipped);
      continue;
    }
    if (built.event.date < startDate || built.event.date >= endDate) continue;
    events.push(built.event);
  }
  events.sort((a, b) => [a.date, a.startTime, a.roomKey, a.googleEventId].join('|').localeCompare([b.date, b.startTime, b.roomKey, b.googleEventId].join('|')));
  return { events, skipped };
}

async function run(args) {
  await fs.mkdir(args.workDir, { recursive: true });
  const startDate = args.from || `${args.year}-01-01`;
  const endDate = args.to || `${args.year + 1}-01-01`;
  const existingRows = fetchLedgerRows(args, startDate, endDate);
  const google = await collectGoogleEvents(args, startDate, endDate);
  const plan = buildPlan(existingRows, google.events);
  const applyResult = args.apply ? applyActions(args, plan.actions) : { changed: 0, rows: [] };
  const verification = verifyLedger(args, startDate, endDate);

  const report = {
    generatedAt: new Date().toISOString(),
    applied: args.apply,
    year: args.year,
    startDate,
    endDate,
    existingRows: existingRows.length,
    googleEvents: google.events.length,
    googleSkippedByParser: countReasons(google.skipped),
    planActions: plan.actions.length,
    planByRoomAndPriceSource: summarize(plan.actions),
    covered: plan.covered.length,
    coveredByReason: countReasons(plan.covered),
    skipped: plan.skipped.length + google.skipped.length,
    skippedByReason: countReasons([...google.skipped, ...plan.skipped]),
    changed: applyResult.changed,
    verification,
    actions: plan.actions,
    coveredRows: plan.covered,
    skippedRows: [...google.skipped, ...plan.skipped],
    changedRows: applyResult.rows,
  };
  const reportPath = path.join(args.workDir, `google-ledger-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
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
  console.log(`google ${report.googleEvents}, actions ${report.planActions}, changed ${report.changed}, covered ${report.covered}, skipped ${report.skipped}`);
  console.log(`report ${report.reportPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
