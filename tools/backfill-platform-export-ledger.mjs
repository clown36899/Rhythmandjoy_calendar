#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DEFAULT_WORK_DIR = 'state/platform-export-ledger-backfill';
const DEFAULT_EXPORT_FILE = 'state/revenue-reconcile/export-normalized.json';
const DEFAULT_SPACECLOUD_API_FILE = 'state/revenue-reconcile/spacecloud-settlements-api-2025-2026.json';
const DEFAULT_SSH_KEY = path.join(process.env.HOME || '', '.ssh/swingenjoy_cafe24_ed25519');
const DEFAULT_CAFE24_HOST = 'root@1.234.23.64';
const DEFAULT_ENV_FILE = '/home/clown313python/myapp/.env';
const DEFAULT_PYTHON = '/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8';

const CALENDAR_BY_ROOM = {
  a: 'Ahall',
  b: 'Bhall',
  c: 'Chall',
  d: 'Dhall',
  e: 'Ehall',
};

const PRODUCT_BY_ROOM = {
  a: 'A홀 20평형-외부신발금지',
  b: 'B홀 16평형-외부신발금지',
  c: 'C홀 5평형-외부신발금지',
  d: 'D홀 4평형-외부신발금지',
  e: 'E홀 15평형-외부신발금지',
};

function usage() {
  return `Usage:
  node tools/backfill-platform-export-ledger.mjs run [options]

Imports exact Naver export rows and SpaceCloud settlement rows into
rhythmjoy_booking_ledger. This is a DB ledger backfill only; it does not change
Naver or SpaceCloud bookings.

Options:
  --from <yyyy-mm-dd>              Defaults to 2025-01-01.
  --to <yyyy-mm-dd>                Defaults to 2027-01-01, exclusive.
  --export-file <path>             Defaults to ${DEFAULT_EXPORT_FILE}
  --spacecloud-api-file <path>     Defaults to ${DEFAULT_SPACECLOUD_API_FILE}
  --work-dir <path>                Defaults to ${DEFAULT_WORK_DIR}
  --apply                          Write to DB. Without this, dry-run only.
  --json                           Print JSON report.
`;
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'help',
    from: '2025-01-01',
    to: '2027-01-01',
    exportFile: DEFAULT_EXPORT_FILE,
    spacecloudApiFile: DEFAULT_SPACECLOUD_API_FILE,
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
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;
    if (key === 'from' || key === 'to') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${arg} must be YYYY-MM-DD`);
      args[key] = value;
    } else if (key === 'export-file') {
      args.exportFile = value;
    } else if (key === 'spacecloud-api-file') {
      args.spacecloudApiFile = value;
    } else if (key === 'work-dir') {
      args.workDir = value;
    } else if (key === 'ssh-key') {
      args.sshKey = value;
    } else if (key === 'cafe24-host') {
      args.cafe24Host = value;
    } else if (key === 'env-file') {
      args.envFile = value;
    } else if (key === 'python-bin') {
      args.pythonBin = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['run', 'help'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
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
  const result = spawnSync('ssh', ['-i', args.sshKey, args.cafe24Host, remote], {
    input: code,
    encoding: 'utf8',
    maxBuffer: 160 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`remote python failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function compact(value) {
  return String(value || '').replace(/\s+/gu, '').trim();
}

function normalizeNameKey(value) {
  return compact(value).replace(/님+$/u, '').toLowerCase();
}

function roomKey(value) {
  const match = String(value || '').toLowerCase().match(/[a-e]/);
  return match ? match[0] : '';
}

function targetCalendar(room) {
  return CALENDAR_BY_ROOM[room] || '';
}

function productName(room, fallback = '') {
  return fallback || PRODUCT_BY_ROOM[room] || `${String(room || '').toUpperCase()}홀`;
}

function shortTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):?(\d{2})?/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2] || '00'}`;
}

function dbTime(value) {
  const time = shortTime(value);
  if (time === '24:00') return '00:00:00';
  return `${time}:00`;
}

function slotKey(event) {
  return [event.reservationDate, event.roomKey, shortTime(event.startTime), shortTime(event.endTime)].join('|');
}

function slotNameKey(event) {
  return [slotKey(event), event.reserverNameKey || ''].join('|');
}

function priceText(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `${amount.toLocaleString('ko-KR')}원` : '';
}

function amountNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  const digits = String(value).replace(/\D+/g, '');
  return digits ? Number(digits) : 0;
}

function derivedFee(gross, net) {
  return gross > 0 && net > 0 && gross >= net ? gross - net : 0;
}

function ledgerKey(platform, event) {
  let rawKey = '';
  if (platform !== 'spacecloud' && event.reservationNumber) {
    rawKey = `${platform}|reservation|${event.reservationNumber}`;
  } else if (platform === 'spacecloud' && event.reserverNameKey) {
    rawKey = [
      platform,
      event.targetCalendar || '',
      event.reservationDate || '',
      shortTime(event.startTime),
      shortTime(event.endTime),
      event.reserverNameKey || '',
    ].join('|');
  } else if (event.reservationNumber) {
    rawKey = `${platform}|visible|reservation|${event.reservationNumber}`;
  } else {
    rawKey = [
      platform,
      event.targetCalendar || '',
      event.reservationDate || '',
      shortTime(event.startTime),
      shortTime(event.endTime),
      event.reserverNameKey || '',
    ].join('|');
  }
  return `${platform}|${createHash('sha256').update(rawKey).digest('hex')}`;
}

function dateInRange(date, from, to) {
  return date >= from && date < to;
}

function parseKoreanDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/(\d{4})-(\d{2})-(\d{2}).*?(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/u);
  if (!match) {
    const iso = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!iso) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]} ${String(Number(iso[4])).padStart(2, '0')}:${iso[5]}:${iso[6] || '00'}`;
  }
  let hour = Number(match[5]);
  if (match[4] === '오전') {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${match[1]}-${match[2]}-${match[3]} ${String(hour).padStart(2, '0')}:${match[6]}:${match[7] || '00'}`;
}

function mysqlDateTimeFromIso(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  return match ? `${match[1]} ${match[2]}:${match[3]}:${match[4]}` : null;
}

function dateFromIso(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : '';
}

function timeFromIso(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  return match ? `${match[2]}:${match[3]}` : '';
}

function naverStatus(row) {
  const status = String(row.status || '').trim();
  const cancelAt = String(row.cancel_at || '').trim();
  const cancelReason = String(row.cancel_reason || '').trim();
  if (cancelAt || cancelReason || /취소|환불/.test(status)) return 'canceled';
  if (/확정|완료/.test(status)) return 'confirmed';
  return row.active ? 'confirmed' : 'canceled';
}

function spacecloudStatus(row, exportRow = null) {
  if (exportRow && Number(exportRow.net || 0) > 0) return 'confirmed';
  const status = row.reservation?.RSV_STAT_CD || '';
  if (status === 'RCCMP' || status === 'RFND' || status === 'CANCEL') return 'canceled';
  return Number(row.cancelled_amount || row.cancel_amount || 0) > 0 && Number(row.SETL_OBJ_AMT || 0) <= Number(row.cancelled_amount || 0)
    ? 'canceled'
    : 'confirmed';
}

function buildNaverEvent(row) {
  const room = roomKey(row.room);
  const currentStatus = naverStatus(row);
  const grossAmount = amountNumber(row.gross || row.payment || row.net);
  const netAmount = amountNumber(row.net);
  const feeAmount = derivedFee(grossAmount, netAmount);
  const eventAt = currentStatus === 'canceled'
    ? parseKoreanDateTime(row.cancel_at) || parseKoreanDateTime(row.confirm_at) || parseKoreanDateTime(row.apply_at)
    : parseKoreanDateTime(row.confirm_at) || parseKoreanDateTime(row.apply_at);
  const event = {
    platform: 'naver',
    sourceMode: 'platform-export',
    currentStatus,
    targetCalendar: targetCalendar(room),
    roomKey: room,
    reservationNumber: String(row.reservation_number || '').trim(),
    reserverName: String(row.name || '').trim(),
    reserverNameKey: normalizeNameKey(row.name_key || row.name),
    product: productName(room, row.product || ''),
    reservationDate: row.date,
    startTime: shortTime(row.start),
    endTime: shortTime(row.end),
    paymentStatus: currentStatus === 'canceled' ? (row.cancel_reason || '예약취소') : (row.status || '예약확정'),
    price: priceText(grossAmount || netAmount),
    grossAmount,
    feeAmount,
    netAmount,
    amountSource: 'naver-platform-export',
    paymentMethod: String(row.payment_method || row.pay_method || '').trim(),
    eventAt,
    payload: {
      source: 'naver-export',
      row,
      observed_at: new Date().toISOString(),
    },
  };
  event.ledgerKey = ledgerKey(event.platform, event);
  return event;
}

function buildSpacecloudEvent(row, exportRow = null) {
  const reservation = row.reservation || {};
  const payment = row.payment || {};
  const room = roomKey(reservation.product_name || '');
  const start = reservation.RSV_STRT_DATETIME || '';
  const end = reservation.RSV_END_DATETIME || '';
  const currentStatus = spacecloudStatus(row, exportRow);
  const grossAmount = amountNumber(reservation.TOT_PAY_PRC || payment.PAY_AMT || exportRow?.gross || exportRow?.payment || row.TOT_PAY_PRC);
  const netAmount = amountNumber(exportRow?.net || row.SETL_OBJ_AMT || row.PG_SETL_AMT);
  const feeAmount = derivedFee(grossAmount, netAmount);
  const eventAt = mysqlDateTimeFromIso(
    reservation.RSV_STAT_CHG_YMDT || payment.APRV_YMDT || reservation.created_at || payment.created_at,
  );
  const event = {
    platform: 'spacecloud',
    sourceMode: 'spacecloud-settlement-api',
    currentStatus,
    targetCalendar: targetCalendar(room),
    roomKey: room,
    reservationNumber: String(reservation.RSV_SEQ || payment.RSV_SEQ || '').trim(),
    reserverName: String(reservation.user_info?.MBR_NM || '').trim(),
    reserverNameKey: normalizeNameKey(reservation.user_info?.MBR_NM || ''),
    product: productName(room, reservation.product_name || ''),
    reservationDate: dateFromIso(start),
    startTime: timeFromIso(start),
    endTime: timeFromIso(end) === '00:00' && dateFromIso(start) === dateFromIso(end) ? '24:00' : timeFromIso(end),
    paymentStatus: currentStatus === 'canceled' ? '예약취소' : '정산완료',
    price: priceText(grossAmount || netAmount),
    grossAmount,
    feeAmount,
    netAmount,
    amountSource: 'spacecloud-settlement-api',
    paymentMethod: String(payment.PAY_MEANS_NM || row.PG || '').trim(),
    eventAt,
    payload: {
      source: 'spacecloud-settlement-api',
      export_row: exportRow,
      settlement: row,
      observed_at: new Date().toISOString(),
    },
  };
  event.ledgerKey = ledgerKey(event.platform, event);
  return event;
}

async function loadEvents(args) {
  const raw = JSON.parse(await fs.readFile(args.exportFile, 'utf8'));
  const scRaw = JSON.parse(await fs.readFile(args.spacecloudApiFile, 'utf8'));
  const spacecloudExportByNo = new Map(
    (raw.spacecloud || []).map((row) => [String(row.reservation_number || '').trim(), row]),
  );

  const naverEvents = (raw.naver || [])
    .filter((row) => dateInRange(row.date || '', args.from, args.to))
    .map(buildNaverEvent)
    .filter((event) => event.roomKey && event.reservationDate && event.startTime && event.endTime);

  const spacecloudEvents = (scRaw.settlements || [])
    .map((row) => {
      const reservationNo = String(row.reservation?.RSV_SEQ || row.payment?.RSV_SEQ || '').trim();
      return buildSpacecloudEvent(row, spacecloudExportByNo.get(reservationNo) || null);
    })
    .filter((event) => dateInRange(event.reservationDate || '', args.from, args.to))
    .filter((event) => event.roomKey && event.reservationDate && event.startTime && event.endTime);

  return [...naverEvents, ...spacecloudEvents].sort((a, b) => (
    a.reservationDate.localeCompare(b.reservationDate)
    || a.startTime.localeCompare(b.startTime)
    || a.roomKey.localeCompare(b.roomKey)
    || a.platform.localeCompare(b.platform)
    || a.reservationNumber.localeCompare(b.reservationNumber)
  ));
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
start_date = os.environ['BACKFILL_FROM']
end_date = os.environ['BACKFILL_TO']
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
                gross_amount, fee_amount, net_amount, amount_source, payment_method,
                CAST(confirmed_email_received_at AS CHAR) AS confirmed_email_received_at,
                CAST(canceled_email_received_at AS CHAR) AS canceled_email_received_at,
                CAST(last_event_at AS CHAR) AS last_event_at
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date >= %s AND reservation_date < %s
            ORDER BY reservation_date, start_time, room_key, id
        """, (start_date, end_date))
        print(json.dumps(cur.fetchall(), ensure_ascii=False, default=str))
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, {
    BACKFILL_FROM: args.from,
    BACKFILL_TO: args.to,
  }) || '[]');
}

function indexExisting(rows) {
  const byLedgerKey = new Map();
  const byPlatformReservation = new Map();
  const bySlotName = new Map();
  const bySlot = new Map();
  for (const row of rows) {
    byLedgerKey.set(row.ledger_key, row);
    const no = String(row.reservation_number || '').trim();
    if (no) {
      const key = `${row.source_platform || ''}|${no}`;
      const list = byPlatformReservation.get(key) || [];
      list.push(row);
      byPlatformReservation.set(key, list);
    }
    const eventLike = {
      reservationDate: row.reservation_date,
      roomKey: row.room_key,
      startTime: row.start_time,
      endTime: shortTime(row.end_time) === '00:00' ? '24:00' : row.end_time,
      reserverNameKey: normalizeNameKey(row.reserver_name_key || row.reserver_name),
    };
    const slot = slotKey(eventLike);
    const slotRows = bySlot.get(slot) || [];
    slotRows.push(row);
    bySlot.set(slot, slotRows);
    const slotName = slotNameKey(eventLike);
    const slotNameRows = bySlotName.get(slotName) || [];
    slotNameRows.push(row);
    bySlotName.set(slotName, slotNameRows);
  }
  return { byLedgerKey, byPlatformReservation, bySlotName, bySlot };
}

function compatibleForUpdate(row, event) {
  if (!row) return false;
  if (row.source_platform === event.platform) return true;
  if (row.source_platform === 'google-backfill') return true;
  if (!row.source_platform) return true;
  return false;
}

function chooseExisting(event, indexes, usedExistingIds) {
  const byNo = event.reservationNumber
    ? indexes.byPlatformReservation.get(`${event.platform}|${event.reservationNumber}`) || []
    : [];
  const byNoAvailable = byNo.filter((row) => !usedExistingIds.has(row.id));
  if (byNoAvailable.length === 1) return { row: byNoAvailable[0], match: 'platform-reservation-number' };
  if (byNoAvailable.length > 1) return { conflict: 'duplicate-platform-reservation-number', candidates: byNoAvailable.map((row) => row.id) };

  const byKey = indexes.byLedgerKey.get(event.ledgerKey);
  if (byKey && !usedExistingIds.has(byKey.id)) return { row: byKey, match: 'ledger-key' };

  const exactName = (indexes.bySlotName.get(slotNameKey(event)) || [])
    .filter((row) => compatibleForUpdate(row, event) && !usedExistingIds.has(row.id));
  if (exactName.length === 1) return { row: exactName[0], match: 'slot-name' };
  if (exactName.length > 1) {
    const samePlatform = exactName.filter((row) => row.source_platform === event.platform);
    if (samePlatform.length === 1) return { row: samePlatform[0], match: 'slot-name-platform' };
  }

  const allowLooseSlotFallback = event.platform === 'spacecloud' || !event.reservationNumber;
  if (allowLooseSlotFallback) {
    const exactSlot = (indexes.bySlot.get(slotKey(event)) || [])
      .filter((row) => !usedExistingIds.has(row.id));
    const samePlatformSlot = exactSlot.filter((row) => row.source_platform === event.platform);
    if (samePlatformSlot.length === 1) return { row: samePlatformSlot[0], match: 'slot-platform' };
    const googleSlot = exactSlot.filter((row) => row.source_platform === 'google-backfill');
    if (samePlatformSlot.length === 0 && googleSlot.length === 1) return { row: googleSlot[0], match: 'slot-google-backfill' };
  }

  return { row: null, match: 'new' };
}

function buildAction(existing, event, match) {
  return {
    operation: existing ? 'update' : 'insert',
    match,
    id: existing?.id || null,
    ledgerKey: existing?.ledger_key || event.ledgerKey,
    sourcePlatform: event.platform,
    sourceMode: event.sourceMode,
    currentStatus: event.currentStatus,
    targetCalendar: event.targetCalendar,
    roomKey: event.roomKey,
    reservationNumber: event.reservationNumber,
    reserverName: event.reserverName,
    reserverNameKey: event.reserverNameKey,
    product: event.product,
    reservationDate: event.reservationDate,
    startTime: dbTime(event.startTime),
    endTime: dbTime(event.endTime),
    paymentStatus: event.paymentStatus,
    price: event.price,
    grossAmount: event.grossAmount || 0,
    feeAmount: event.feeAmount || 0,
    netAmount: event.netAmount || 0,
    amountSource: event.amountSource || '',
    paymentMethod: event.paymentMethod || '',
    eventAt: event.eventAt,
    payload: event.payload,
    slotKey: slotKey(event),
    slotNameKey: slotNameKey(event),
  };
}

function buildPlan(existingRows, events) {
  const indexes = indexExisting(existingRows);
  const usedExistingIds = new Set();
  const usedLedgerKeys = new Set();
  const actions = [];
  const skipped = [];

  for (const event of events) {
    if (event.currentStatus === 'canceled' && usedLedgerKeys.has(event.ledgerKey)) {
      skipped.push({
        reason: 'redundant-canceled-ledger-key',
        platform: event.platform,
        reservationNumber: event.reservationNumber,
        date: event.reservationDate,
        roomKey: event.roomKey,
        startTime: event.startTime,
        endTime: event.endTime,
      });
      continue;
    }
    const choice = chooseExisting(event, indexes, usedExistingIds);
    if (choice.conflict) {
      skipped.push({
        reason: choice.conflict,
        platform: event.platform,
        reservationNumber: event.reservationNumber,
        date: event.reservationDate,
        roomKey: event.roomKey,
        startTime: event.startTime,
        endTime: event.endTime,
        candidates: choice.candidates,
      });
      continue;
    }
    const action = buildAction(choice.row, event, choice.match);
    actions.push(action);
    usedLedgerKeys.add(action.ledgerKey);
    if (choice.row) usedExistingIds.add(choice.row.id);
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
        for item in payload['actions']:
            payload_json = json.dumps(item['payload'], ensure_ascii=False, separators=(',', ':'))
            event_at = item.get('eventAt') or None
            if item['operation'] == 'update':
                cur.execute("""
                    UPDATE rhythmjoy_booking_ledger
                    SET
                        ledger_key=IF(confirmed_email_event_id IS NOT NULL, ledger_key, %s),
                        source_platform=IF(confirmed_email_event_id IS NOT NULL, source_platform, %s),
                        source_mode=IF(confirmed_email_event_id IS NOT NULL, source_mode, %s),
                        current_status=IF(confirmed_email_event_id IS NOT NULL, current_status, %s),
                        target_calendar=%s,
                        room_key=%s,
                        reservation_number=%s,
                        reserver_name=%s,
                        reserver_name_key=%s,
                        product=%s,
                        reservation_date=%s,
                        start_time=%s,
                        end_time=%s,
                        payment_status=%s,
                        price=%s,
                        gross_amount=%s,
                        fee_amount=%s,
                        net_amount=%s,
                        amount_source=%s,
                        payment_method=%s,
                        confirmed_email_received_at=CASE
                            WHEN %s='confirmed' THEN COALESCE(%s, confirmed_email_received_at, last_event_at)
                            ELSE confirmed_email_received_at
                        END,
                        canceled_email_received_at=CASE
                            WHEN %s='canceled' THEN COALESCE(%s, canceled_email_received_at, last_event_at)
                            ELSE canceled_email_received_at
                        END,
                        last_event_at=COALESCE(%s, last_event_at, NOW()),
                        payload_json=CASE WHEN %s='confirmed' THEN %s ELSE payload_json END,
                        cancel_payload_json=CASE WHEN %s='canceled' THEN %s ELSE cancel_payload_json END,
                        updated_at=NOW()
                    WHERE id=%s
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
                    int(item['id']),
                ))
                if cur.rowcount:
                    changed.append({'operation': 'update', 'id': item['id'], 'platform': item['sourcePlatform'], 'reservationNumber': item['reservationNumber']})
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
                        source_platform=VALUES(source_platform),
                        source_mode=VALUES(source_mode),
                        current_status=VALUES(current_status),
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
                        price=VALUES(price),
                        gross_amount=COALESCE(VALUES(gross_amount), gross_amount),
                        fee_amount=COALESCE(VALUES(fee_amount), fee_amount),
                        net_amount=COALESCE(VALUES(net_amount), net_amount),
                        amount_source=IF(VALUES(amount_source) <> '', VALUES(amount_source), amount_source),
                        payment_method=IF(VALUES(payment_method) <> '', VALUES(payment_method), payment_method),
                        confirmed_email_received_at=COALESCE(VALUES(confirmed_email_received_at), confirmed_email_received_at),
                        canceled_email_received_at=COALESCE(VALUES(canceled_email_received_at), canceled_email_received_at),
                        last_event_at=COALESCE(VALUES(last_event_at), last_event_at, NOW()),
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
                    changed.append({'operation': 'insert', 'id': cur.lastrowid, 'platform': item['sourcePlatform'], 'reservationNumber': item['reservationNumber']})
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
start_date = os.environ['BACKFILL_FROM']
end_date = os.environ['BACKFILL_TO']
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
            SELECT YEAR(reservation_date) AS y, source_platform, current_status,
                   COUNT(*) AS count,
                   SUM(COALESCE(gross_amount, CAST(REPLACE(REPLACE(REPLACE(COALESCE(price, '0'), ',', ''), '원', ''), '￦', '') AS UNSIGNED))) AS revenue
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date >= %s AND reservation_date < %s
            GROUP BY YEAR(reservation_date), source_platform, current_status
            ORDER BY y, source_platform, current_status
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
            LIMIT 50
        """, (start_date, end_date))
        duplicate_slots = cur.fetchall()
        cur.execute("""
            SELECT source_platform, reservation_number, COUNT(*) AS count,
                   GROUP_CONCAT(id ORDER BY id SEPARATOR ',') AS ids
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date >= %s AND reservation_date < %s
              AND COALESCE(reservation_number, '') <> ''
            GROUP BY source_platform, reservation_number
            HAVING COUNT(*) > 1
            ORDER BY count DESC, source_platform, reservation_number
            LIMIT 50
        """, (start_date, end_date))
        duplicate_numbers = cur.fetchall()
    print(json.dumps({
        'summary': summary,
        'duplicateActiveSlots': duplicate_slots,
        'duplicateReservationNumbers': duplicate_numbers,
    }, ensure_ascii=False, default=str))
finally:
    conn.close()
`;
  return JSON.parse(runRemotePython(args, code, {
    BACKFILL_FROM: args.from,
    BACKFILL_TO: args.to,
  }) || '{}');
}

function summarizeActions(actions) {
  return actions.reduce((acc, action) => {
    const key = `${action.operation}:${action.sourcePlatform}:${action.currentStatus}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function summarizeEvents(events) {
  return events.reduce((acc, event) => {
    const year = event.reservationDate.slice(0, 4);
    const key = `${year}:${event.platform}:${event.currentStatus}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function run(args) {
  await fs.mkdir(args.workDir, { recursive: true });
  const events = await loadEvents(args);
  const beforeRows = fetchLedgerRows(args);
  const { actions, skipped } = buildPlan(beforeRows, events);
  const applyResult = args.apply ? applyActions(args, actions) : { changed: 0, rows: [] };
  const verification = verifyLedger(args);
  const report = {
    generatedAt: new Date().toISOString(),
    applied: args.apply,
    from: args.from,
    to: args.to,
    eventCount: events.length,
    eventSummary: summarizeEvents(events),
    existingRows: beforeRows.length,
    planActions: actions.length,
    planByType: summarizeActions(actions),
    skippedCount: skipped.length,
    skippedByReason: skipped.reduce((acc, row) => {
      acc[row.reason] = (acc[row.reason] || 0) + 1;
      return acc;
    }, {}),
    changed: applyResult.changed,
    verification,
    actions,
    skipped,
  };
  const reportPath = path.join(args.workDir, `platform-export-ledger-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  report.reportPath = reportPath;
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(args.workDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.command === 'help') {
      console.log(usage());
      return;
    }
    const report = await run(args);
    if (args.json) {
      console.log(JSON.stringify({
        applied: report.applied,
        eventCount: report.eventCount,
        eventSummary: report.eventSummary,
        existingRows: report.existingRows,
        planActions: report.planActions,
        planByType: report.planByType,
        skippedCount: report.skippedCount,
        skippedByReason: report.skippedByReason,
        changed: report.changed,
        verification: report.verification,
        reportPath: report.reportPath,
      }, null, 2));
    } else {
      console.log(`events=${report.eventCount} actions=${report.planActions} skipped=${report.skippedCount} changed=${report.changed}`);
      console.log(`report=${report.reportPath}`);
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

main();
