#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  checkSpacecloudLogin,
  createSpacecloudPlaywrightUploader,
  deleteSpacecloudDirectReservation,
  fetchSpacecloudReservationPhone,
  openSpacecloudContext,
  spacecloudUploadEventFromTask,
  uploadSpacecloudDirectReservation,
} from './spacecloud-playwright-uploader.mjs';
import {
  checkNaverSmartplaceLogin,
  fetchNaverReservationPhone,
  setNaverAvailability,
} from './naver-playwright-availability.mjs';

const DEFAULT_CONFIG_PATH = 'config/spacecloud-sync.local.json';
const DEFAULT_STATE_PATH = 'state/spacecloud-sync-log.json';
const DEFAULT_WORK_DIR = 'state/spacecloud-watch';
const DEFAULT_PROFILE_DIR = '/Users/inteyeo/.spacecloud-automation';
const DEFAULT_ENV_FILE = '/Users/inteyeo/.rhythmjoy-ingestion.env';
const DEFAULT_CAFE24_TARGET_ENV = 'ops/cafe24-production-target.env';
const DEFAULT_NOTIFY_STATE_PATH = path.join(DEFAULT_WORK_DIR, 'notify-state.json');
const DEFAULT_NOTIFY_COOLDOWN_SECONDS = 6 * 60 * 60;
const CONFIRMATION_SMS_TEMPLATE_NAME = 'reservation-confirmed-v1';
const DEFAULT_CONFIRMATION_SMS_MESSAGE = `안녕하세요 리듬앤조이 예약확정
비번/금지사항: https://리듬앤조이일정표.com/r/`;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function usage() {
  return `Usage:
  node tools/spacecloud-watch.mjs login [options]
  node tools/spacecloud-watch.mjs check-login [options]
  node tools/spacecloud-watch.mjs check-naver-login [options]
  node tools/spacecloud-watch.mjs notify-test [options]
  node tools/spacecloud-watch.mjs sms-test --to <phone> [options]
  node tools/spacecloud-watch.mjs once [options]
  node tools/spacecloud-watch.mjs watch [options]

Options:
  --config <path>           Defaults to ${DEFAULT_CONFIG_PATH}.
  --state <path>            Defaults to ${DEFAULT_STATE_PATH}.
  --work-dir <path>         Defaults to ${DEFAULT_WORK_DIR}.
  --profile-dir <path>      Defaults to ${DEFAULT_PROFILE_DIR}.
  --env-file <path>         Defaults to ${DEFAULT_ENV_FILE}.
  --cafe24-target-env <path>
                            Defaults to ${DEFAULT_CAFE24_TARGET_ENV}.
  --notify-state <path>     Defaults to ${DEFAULT_NOTIFY_STATE_PATH}.
  --notify-cooldown-seconds <n>
                            Defaults to ${DEFAULT_NOTIFY_COOLDOWN_SECONDS}.
  --from <YYYY-MM-DD>       Defaults to today in KST.
  --days <n>                Defaults to 370.
  --rooms <keys>            Defaults to a,b,c,d,e.
  --interval-seconds <n>    Defaults to 30 for watch mode.
  --limit-per-cycle <n>     Defaults to 3.
  --delete-limit-per-cycle <n>
                            Defaults to 2.
  --naver-block-limit-per-cycle <n>
                            Defaults to 2.
  --naver-business-id <id>  Defaults to 1257912.
  --legacy-calendar-plan    Also run the older Google Calendar cache upload plan.
  --headless                Run Chrome headless. Not recommended for first login.
  --dry-run                 Do not mutate DB rows, Google Calendar, or platform UI.
  --json                    Print machine-readable output for once/check-login.
  --no-telegram             Disable Telegram notifications.
  --to <phone>              Recipient for sms-test.
  --sms-test-task-id <id>   Optional fixed test id for duplicate-send checks.
  --sms-test-task-type <type>
                            Optional source task type for sms-test records.

Examples:
  node tools/spacecloud-watch.mjs login
  node tools/spacecloud-watch.mjs check-login
  node tools/spacecloud-watch.mjs check-naver-login
  node tools/spacecloud-watch.mjs notify-test
  node tools/spacecloud-watch.mjs sms-test --to 01000000000 --json
  node tools/spacecloud-watch.mjs once --dry-run
  node tools/spacecloud-watch.mjs watch --interval-seconds 30 --limit-per-cycle 3
  node tools/spacecloud-watch.mjs once --legacy-calendar-plan --dry-run
`;
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'help',
    config: DEFAULT_CONFIG_PATH,
    state: DEFAULT_STATE_PATH,
    workDir: DEFAULT_WORK_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    envFile: DEFAULT_ENV_FILE,
    cafe24TargetEnv: DEFAULT_CAFE24_TARGET_ENV,
    notifyState: DEFAULT_NOTIFY_STATE_PATH,
    notifyCooldownSeconds: DEFAULT_NOTIFY_COOLDOWN_SECONDS,
    days: 370,
    rooms: 'a,b,c,d,e',
    intervalSeconds: 30,
    limitPerCycle: 3,
    deleteLimitPerCycle: 2,
    naverBlockLimitPerCycle: 2,
    naverBusinessId: '1257912',
    legacyCalendarPlan: false,
    headless: false,
    dryRun: false,
    json: false,
    telegram: true,
    smsTestTo: '',
    smsTestTaskId: '',
    smsTestTaskType: 'manual_sms_test',
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--headless') {
      args.headless = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--no-telegram') {
      args.telegram = false;
      continue;
    }
    if (arg === '--legacy-calendar-plan') {
      args.legacyCalendarPlan = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;

    if (['days', 'interval-seconds', 'limit-per-cycle', 'delete-limit-per-cycle', 'naver-block-limit-per-cycle', 'notify-cooldown-seconds'].includes(key)) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${arg} must be a positive integer`);
      args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = parsed;
    } else if (['config', 'state', 'from', 'rooms'].includes(key)) {
      args[key] = next;
    } else if (key === 'naver-business-id') {
      args.naverBusinessId = next;
    } else if (key === 'work-dir') {
      args.workDir = next;
    } else if (key === 'profile-dir') {
      args.profileDir = next;
    } else if (key === 'env-file') {
      args.envFile = next;
    } else if (key === 'cafe24-target-env') {
      args.cafe24TargetEnv = next;
    } else if (key === 'notify-state') {
      args.notifyState = next;
    } else if (key === 'to') {
      args.smsTestTo = next;
    } else if (key === 'sms-test-task-id') {
      args.smsTestTaskId = next;
    } else if (key === 'sms-test-task-type') {
      args.smsTestTaskType = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function kstToday() {
  const shifted = new Date(Date.now() + KST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kstNowText() {
  return new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
  });
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function appendJsonl(filePath, row) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`);
}

async function readJsonObject(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function logLine(message) {
  console.log(`[spacecloud-watch] ${new Date().toISOString()} ${message}`);
}

function parseEnvValue(value) {
  let trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1);
  }
  return trimmed.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g, (_match, key, fallback = '') => {
    const current = process.env[key] || '';
    return current || fallback;
  });
}

async function loadEnvFile(filePath) {
  if (!filePath) return;
  let text = '';
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

async function readEnvLikeFile(filePath) {
  const values = {};
  const text = await fs.readFile(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = parseEnvValue(rawValue);
  }
  return values;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function loadCafe24Target(args) {
  const target = await readEnvLikeFile(args.cafe24TargetEnv);
  const required = ['SSH_TARGET', 'SSH_KEY', 'PYTHON_BIN', 'SERVER_ENV_FILE'];
  const missing = required.filter((key) => !target[key]);
  if (missing.length > 0) throw new Error(`missing Cafe24 target setting(s): ${missing.join(', ')}`);
  return target;
}

function runSshScript(target, script) {
  const timeoutSeconds = Number.parseInt(process.env.SPACECLOUD_WATCH_SSH_TIMEOUT_SECONDS || '90', 10);
  const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 90_000;
  const cp = spawnSync('ssh', [
    '-i',
    target.SSH_KEY,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=12',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
    target.SSH_TARGET,
    'bash -s',
  ], {
    cwd: process.cwd(),
    input: script,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  if (cp.error) {
    const detail = (cp.stderr || cp.stdout || '').trim();
    throw new Error(`ssh failed: ${cp.error.message}${detail ? `\n${detail}` : ''}`);
  }
  if (cp.status !== 0) {
    throw new Error((cp.stderr || cp.stdout || `ssh exited ${cp.status}`).trim());
  }
  return cp.stdout;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function maskPhone(value) {
  const digits = normalizePhone(value);
  if (digits.length < 7) return '';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function confirmationSmsEnabled() {
  return String(process.env.RHYTHMJOY_CONFIRMATION_SMS_ENABLED || '1').trim() !== '0';
}

function confirmationSmsMessage() {
  return process.env.RHYTHMJOY_CONFIRMATION_SMS_MESSAGE || DEFAULT_CONFIRMATION_SMS_MESSAGE;
}

function safeSmsResult(result) {
  const safe = {
    status: result?.status || 'unknown',
    maskedPhone: result?.maskedPhone || '',
    templateName: result?.templateName || CONFIRMATION_SMS_TEMPLATE_NAME,
    providerCode: result?.providerCode || result?.code || '',
    remaining: Number.isFinite(result?.remaining) ? result.remaining : result?.remaining ?? null,
  };
  if (result?.reason) safe.reason = result.reason;
  if (result?.error) safe.error = cleanTelegramText(result.error, 180);
  if (result?.deliveryId) safe.deliveryId = result.deliveryId;
  return safe;
}

async function sendRemoteConfirmationSms(args, {
  task,
  phone,
  source,
} = {}) {
  if (!confirmationSmsEnabled()) {
    return { status: 'disabled', reason: 'RHYTHMJOY_CONFIRMATION_SMS_ENABLED=0', maskedPhone: '' };
  }
  const to = normalizePhone(phone);
  if (!/^01[016789]\d{7,8}$/.test(to)) {
    return { status: 'skipped', reason: 'recipient-phone-missing', maskedPhone: '' };
  }

  const target = await loadCafe24Target(args);
  const opsRoot = target.OPS_ROOT || '/home/clown313python/rhythmjoy_ops';
  const payload = Buffer.from(JSON.stringify({
    taskId: task.id || task.taskId,
    taskType: task.taskType || task.task_type || '',
    source: source || '',
    to,
    maskedPhone: maskPhone(to),
    message: confirmationSmsMessage(),
    subject: process.env.RHYTHMJOY_CONFIRMATION_SMS_SUBJECT || '리듬앤조이 예약확정 안내',
    templateName: CONFIRMATION_SMS_TEMPLATE_NAME,
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_OPS_ROOT=${shellQuote(opsRoot)}
export SMS_PAYLOAD_B64=${shellQuote(payload)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import base64
import hashlib
import json
import os
import sys
from pathlib import Path

import pymysql

ops_root = Path(os.environ['RHYTHMJOY_OPS_ROOT'])
sys.path.insert(0, str(ops_root))
import cafe24_sms

def load_env(path):
    for raw in Path(path).read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

def mask_phone(value):
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if len(digits) < 7:
        return ''
    return f'{digits[:3]}-****-{digits[-4:]}'

def ensure_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rhythmjoy_sms_deliveries (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            idempotency_key VARCHAR(160) NOT NULL,
            source_task_type VARCHAR(32) NOT NULL DEFAULT '',
            source_task_id BIGINT UNSIGNED NULL,
            template_name VARCHAR(64) NOT NULL DEFAULT '',
            recipient_phone_hash CHAR(64) NOT NULL DEFAULT '',
            recipient_phone_last4 VARCHAR(4) NOT NULL DEFAULT '',
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            provider_code VARCHAR(64) NOT NULL DEFAULT '',
            provider_remaining INT NULL,
            provider_raw VARCHAR(255) NOT NULL DEFAULT '',
            error_text TEXT NULL,
            sent_at DATETIME NULL,
            created_at DATETIME NULL,
            updated_at DATETIME NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_idempotency_key (idempotency_key),
            KEY idx_status (status),
            KEY idx_task (source_task_type, source_task_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
payload = json.loads(base64.b64decode(os.environ['SMS_PAYLOAD_B64']).decode('utf-8'))
task_id = int(payload.get('taskId') or 0)
task_type = payload.get('taskType') or ''
template_name = payload.get('templateName') or 'reservation-confirmed-v1'
phone = ''.join(ch for ch in str(payload.get('to') or '') if ch.isdigit())
masked = mask_phone(phone)
idempotency_key = f'{template_name}|{task_type}|{task_id}'
phone_hash = hashlib.sha256(phone.encode('utf-8')).hexdigest() if phone else ''

conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'],
    port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'],
    password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'],
    charset='utf8mb4',
    autocommit=True,
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        ensure_table(cur)
        cur.execute('SELECT * FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
        existing = cur.fetchone()
        if existing and existing.get('status') == 'sent':
            print(json.dumps({
                'status': 'already_sent',
                'deliveryId': existing.get('id'),
                'maskedPhone': masked,
                'templateName': template_name,
                'providerCode': existing.get('provider_code') or '',
                'remaining': existing.get('provider_remaining'),
            }, ensure_ascii=False))
            raise SystemExit(0)

        try:
            result = cafe24_sms.send_sms(
                phone,
                payload.get('message') or '',
                subject=payload.get('subject') or '',
                sms_type='auto',
                real=True,
            )
            status = 'sent' if result.get('ok') else 'failed'
            error_text = '' if result.get('ok') else json.dumps(result, ensure_ascii=False)[:1000]
            cur.execute(
                """
                INSERT INTO rhythmjoy_sms_deliveries (
                    idempotency_key, source_task_type, source_task_id, template_name,
                    recipient_phone_hash, recipient_phone_last4, status,
                    provider_code, provider_remaining, provider_raw, error_text,
                    sent_at, created_at, updated_at
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,IF(%s='sent', NOW(), NULL),NOW(),NOW())
                ON DUPLICATE KEY UPDATE
                    status=VALUES(status),
                    provider_code=VALUES(provider_code),
                    provider_remaining=VALUES(provider_remaining),
                    provider_raw=VALUES(provider_raw),
                    error_text=VALUES(error_text),
                    sent_at=IF(VALUES(status)='sent', NOW(), sent_at),
                    updated_at=NOW()
                """,
                (
                    idempotency_key, task_type, task_id or None, template_name,
                    phone_hash, phone[-4:], status,
                    result.get('code') or '', result.get('remaining'), str(result.get('raw') or '')[:255],
                    error_text, status,
                ),
            )
            cur.execute('SELECT id FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
            saved = cur.fetchone() or {}
            print(json.dumps({
                'status': status,
                'deliveryId': saved.get('id'),
                'maskedPhone': masked,
                'templateName': template_name,
                'providerCode': result.get('code') or '',
                'remaining': result.get('remaining'),
                'raw': str(result.get('raw') or '')[:80],
            }, ensure_ascii=False))
        except Exception as error:
            cur.execute(
                """
                INSERT INTO rhythmjoy_sms_deliveries (
                    idempotency_key, source_task_type, source_task_id, template_name,
                    recipient_phone_hash, recipient_phone_last4, status, error_text,
                    created_at, updated_at
                )
                VALUES (%s,%s,%s,%s,%s,%s,'failed',%s,NOW(),NOW())
                ON DUPLICATE KEY UPDATE
                    status='failed',
                    error_text=VALUES(error_text),
                    updated_at=NOW()
                """,
                (idempotency_key, task_type, task_id or None, template_name, phone_hash, phone[-4:], str(error)[:1000]),
            )
            cur.execute('SELECT id FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
            saved = cur.fetchone() or {}
            print(json.dumps({
                'status': 'failed',
                'deliveryId': saved.get('id'),
                'maskedPhone': masked,
                'templateName': template_name,
                'error': str(error),
            }, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  const result = JSON.parse(runSshScript(target, script).trim() || '{}');
  return safeSmsResult(result);
}

const REMOTE_TASK_ENRICHMENT_PY = String.raw`
def parse_payload(row):
    try:
        value = json.loads(row.get('payloadJson') or '{}')
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}

def source_platform_for_task(task_type):
    if task_type in ('upload', 'delete'):
        return 'naver'
    if task_type in ('naver_block', 'naver_restore'):
        return 'spacecloud'
    return ''

def enrich_task_row(cur, row):
    payload = parse_payload(row)
    task_type = row.get('taskType') or ''
    source_platform = source_platform_for_task(task_type)
    calendar_key = payload.get('calendarKey') or payload.get('calendar_key') or payload.get('target_calendar') or ''
    row['ledgerStatus'] = ''
    row['ledgerId'] = None
    row['ledgerKey'] = ''
    row['ledgerLastEventAt'] = ''
    if source_platform and calendar_key:
        ledger_key = importer.booking_ledger_key(source_platform, payload, calendar_key)
        row['ledgerKey'] = ledger_key
        cur.execute(
            """
            SELECT id, current_status, DATE_FORMAT(last_event_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS last_event_at
            FROM rhythmjoy_booking_ledger
            WHERE ledger_key=%s
            LIMIT 1
            """,
            (ledger_key,),
        )
        ledger = cur.fetchone()
        if ledger:
            row['ledgerId'] = ledger.get('id')
            row['ledgerStatus'] = ledger.get('current_status') or ''
            row['ledgerLastEventAt'] = ledger.get('last_event_at') or ''

    if task_type == 'naver_restore':
        row['priorNaverBlockChanged'] = False
        row['priorNaverBlockTaskId'] = None
        row['priorNaverBlockStatus'] = ''
        wanted_name = importer.normalize_reserver_name_for_match(row.get('reserverName'))
        cur.execute(
            """
            SELECT id, status, reserver_name, result_text
            FROM rhythmjoy_spacecloud_tasks
            WHERE task_type='naver_block'
              AND room_key=%s
              AND reservation_date=%s
              AND start_time=%s
              AND end_time=%s
            ORDER BY id DESC
            LIMIT 10
            """,
            (row.get('roomKey'), row.get('date'), row.get('startTime'), row.get('endTime')),
        )
        for candidate in cur.fetchall():
            if importer.normalize_reserver_name_for_match(candidate.get('reserver_name')) != wanted_name:
                continue
            row['priorNaverBlockTaskId'] = candidate.get('id')
            result_text = candidate.get('result_text') or '{}'
            try:
                result = json.loads(result_text)
            except Exception:
                result = {}
            row['priorNaverBlockStatus'] = result.get('status') or candidate.get('status') or ''
            row['priorNaverBlockChanged'] = bool(
                result.get('status') == 'blocked'
                or result.get('changedSlotCount', 0)
                or any(slot.get('status') == 'blocked' for slot in (result.get('appliedSlots') or []) if isinstance(slot, dict))
            )
            break
`;

async function fetchRemoteTasks(args, { taskType, limit }) {
  const target = await loadCafe24Target(args);
  const opsRoot = target.OPS_ROOT || '/home/clown313python/rhythmjoy_ops';
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_OPS_ROOT=${shellQuote(opsRoot)}
export RHYTHMJOY_TASK_TYPE=${shellQuote(taskType)}
export TASK_LIMIT=${shellQuote(limit)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import json
import os
import sys
import uuid
from pathlib import Path
import pymysql

ops_root = Path(os.environ['RHYTHMJOY_OPS_ROOT'])
sys.path.insert(0, str(ops_root))
import rhythmjoy_email_import as importer

def load_env(path):
    for raw in Path(path).read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
${REMOTE_TASK_ENRICHMENT_PY}

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
try:
    claim_token = uuid.uuid4().hex
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                id,
                task_type AS taskType,
                status,
                room_key AS roomKey,
                reservation_number AS reservationNo,
                reserver_name AS reserverName,
                product,
                DATE_FORMAT(reservation_date, '%%Y-%%m-%%d') AS date,
                TIME_FORMAT(start_time, '%%H:%%i') AS startTime,
                TIME_FORMAT(end_time, '%%H:%%i') AS endTime,
                payload_json AS payloadJson,
                attempts,
                DATE_FORMAT(locked_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS lockedAt,
                result_text AS resultText
            FROM rhythmjoy_spacecloud_tasks
            WHERE task_type=%s
              AND (
                status='pending'
                OR (status='google_pending' AND %s IN ('naver_block', 'naver_restore', 'upload', 'delete'))
                OR (status='running' AND locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
              )
            ORDER BY
              CASE
                WHEN status='running' THEN 0
                WHEN status='pending' THEN 1
                ELSE 2
              END,
              created_at ASC,
              id ASC
            LIMIT %s
            FOR UPDATE
            """,
            (
                os.environ['RHYTHMJOY_TASK_TYPE'],
                os.environ['RHYTHMJOY_TASK_TYPE'],
                int(os.environ.get('TASK_LIMIT', '2')),
            )
        )
        rows = cur.fetchall()
        for row in rows:
            enrich_task_row(cur, row)
        ids = [row['id'] for row in rows]
        if ids:
            cur.execute(
                f"""
                UPDATE rhythmjoy_spacecloud_tasks
                SET status='running', attempts=attempts+1, locked_at=NOW(), claim_token=%s, updated_at=NOW()
                WHERE id IN ({','.join(['%s'] * len(ids))})
                """,
                [claim_token, *ids]
            )
    conn.commit()
    print(json.dumps(rows, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '[]');
}

async function fetchRemoteTaskTypes(args, { taskTypes, limit }) {
  const target = await loadCafe24Target(args);
  const opsRoot = target.OPS_ROOT || '/home/clown313python/rhythmjoy_ops';
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_OPS_ROOT=${shellQuote(opsRoot)}
export RHYTHMJOY_TASK_TYPES=${shellQuote(JSON.stringify(taskTypes))}
export TASK_LIMIT=${shellQuote(limit)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import json
import os
import sys
import uuid
from pathlib import Path
import pymysql

ops_root = Path(os.environ['RHYTHMJOY_OPS_ROOT'])
sys.path.insert(0, str(ops_root))
import rhythmjoy_email_import as importer

def load_env(path):
    for raw in Path(path).read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
${REMOTE_TASK_ENRICHMENT_PY}

task_types = json.loads(os.environ['RHYTHMJOY_TASK_TYPES'])
if not task_types:
    print('[]')
    raise SystemExit(0)
placeholders = ','.join(['%s'] * len(task_types))
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
try:
    claim_token = uuid.uuid4().hex
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                id,
                task_type AS taskType,
                status,
                room_key AS roomKey,
                reservation_number AS reservationNo,
                reserver_name AS reserverName,
                product,
                DATE_FORMAT(reservation_date, '%%Y-%%m-%%d') AS date,
                TIME_FORMAT(start_time, '%%H:%%i') AS startTime,
                TIME_FORMAT(end_time, '%%H:%%i') AS endTime,
                payload_json AS payloadJson,
                attempts,
                DATE_FORMAT(locked_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS lockedAt,
                result_text AS resultText
            FROM rhythmjoy_spacecloud_tasks
            WHERE task_type IN ({placeholders})
              AND (
                status='pending'
                OR (status='google_pending' AND task_type IN ('naver_block', 'naver_restore', 'upload', 'delete'))
                OR (status='running' AND locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
              )
            ORDER BY
              CASE
                WHEN status='running' THEN 0
                WHEN status='pending' THEN 1
                ELSE 2
              END,
              created_at ASC,
              id ASC
            LIMIT %s
            FOR UPDATE
            """,
            [*task_types, int(os.environ.get('TASK_LIMIT', '2'))],
        )
        rows = cur.fetchall()
        for row in rows:
            enrich_task_row(cur, row)
        ids = [row['id'] for row in rows]
        if ids:
            cur.execute(
                f"""
                UPDATE rhythmjoy_spacecloud_tasks
                SET status='running', attempts=attempts+1, locked_at=NOW(), claim_token=%s, updated_at=NOW()
                WHERE id IN ({','.join(['%s'] * len(ids))})
                """,
                [claim_token, *ids]
            )
    conn.commit()
    print(json.dumps(rows, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '[]');
}

async function fetchRemoteDeleteTasks(args) {
  return fetchRemoteTasks(args, {
    taskType: 'delete',
    limit: args.deleteLimitPerCycle,
  });
}

async function fetchRemoteUploadTasks(args) {
  return fetchRemoteTasks(args, {
    taskType: 'upload',
    limit: args.limitPerCycle,
  });
}

async function fetchRemoteNaverBlockTasks(args) {
  return fetchRemoteTasks(args, {
    taskType: 'naver_block',
    limit: args.naverBlockLimitPerCycle,
  });
}

async function fetchRemoteNaverAvailabilityTasks(args) {
  return fetchRemoteTaskTypes(args, {
    taskTypes: ['naver_block', 'naver_restore'],
    limit: args.naverBlockLimitPerCycle,
  });
}

async function updateRemoteTask(args, taskId, status, resultText) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({
    taskId,
    status,
    resultText: String(resultText || '').slice(0, 4000),
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export TASK_UPDATE_B64=${shellQuote(payload)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import base64
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
payload = json.loads(base64.b64decode(os.environ['TASK_UPDATE_B64']).decode('utf-8'))
conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'],
    port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'],
    password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'],
    charset='utf8mb4',
    autocommit=True,
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        processed_expr = 'NOW()' if payload['status'] in ('done', 'already_gone', 'needs_review', 'failed') else 'processed_at'
        cur.execute(
            f"""
            UPDATE rhythmjoy_spacecloud_tasks
            SET status=%s,
                processed_at={processed_expr},
                claim_token='',
                result_text=%s,
                updated_at=NOW()
            WHERE id=%s
            """,
            (payload['status'], payload['resultText'], payload['taskId'])
        )
        print(json.dumps({'updated': cur.rowcount}, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '{}');
}

async function createRemoteGoogleEventForTask(args, taskId, taskType) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({ taskId, taskType }), 'utf8').toString('base64');
  const opsRoot = target.OPS_ROOT || '/home/clown313python/rhythmjoy_ops';
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_OPS_ROOT=${shellQuote(opsRoot)}
export GOOGLE_TASK_B64=${shellQuote(payload)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import base64
import json
import logging
import os
import sys
from pathlib import Path

import pymysql

ops_root = Path(os.environ['RHYTHMJOY_OPS_ROOT'])
sys.path.insert(0, str(ops_root))
import rhythmjoy_email_import as importer

payload = json.loads(base64.b64decode(os.environ['GOOGLE_TASK_B64']).decode('utf-8'))
task_id = int(payload['taskId'])
task_type = payload.get('taskType') or 'naver_block'
logger = logging.getLogger('spacecloud_watch_google_after_apply')
logger.setLevel(logging.INFO)

config = importer.build_config()
service = importer.build_calendar_service(config)

conn = pymysql.connect(
    host=config['db_server'],
    port=int(config.get('db_port', 3306)),
    user=config['db_username'],
    password=config['db_password'],
    database=config['db_name'],
    charset='utf8mb4',
    autocommit=True,
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, email_event_id, task_type, reservation_number, payload_json
            FROM rhythmjoy_spacecloud_tasks
            WHERE id=%s AND task_type=%s
            LIMIT 1
            """,
            (task_id, task_type),
        )
        task = cur.fetchone()
    if not task:
        print(json.dumps({'status': 'failed', 'error': f'task not found: {task_type}:{task_id}'}, ensure_ascii=False))
        raise SystemExit(0)

    event_data = json.loads(task.get('payload_json') or '{}')
    calendar_key = event_data.get('calendarKey') or event_data.get('calendar_key')
    if not calendar_key:
        print(json.dumps({'status': 'failed', 'error': 'calendar key missing'}, ensure_ascii=False))
        raise SystemExit(0)
    event_data['target_calendar'] = calendar_key
    event_data['calendar_key'] = calendar_key
    status_prefix = 'calendar_after_upload' if task_type == 'upload' else 'calendar_after_apply'

    reservation_number = event_data.get('reservation_number') or task.get('reservation_number') or ''
    existing = importer.find_calendar_event_by_reservation(service, calendar_key, reservation_number, logger)
    if not existing:
        existing = importer.find_calendar_event_by_details(service, calendar_key, event_data, logger)
    if existing:
        if task.get('email_event_id'):
            importer.update_email_processing(
                config,
                task['email_event_id'],
                f'{status_prefix}_existing',
                logger,
                google_calendar_event_id=existing.get('id', ''),
                error_text='',
            )
        print(json.dumps({'status': 'existing', 'eventId': existing.get('id', '')}, ensure_ascii=False))
        raise SystemExit(0)

    conflicts = importer.find_calendar_conflicts(service, calendar_key, event_data, logger)
    if conflicts:
        if task.get('email_event_id'):
            importer.update_email_processing(
                config,
                task['email_event_id'],
                f'{status_prefix}_conflict',
                logger,
                error_text=json.dumps(conflicts[:5], ensure_ascii=False),
            )
        print(json.dumps({'status': 'conflict', 'conflicts': conflicts[:5]}, ensure_ascii=False))
        raise SystemExit(0)

    created = importer.create_calendar_event(
        service,
        event_data,
        logger,
        dedupe_google_calendar=True,
    )
    if task.get('email_event_id'):
        importer.update_email_processing(
            config,
            task['email_event_id'],
            f'{status_prefix}_created',
            logger,
            google_calendar_event_id=created.get('id', ''),
            error_text='',
        )
    print(json.dumps({'status': 'created', 'eventId': created.get('id', '')}, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '{}');
}

async function createRemoteGoogleEventForNaverBlockTask(args, taskId) {
  return createRemoteGoogleEventForTask(args, taskId, 'naver_block');
}

async function createRemoteGoogleEventForUploadTask(args, taskId) {
  return createRemoteGoogleEventForTask(args, taskId, 'upload');
}

async function deleteRemoteGoogleEventForTask(args, taskId, taskType) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({ taskId, taskType }), 'utf8').toString('base64');
  const opsRoot = target.OPS_ROOT || '/home/clown313python/rhythmjoy_ops';
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_OPS_ROOT=${shellQuote(opsRoot)}
export GOOGLE_DELETE_TASK_B64=${shellQuote(payload)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import base64
import json
import logging
import os
import sys
from pathlib import Path

import pymysql

ops_root = Path(os.environ['RHYTHMJOY_OPS_ROOT'])
sys.path.insert(0, str(ops_root))
import rhythmjoy_email_import as importer

payload = json.loads(base64.b64decode(os.environ['GOOGLE_DELETE_TASK_B64']).decode('utf-8'))
task_id = int(payload['taskId'])
task_type = payload.get('taskType') or 'delete'
logger = logging.getLogger('spacecloud_watch_google_after_delete')
logger.setLevel(logging.INFO)

config = importer.build_config()
service = importer.build_calendar_service(config)

conn = pymysql.connect(
    host=config['db_server'],
    port=int(config.get('db_port', 3306)),
    user=config['db_username'],
    password=config['db_password'],
    database=config['db_name'],
    charset='utf8mb4',
    autocommit=True,
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, email_event_id, task_type, reservation_number, payload_json
            FROM rhythmjoy_spacecloud_tasks
            WHERE id=%s AND task_type=%s
            LIMIT 1
            """,
            (task_id, task_type),
        )
        task = cur.fetchone()
    if not task:
        print(json.dumps({'status': 'failed', 'error': f'{task_type} task not found: {task_id}'}, ensure_ascii=False))
        raise SystemExit(0)

    deletion = json.loads(task.get('payload_json') or '{}')
    deleted_count = importer.delete_events_by_reservation(service, deletion, logger)
    status = 'deleted' if deleted_count else 'not_found'
    status_prefix = 'calendar_restore' if task_type == 'naver_restore' else 'calendar_after_delete'
    if task.get('email_event_id'):
        importer.update_email_processing(
            config,
            task['email_event_id'],
            f'{status_prefix}_done' if deleted_count else f'{status_prefix}_not_found',
            logger,
            google_calendar_deleted_count=deleted_count,
            error_text='',
        )
    print(json.dumps({'status': status, 'deletedCount': deleted_count}, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '{}');
}

async function deleteRemoteGoogleEventForDeleteTask(args, taskId) {
  return deleteRemoteGoogleEventForTask(args, taskId, 'delete');
}

async function deleteRemoteGoogleEventForNaverRestoreTask(args, taskId) {
  return deleteRemoteGoogleEventForTask(args, taskId, 'naver_restore');
}

const TELEGRAM_LOG_HINT = '로그: state/spacecloud-watch/launchd.log';

function cleanTelegramText(value, maxLength = 160) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text || '-';
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function compactTelegramText(text) {
  const configuredLimit = Number.parseInt(process.env.TELEGRAM_MAX_CHARS || '1200', 10);
  const limit = Number.isFinite(configuredLimit) && configuredLimit >= 400 ? configuredLimit : 1200;
  const normalized = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .reduce((lines, line) => {
      if (!line && lines[lines.length - 1] === '') return lines;
      lines.push(line);
      return lines;
    }, [])
    .join('\n')
    .trim();
  if (normalized.length <= limit) return normalized;
  const suffix = `\n...\n${TELEGRAM_LOG_HINT}`;
  return `${normalized.slice(0, Math.max(0, limit - suffix.length))}${suffix}`;
}

async function sendTelegram(args, text) {
  if (!args.telegram) return { sent: false, reason: 'disabled' };
  const message = compactTelegramText(text);
  if (process.env.TELEGRAM_DRY_RUN === '1') {
    logLine(`telegram dry-run: ${message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { sent: false, reason: 'dry-run' };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId) {
    logLine('telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing');
    return { sent: false, reason: 'missing-credentials' };
  }

  const timeoutMs = Number.parseInt(process.env.TELEGRAM_SEND_TIMEOUT || '12', 10) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`telegram http ${response.status}: ${body.slice(0, 160)}`);
    }
    return { sent: true, reason: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function notifyWithCooldown(args, key, text, {
  cooldownSeconds = args.notifyCooldownSeconds,
} = {}) {
  const state = await readJsonObject(args.notifyState);
  const now = Date.now();
  const lastSentAt = state[key]?.lastSentAt ? Date.parse(state[key].lastSentAt) : 0;
  if (lastSentAt && now - lastSentAt < cooldownSeconds * 1000) {
    logLine(`telegram suppressed by cooldown: ${key}`);
    return { sent: false, reason: 'cooldown' };
  }

  try {
    const result = await sendTelegram(args, text);
    state[key] = {
      lastAttemptAt: new Date().toISOString(),
      lastSentAt: result.sent || result.reason === 'dry-run' ? new Date().toISOString() : state[key]?.lastSentAt || null,
      result,
      textPreview: compactTelegramText(text).replace(/\s+/g, ' ').slice(0, 240),
    };
    await writeJson(args.notifyState, state);
    if (result.sent) logLine(`telegram sent: ${key}`);
    return result;
  } catch (error) {
    state[key] = {
      lastAttemptAt: new Date().toISOString(),
      lastSentAt: state[key]?.lastSentAt || null,
      result: { sent: false, reason: String(error?.message || error) },
      textPreview: compactTelegramText(text).replace(/\s+/g, ' ').slice(0, 240),
    };
    await writeJson(args.notifyState, state);
    logLine(`telegram failed: ${String(error?.message || error)}`);
    return { sent: false, reason: String(error?.message || error) };
  }
}

function isLoginProblem(message) {
  return /login|logged out|add button not visible|로그인|세션|인증/i.test(String(message || ''));
}

function isTransientRemoteProblem(message) {
  return /ssh failed|timed out|ETIMEDOUT|SIGKILL|Connection timed out|Connection reset|Connection closed by|Broken pipe/i.test(String(message || ''));
}

function rowsFromResult(rowOrError, key = 'failed') {
  if (typeof rowOrError !== 'object' || !rowOrError) return [];
  if (Array.isArray(rowOrError)) return rowOrError;
  if (Array.isArray(rowOrError[key])) return rowOrError[key];
  if (Array.isArray(rowOrError.rows)) return rowOrError.rows;
  return [];
}

function minutesFromTimeText(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function displayEndTime(startTime, endTime) {
  if (!endTime) return '-';
  const startMinutes = minutesFromTimeText(startTime);
  const endMinutes = minutesFromTimeText(endTime);
  if (endTime === '00:00' && startMinutes !== null && startMinutes > 0) return '24:00';
  if (startMinutes !== null && endMinutes !== null && endMinutes < startMinutes) return `익일 ${endTime}`;
  return endTime;
}

function taskTimeText(row) {
  const startTime = row.startTime || row.start_time || '-';
  const endTime = displayEndTime(startTime, row.endTime || row.end_time || '');
  return `${row.date || row.reservation_date || '-'} ${startTime}-${endTime}`;
}

function taskTargetText(row) {
  const parts = [
    row.taskId ? `#${row.taskId}` : '',
    row.roomKey || row.room_key || '-',
    taskTimeText(row),
    row.reserverName || row.reserver_name || '',
    row.reservationNo || row.reservation_number || '',
  ].filter(Boolean);
  return cleanTelegramText(parts.join(' / '), 160);
}

function telegramStatusText(status) {
  const map = {
    blocked: '반영 성공',
    'already-blocked': '이미 반영됨',
    restored: '복구 성공',
    'already-available': '이미 예약가능',
    'restore-skipped-not-owned': '복구 생략',
    submitted: '등록 성공',
    deleted: '삭제 성공',
    'already-gone': '이미 없음',
    'google-recorded': '구글 기록 완료',
    'calendar-record-warning': '구글 기록 경고',
    'google-create-failed': '구글 기록 재시도',
    'google-delete-failed': '구글 삭제 재시도',
    'naver-conflict': '네이버 충돌',
    'needs-review': '확인 필요',
  };
  return map[status] || status || '-';
}

function formatBriefRows(rows, limit = 3) {
  const visible = rows.slice(0, limit);
  const lines = visible.map((row, index) => `${index + 1}. ${taskTargetText(row)} (${telegramStatusText(row.status)})`);
  if (rows.length > visible.length) lines.push(`외 ${rows.length - visible.length}건`);
  return lines.join('\n') || '-';
}

function firstFailureReason(rowOrError) {
  if (typeof rowOrError === 'string') return cleanTelegramText(rowOrError, 180);
  const row = rowsFromResult(rowOrError).find((item) => item.error || item.reason || item.calendarRecordWarning || item.status) || {};
  return cleanTelegramText(row.error || row.reason || row.calendarRecordWarning || row.status || '-', 180);
}

function firstProblemRow(rowOrError) {
  return rowsFromResult(rowOrError).find((item) => (
    item.error
    || item.reason
    || item.calendarRecordWarning
    || item.status
  )) || {};
}

function deleteFailureReasonText(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  if (rows.length && rows.every((row) => row.status === 'google-delete-failed')) {
    return '스페이스클라우드 삭제는 완료됐고, 구글 달력 삭제만 재시도 예정';
  }

  const row = firstProblemRow(rowOrError);
  const raw = String(row.error || row.reason || row.calendarRecordWarning || row.status || '');

  if (/no visible SpaceCloud event candidate matched/i.test(raw)) {
    return '네이버 예약은 취소됐지만, 스페이스클라우드 달력에서 같은 방/날짜/시간의 직접추가(추) 예약을 못 찾음';
  }
  if (/reservation-number-mismatch/i.test(raw)) {
    return '스페이스클라우드 일정은 찾았지만, 메모의 네이버 예약번호가 취소 메일과 다름';
  }
  if (/reserver-name-mismatch/i.test(raw)) {
    return '스페이스클라우드 일정은 찾았지만, 예약자명이 취소 메일과 다름';
  }
  if (/multiple direct event candidates matched/i.test(raw)) {
    return '같은 방/날짜/시간에 직접추가(추) 예약 후보가 여러 개라 자동삭제 중지';
  }
  if (/multiple non-direct event candidates matched/i.test(raw)) {
    return '같은 방/날짜/시간의 예약은 보였지만 직접추가(추) 예약으로 확정하지 못함';
  }
  if (/not-direct-added/i.test(raw)) {
    return '스페이스클라우드 일정은 찾았지만 직접추가(추) 예약이 아니라 자동삭제하지 않음';
  }
  if (/room-mismatch/i.test(raw)) {
    return '스페이스클라우드 일정은 찾았지만 방 정보가 취소 메일과 다름';
  }
  if (/date-mismatch/i.test(raw)) {
    return '스페이스클라우드 일정은 찾았지만 날짜가 취소 메일과 다름';
  }
  if (/time-mismatch/i.test(raw)) {
    return '스페이스클라우드 일정은 찾았지만 시간이 취소 메일과 다름';
  }
  if (/identity missing/i.test(raw)) {
    return '취소 메일에 자동 검증할 예약자명/예약번호가 부족함';
  }

  return cleanTelegramText(raw || '-', 180);
}

function googleSummary(rows) {
  if (!rows.length) return '구글=-';
  const counts = new Map();
  let warnings = 0;
  for (const row of rows) {
    const status = row.googleCalendar?.status || (row.status?.startsWith('google-') ? row.status : '');
    if (status) counts.set(status, (counts.get(status) || 0) + 1);
    if (row.calendarRecordWarning) warnings += 1;
  }
  if (!counts.size && !warnings) return '구글=-';
  const statusText = [...counts.entries()].map(([status, count]) => `${status} ${count}`).join(', ');
  return `구글=${statusText || '-'}${warnings ? ` / 경고 ${warnings}` : ''}`;
}

function smsStatusText(status) {
  const map = {
    sent: '발송 성공',
    already_sent: '이미 발송됨',
    skipped: '발송 생략',
    failed: '발송 실패',
    disabled: '문자 비활성',
  };
  return map[status] || status || '-';
}

function smsRowsFromCycle(row) {
  const rows = [
    ...(row.uploadTasks?.rows || []),
    ...(row.naverBlockTasks?.rows || []),
    ...(row.naverAvailabilityTasks?.rows || []),
  ].filter((taskRow) => taskRow.sms);
  const seen = new Set();
  return rows.filter((taskRow) => {
    const key = `${taskRow.taskType || ''}:${taskRow.taskId || taskRow.fingerprint || taskTargetText(taskRow)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatSmsRows(rows, limit = 3) {
  const visible = rows.slice(0, limit);
  const lines = visible.map((row, index) => {
    const sms = row.sms || {};
    const reason = sms.reason || sms.error || sms.providerCode || '';
    return `${index + 1}. ${taskTargetText(row)} / ${sms.maskedPhone || '-'} (${smsStatusText(sms.status)}${reason ? `: ${cleanTelegramText(reason, 80)}` : ''})`;
  });
  if (rows.length > visible.length) lines.push(`외 ${rows.length - visible.length}건`);
  return lines.join('\n') || '-';
}

function compactNotice(title, lines) {
  return [
    title,
    kstNowText(),
    '',
    ...lines.filter((line) => line !== ''),
    TELEGRAM_LOG_HINT,
  ].join('\n');
}

function loginNeededMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  const errorText = typeof rowOrError === 'string'
    ? rowOrError
    : rows.map((row) => row.error || row.status).filter(Boolean).join('\n');
  const candidates = typeof rowOrError === 'object' ? rowOrError?.uploadCandidates : null;
  return compactNotice('⚠️ 실패: 로그인 필요', [
    '상태: 세션 확인 대기',
    `후보: ${candidates ?? '-'}건`,
    rows.length ? `대상:\n${formatBriefRows(rows, 1)}` : '',
    `원인: ${cleanTelegramText(errorText || '-', 120)}`,
    '조치: 자동화 Chrome에서 네이버/스페이스클라우드 로그인',
  ]);
}

function uploadFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  return compactNotice('⚠️ 실패: 스페이스클라우드 자동등록', [
    `대상: ${rows.length || '-'}건`,
    formatBriefRows(rows),
    `원인: ${firstFailureReason(rowOrError)}`,
    '조치: 자동 반복 중지, 로그 확인',
  ]);
}

function uploadSuccessMessage(row) {
  const uploadedRows = [
    ...(row.uploadedRows || []),
    ...((row.uploadTasks?.rows || []).filter((taskRow) => [
      'google-recorded',
      'submitted',
      'calendar-record-warning',
    ].includes(taskRow.status))),
  ];
  return compactNotice('✅ 성공: 스페이스클라우드 등록', [
    `처리: ${uploadedRows.length}건 / 남은 후보 ${row.remainingInPlan ?? '-'}건`,
    formatBriefRows(uploadedRows),
    googleSummary(uploadedRows),
  ]);
}

function uploadTaskFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  const allGoogle = rows.length && rows.every((row) => row.status === 'google-create-failed');
  return compactNotice(allGoogle ? '⚠️ 실패: 구글 달력 기록' : '⚠️ 실패: 스페이스클라우드 등록', [
    `상태: ${allGoogle ? '구글 기록 재시도 예정' : '자동 처리 중지'}`,
    `대상: ${rows.length || '-'}건`,
    formatBriefRows(rows),
    `원인: ${firstFailureReason(rowOrError)}`,
  ]);
}

function deleteFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  const allGoogle = rows.length && rows.every((row) => row.status === 'google-delete-failed');
  return compactNotice(allGoogle ? '⚠️ 실패: 구글 달력 삭제' : '⚠️ 실패: 스페이스클라우드 삭제', [
    `상태: ${allGoogle ? '구글 달력만 재시도' : '스페이스클라우드 삭제 미완료'}`,
    `대상: ${rows.length || '-'}건`,
    formatBriefRows(rows),
    `이유: ${deleteFailureReasonText(rowOrError)}`,
    '조치: 스페이스클라우드 달력에서 대상 예약 확인',
  ]);
}

function deleteSuccessMessage(row) {
  const deletedRows = (row.deleteTasks?.rows || []).filter((taskRow) => [
    'deleted',
    'already-gone',
  ].includes(taskRow.status));
  return compactNotice('✅ 성공: 스페이스클라우드 삭제', [
    `처리: ${deletedRows.length}건`,
    formatBriefRows(deletedRows),
    googleSummary(deletedRows),
  ]);
}

function naverBlockTaskSummary(task) {
  return {
    taskId: task.id || task.taskId || null,
    taskType: task.taskType || task.task_type || 'naver_block',
    roomKey: task.roomKey || task.room_key || '',
    date: task.date || task.reservation_date || '',
    startTime: task.startTime || task.start_time || '',
    endTime: task.endTime || task.end_time || '',
    reservationNo: task.reservationNo || task.reservation_number || '',
    reserverName: task.reserverName || task.reserver_name || '',
    product: task.product || '',
  };
}

function naverBlockSuccessMessage(row) {
  const processed = (row.naverBlockTasks?.rows || []).filter((taskRow) => [
    'blocked',
    'already-blocked',
    'google-recorded',
    'calendar-record-warning',
  ].includes(taskRow.status));
  return compactNotice('✅ 성공: 네이버 예약불가 반영', [
    `처리: ${processed.length}건`,
    formatBriefRows(processed),
    googleSummary(processed),
  ]);
}

function naverBlockFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  const allGoogle = rows.length && rows.every((row) => row.status === 'google-create-failed');
  return compactNotice(allGoogle ? '⚠️ 실패: 구글 달력 기록' : '⚠️ 실패: 네이버 예약불가 반영', [
    `상태: ${allGoogle ? '구글 기록 재시도 예정' : '자동 처리 중지'}`,
    `대상: ${rows.length || '-'}건`,
    formatBriefRows(rows),
    `원인: ${firstFailureReason(rowOrError)}`,
    '기준: 네이버 예약 우선',
  ]);
}

function naverRestoreSuccessMessage(row) {
  const processed = (row.naverRestoreTasks?.rows || []).filter((taskRow) => [
    'restored',
    'already-available',
    'restore-skipped-not-owned',
    'calendar-record-warning',
  ].includes(taskRow.status));
  return compactNotice('✅ 성공: 네이버 예약가능 복구', [
    `처리: ${processed.length}건`,
    formatBriefRows(processed),
    googleSummary(processed),
  ]);
}

function naverRestoreFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  const allGoogle = rows.length && rows.every((row) => row.status === 'google-delete-failed');
  return compactNotice(allGoogle ? '⚠️ 실패: 구글 달력 삭제' : '⚠️ 실패: 네이버 예약가능 복구', [
    `상태: ${allGoogle ? '구글 삭제 재시도 예정' : '자동 처리 중지'}`,
    `대상: ${rows.length || '-'}건`,
    formatBriefRows(rows),
    `원인: ${firstFailureReason(rowOrError)}`,
  ]);
}

function smsSuccessMessage(rows) {
  return compactNotice('✅ 성공: 예약확정 문자 발송', [
    `처리: ${rows.length}건`,
    formatSmsRows(rows),
  ]);
}

function smsFailureMessage(rows) {
  return compactNotice('⚠️ 실패: 예약확정 문자', [
    `대상: ${rows.length}건`,
    formatSmsRows(rows),
    '조치: 전화번호 조회 또는 카페24 문자 발송결과 확인',
  ]);
}

function cycleErrorMessage(errorText, { transient = false } = {}) {
  return compactNotice(transient ? '⚠️ 주의: 카페24 연결 재시도' : '⚠️ 실패: 자동화 감시 중지', [
    `상태: ${transient ? '일시 연결 오류, 다음 주기 자동 재시도' : '감시 주기 오류로 중지'}`,
    `원인: ${cleanTelegramText(errorText || '-', 180)}`,
    `조치: ${transient ? '자동 재시도 중, 반복되면 네트워크/카페24 확인' : '로그 확인 후 재시작'}`,
  ]);
}

function dbStatusForDeleteRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'deleted') return 'done';
  if (row.status === 'already-gone') return 'already_gone';
  if (row.status === 'google-delete-failed') return 'google_pending';
  if (row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForUploadRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'google-recorded') return 'done';
  if (row.status === 'submitted' || row.status === 'calendar-record-warning') return 'done';
  if (row.status === 'google-create-failed') return 'google_pending';
  if (row.status === 'google-conflict' || row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForNaverBlockRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'blocked' || row.status === 'already-blocked' || row.status === 'google-recorded') return 'done';
  if (row.status === 'calendar-record-warning') return 'done';
  if (row.status === 'google-create-failed') return 'google_pending';
  if (row.status === 'google-conflict') return 'needs_review';
  if (row.status === 'naver-conflict' || row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForNaverRestoreRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip' || row.status === 'restore-skipped-not-owned') return 'done';
  if (row.status === 'restored' || row.status === 'already-available') return 'done';
  if (row.status === 'calendar-record-warning') return 'done';
  if (row.status === 'google-delete-failed') return 'google_pending';
  if (row.status === 'needs-review' || row.status === 'naver-conflict') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  return 'failed';
}

function basicTaskSummary(task) {
  return {
    taskId: task.id || task.taskId || null,
    taskType: task.taskType || task.task_type || '',
    roomKey: task.roomKey || task.room_key || '',
    date: task.date || task.reservation_date || '',
    startTime: task.startTime || task.start_time || '',
    endTime: task.endTime || task.end_time || '',
    reservationNo: task.reservationNo || task.reservation_number || '',
    reserverName: task.reserverName || task.reserver_name || '',
    product: task.product || '',
    ledgerStatus: task.ledgerStatus || task.ledger_status || '',
    ledgerId: task.ledgerId || task.ledger_id || null,
    ledgerKey: task.ledgerKey || task.ledger_key || '',
    ledgerLastEventAt: task.ledgerLastEventAt || task.ledger_last_event_at || '',
  };
}

function expectedLedgerStatus(taskType) {
  if (taskType === 'upload' || taskType === 'naver_block') return 'confirmed';
  if (taskType === 'delete' || taskType === 'naver_restore') return 'canceled';
  return '';
}

function staleLedgerSkipRow(task, taskType) {
  const expected = expectedLedgerStatus(taskType);
  return {
    ...basicTaskSummary(task),
    taskType,
    status: 'stale-ledger-skip',
    expectedLedgerStatus: expected,
    actualLedgerStatus: task.ledgerStatus || '',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason: `ledger status is ${task.ledgerStatus || 'missing'}; expected ${expected}`,
  };
}

function missingLedgerNeedsReviewRow(task, taskType) {
  const expected = expectedLedgerStatus(taskType);
  return {
    ...basicTaskSummary(task),
    taskType,
    status: 'missing-ledger-needs-review',
    expectedLedgerStatus: expected,
    actualLedgerStatus: '',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason: `booking ledger is missing; expected ${expected}`,
  };
}

function staleRunningNeedsReviewRow(task, taskType) {
  let previousResult = {};
  try {
    previousResult = JSON.parse(task.resultText || '{}');
  } catch {
    previousResult = {};
  }
  const error = 'stale running task was not retried automatically to avoid duplicate platform side effects';
  return {
    ...basicTaskSummary(task),
    taskType,
    status: 'stale-running-needs-review',
    previousStatus: task.status || '',
    previousResultStatus: previousResult.status || '',
    attempts: task.attempts ?? null,
    lockedAt: task.lockedAt || '',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason: error,
    error,
  };
}

function ledgerIssueForTask(task, taskType) {
  const expected = expectedLedgerStatus(taskType);
  if (!expected) return null;
  if (!task.ledgerStatus) return 'missing';
  if (task.ledgerStatus !== expected) return 'stale';
  return null;
}

function ledgerIssueRow(task, taskType, issue) {
  if (issue === 'missing') return missingLedgerNeedsReviewRow(task, taskType);
  if (issue === 'stale') return staleLedgerSkipRow(task, taskType);
  return null;
}

function restoreSkippedNotOwnedRow(task) {
  return {
    ...basicTaskSummary(task),
    taskType: 'naver_restore',
    status: 'restore-skipped-not-owned',
    priorNaverBlockTaskId: task.priorNaverBlockTaskId || null,
    priorNaverBlockStatus: task.priorNaverBlockStatus || '',
    priorNaverBlockChanged: !!task.priorNaverBlockChanged,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason: 'automatic restore skipped because no prior automation-owned Naver block was found',
  };
}

function setCalendarWarning(row, label, value) {
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value || {});
  row.calendarRecordWarning = `${label}: ${text}`.slice(0, 900);
}

function applyCalendarCreateResult(row, result, label) {
  row.googleCalendar = result;
  if (['created', 'existing'].includes(result?.status)) return 'google-recorded';
  setCalendarWarning(row, label, result);
  if (result?.status === 'conflict') return 'google-conflict';
  row.error = row.error || row.calendarRecordWarning;
  return 'google-create-failed';
}

function applyCalendarDeleteResult(row, result, label) {
  row.googleCalendar = result;
  if (result?.status === 'deleted') return 'google-deleted';
  if (result?.status === 'not_found') {
    setCalendarWarning(row, label, result);
    return 'google-deleted';
  }
  setCalendarWarning(row, label, result);
  row.error = row.error || row.calendarRecordWarning;
  return 'google-delete-failed';
}

function applyCalendarCreateError(row, label, error) {
  row.error = String(error?.message || error);
  setCalendarWarning(row, label, row.error);
  return 'google-create-failed';
}

function applyCalendarDeleteError(row, label, error) {
  row.error = String(error?.message || error);
  setCalendarWarning(row, label, row.error);
  return 'google-delete-failed';
}

function isGoogleRetryableStatus(status) {
  return status === 'google-create-failed' || status === 'google-delete-failed';
}

function hasBlockingFailures(result) {
  return (result?.failed || []).some((row) => !isGoogleRetryableStatus(row.status));
}

async function sendNaverOriginConfirmationSms(args, context, task) {
  const lookup = await fetchNaverReservationPhone(context, task, {
    businessId: args.naverBusinessId,
  });
  if (lookup.status !== 'found') {
    return {
      status: 'skipped',
      reason: lookup.reason || lookup.status || 'naver-phone-lookup-failed',
      source: lookup.source || 'naver',
      maskedPhone: lookup.maskedPhone || '',
    };
  }
  return sendRemoteConfirmationSms(args, {
    task,
    phone: lookup.phone,
    source: lookup.source || 'naver',
  });
}

async function sendSpacecloudOriginConfirmationSms(args, context, task) {
  const lookup = await fetchSpacecloudReservationPhone(context, task);
  if (lookup.status !== 'found') {
    return {
      status: 'skipped',
      reason: lookup.reason || lookup.status || 'spacecloud-phone-lookup-failed',
      source: lookup.source || 'spacecloud',
      maskedPhone: lookup.maskedPhone || '',
    };
  }
  return sendRemoteConfirmationSms(args, {
    task,
    phone: lookup.phone,
    source: lookup.source || 'spacecloud',
  });
}

async function runSmsTest(args) {
  if (!args.smsTestTo) {
    throw new Error('sms-test requires --to <phone>');
  }
  const taskId = args.smsTestTaskId || String(Date.now());
  if (!/^\d+$/.test(String(taskId))) {
    throw new Error('--sms-test-task-id must be numeric');
  }
  const result = await sendRemoteConfirmationSms(args, {
    task: {
      id: taskId,
      taskType: args.smsTestTaskType || 'manual_sms_test',
    },
    phone: args.smsTestTo,
    source: 'manual-test',
  });
  return {
    ...result,
    taskType: args.smsTestTaskType || 'manual_sms_test',
    taskId,
  };
}

function smsSendOk(status) {
  return status === 'sent' || status === 'already_sent' || status === 'disabled';
}

function smsNeedsAttention(row) {
  return row?.sms && !smsSendOk(row.sms.status);
}

async function runUploadTasks(args, context = null) {
  if (args.dryRun) {
    return {
      status: 'upload-task-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = await fetchRemoteUploadTasks(args);
  if (tasks.length === 0) {
    return {
      status: 'no-upload-tasks',
      fetched: tasks.length,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }

  let ownedContext = null;
  const activeContext = context || await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  }).then((created) => {
    ownedContext = created;
    return created;
  });

  const rows = [];
  try {
    for (const task of tasks) {
      let row = null;
      try {
        if (task.status === 'running') {
          row = staleRunningNeedsReviewRow(task, 'upload');
        } else {
          const ledgerIssue = ledgerIssueForTask(task, 'upload');
          if (ledgerIssue) {
            row = ledgerIssueRow(task, 'upload', ledgerIssue);
          } else if (task.status === 'google_pending') {
            const event = spacecloudUploadEventFromTask(task);
            row = {
              taskId: task.id,
              fingerprint: event.fingerprint,
              sourceEventId: event.sourceEventId,
              reservationNo: event.reservationNo,
              roomKey: event.roomKey,
              date: event.date,
              startTime: event.startTime,
              endTime: event.endTime,
              reserverName: event.reserverName,
              status: 'google-pending',
              startedAt: new Date().toISOString(),
              spacecloudAlreadySubmitted: true,
            };
          } else {
            const event = spacecloudUploadEventFromTask(task);
            row = await uploadSpacecloudDirectReservation(activeContext, event);
            if (row.status === 'submitted') {
              const marked = markSubmittedRows(args, [row]);
              row.marked = marked;
              await updateRemoteTask(args, task.id, 'google_pending', JSON.stringify(row, null, 2));
            }
          }
        }

        if (['submitted', 'google-pending'].includes(row.status)) {
          let calendarStatus = 'google-recorded';
          try {
            const googleResult = await createRemoteGoogleEventForUploadTask(args, task.id);
            calendarStatus = applyCalendarCreateResult(row, googleResult, 'Google Calendar after-upload');
          } catch (error) {
            calendarStatus = applyCalendarCreateError(row, 'Google Calendar after-upload', error);
          }
          row.status = calendarStatus;
          row.finishedAt = new Date().toISOString();
          if (row.status === 'google-recorded') {
            try {
              row.sms = await sendNaverOriginConfirmationSms(args, activeContext, task);
            } catch (smsError) {
              row.sms = {
                status: 'failed',
                reason: 'sms-send-exception',
                error: String(smsError?.message || smsError),
              };
            }
          }
        }
      } catch (error) {
        row = row || {
          taskId: task.id,
          roomKey: task.roomKey || '',
          date: task.date || '',
          startTime: task.startTime || '',
          endTime: task.endTime || '',
          reservationNo: task.reservationNo || '',
          reserverName: task.reserverName || '',
          startedAt: new Date().toISOString(),
        };
        if (row.status === 'submitted') {
          row.status = applyCalendarCreateError(row, 'Google Calendar after-upload', error);
        } else {
          row.status = 'failed';
        }
        row.error = String(error?.message || error);
        row.finishedAt = new Date().toISOString();
      }

      rows.push(row);
      const status = dbStatusForUploadRow(row);
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && isLoginProblem(row.error)) {
        break;
      }
      if (status === 'failed' || status === 'needs_review') {
        break;
      }
      await sleep(800);
    }
  } finally {
    if (ownedContext) await ownedContext.close();
  }

  const failed = rows.filter((row) => ![
    'google-recorded',
    'submitted',
    'calendar-record-warning',
    'stale-ledger-skip',
  ].includes(row.status));
  return {
    status: failed.length ? 'upload-task-needs-review' : 'upload-task-processed',
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
  };
}

async function runDeleteTasks(args, context = null) {
  if (args.dryRun) {
    return {
      status: 'delete-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = await fetchRemoteDeleteTasks(args);
  if (tasks.length === 0) {
    return {
      status: 'no-delete-tasks',
      fetched: tasks.length,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }

  let ownedContext = null;
  const activeContext = context || await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  }).then((created) => {
    ownedContext = created;
    return created;
  });

  const rows = [];
  try {
    for (const task of tasks) {
      let row;
      if (task.status === 'running') {
        row = staleRunningNeedsReviewRow(task, 'delete');
      } else {
        const ledgerIssue = ledgerIssueForTask(task, 'delete');
        if (ledgerIssue) {
          row = ledgerIssueRow(task, 'delete', ledgerIssue);
        } else if (task.status === 'google_pending') {
          row = {
            taskId: task.id || null,
            roomKey: task.roomKey || task.room_key,
            date: task.date || task.reservation_date,
            startTime: task.startTime || task.start_time,
            endTime: task.endTime || task.end_time,
            reserverName: task.reserverName || task.reserver_name || '',
            reservationNo: task.reservationNo || task.reservation_number || '',
            status: 'google-delete-pending',
            startedAt: new Date().toISOString(),
            spacecloudAlreadyDeleted: true,
          };
        } else {
          row = await deleteSpacecloudDirectReservation(activeContext, task);
          if (['deleted', 'already-gone'].includes(row.status)) {
            await updateRemoteTask(args, task.id, 'google_pending', JSON.stringify(row, null, 2));
          }
        }
      }

      if (['deleted', 'already-gone', 'google-delete-pending'].includes(row.status)) {
        const spacecloudStatus = row.status === 'google-delete-pending' ? 'deleted' : row.status;
        let calendarStatus = 'google-deleted';
        try {
          const googleResult = await deleteRemoteGoogleEventForDeleteTask(args, task.id);
          calendarStatus = applyCalendarDeleteResult(row, googleResult, 'Google Calendar after-delete');
        } catch (error) {
          calendarStatus = applyCalendarDeleteError(row, 'Google Calendar after-delete', error);
        }
        row.spacecloudStatus = spacecloudStatus;
        row.status = calendarStatus === 'google-deleted' ? spacecloudStatus : calendarStatus;
        row.finishedAt = new Date().toISOString();
      }

      rows.push(row);
      const status = dbStatusForDeleteRow(row);
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && isLoginProblem(row.error)) {
        break;
      }
      if (status === 'failed' || status === 'needs_review') {
        break;
      }
      await sleep(800);
    }
  } finally {
    if (ownedContext) await ownedContext.close();
  }

  const failed = rows.filter((row) => ![
    'deleted',
    'already-gone',
    'stale-ledger-skip',
  ].includes(row.status));
  return {
    status: failed.length ? 'delete-needs-review' : 'delete-processed',
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
  };
}

async function runNaverBlockTasks(args, context = null) {
  if (args.dryRun) {
    return {
      status: 'naver-block-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = await fetchRemoteNaverBlockTasks(args);
  if (tasks.length === 0) {
    return {
      status: 'no-naver-block-tasks',
      fetched: tasks.length,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }

  let ownedContext = null;
  const activeContext = context || await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  }).then((created) => {
    ownedContext = created;
    return created;
  });

  const rows = [];
  try {
    for (const task of tasks) {
      let row;
      if (task.status === 'running') {
        row = staleRunningNeedsReviewRow(task, 'naver_block');
      } else {
        const ledgerIssue = ledgerIssueForTask(task, 'naver_block');
        if (ledgerIssue) {
          row = ledgerIssueRow(task, 'naver_block', ledgerIssue);
        } else if (task.status === 'google_pending') {
          row = {
            ...naverBlockTaskSummary(task),
            status: 'google-pending',
            startedAt: new Date().toISOString(),
            naverAlreadyApplied: true,
          };
          let calendarStatus = 'google-recorded';
          try {
            const googleResult = await createRemoteGoogleEventForNaverBlockTask(args, task.id);
            calendarStatus = applyCalendarCreateResult(row, googleResult, 'Google Calendar after-naver-block');
          } catch (error) {
            calendarStatus = applyCalendarCreateError(row, 'Google Calendar after-naver-block', error);
          }
          row.status = calendarStatus;
          row.finishedAt = new Date().toISOString();
        } else {
          row = await setNaverAvailability(activeContext, task, {
            businessId: args.naverBusinessId,
            targetStatus: 'unavailable',
          });
          if (['blocked', 'already-blocked'].includes(row.status)) {
            let calendarStatus = 'google-recorded';
            try {
              const googleResult = await createRemoteGoogleEventForNaverBlockTask(args, task.id);
              calendarStatus = applyCalendarCreateResult(row, googleResult, 'Google Calendar after-naver-block');
            } catch (error) {
              calendarStatus = applyCalendarCreateError(row, 'Google Calendar after-naver-block', error);
            }
            row.naverStatus = row.status;
            row.status = calendarStatus === 'google-recorded' ? row.naverStatus : calendarStatus;
          }
        }
      }
      rows.push(row);
      const status = dbStatusForNaverBlockRow(row);
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && isLoginProblem(row.error)) {
        break;
      }
      if (status === 'failed' || status === 'needs_review') {
        break;
      }
      await sleep(800);
    }
  } finally {
    if (ownedContext) await ownedContext.close();
  }

  const failed = rows.filter((row) => ![
    'blocked',
    'already-blocked',
    'google-recorded',
    'calendar-record-warning',
    'stale-ledger-skip',
  ].includes(row.status));
  return {
    status: failed.length ? 'naver-block-needs-review' : 'naver-block-processed',
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
  };
}

function splitNaverAvailabilityResult(result) {
  const blockRows = (result.rows || []).filter((row) => row.taskType !== 'naver_restore');
  const restoreRows = (result.rows || []).filter((row) => row.taskType === 'naver_restore');
  const blockFailed = (result.failed || []).filter((row) => row.taskType !== 'naver_restore');
  const restoreFailed = (result.failed || []).filter((row) => row.taskType === 'naver_restore');
  return {
    naverBlockTasks: {
      status: blockFailed.length ? 'naver-block-needs-review' : 'naver-block-processed',
      fetched: blockRows.length,
      attempted: blockRows.length,
      rows: blockRows,
      failed: blockFailed,
    },
    naverRestoreTasks: {
      status: restoreFailed.length ? 'naver-restore-needs-review' : 'naver-restore-processed',
      fetched: restoreRows.length,
      attempted: restoreRows.length,
      rows: restoreRows,
      failed: restoreFailed,
    },
  };
}

async function runNaverAvailabilityTasks(args, context = null) {
  if (args.dryRun) {
    return {
      status: 'naver-availability-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = await fetchRemoteNaverAvailabilityTasks(args);
  if (tasks.length === 0) {
    return {
      status: 'no-naver-availability-tasks',
      fetched: tasks.length,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }

  let ownedContext = null;
  const activeContext = context || await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  }).then((created) => {
    ownedContext = created;
    return created;
  });

  const rows = [];
  try {
    for (const task of tasks) {
      const taskType = task.taskType || 'naver_block';
      let row;
      if (task.status === 'running') {
        row = staleRunningNeedsReviewRow(task, taskType);
      } else {
        const ledgerIssue = ledgerIssueForTask(task, taskType);
        if (ledgerIssue) {
          row = ledgerIssueRow(task, taskType, ledgerIssue);
        } else if (taskType === 'naver_restore') {
          if (task.status === 'google_pending') {
            row = {
              ...naverBlockTaskSummary(task),
              taskType,
              status: 'google-delete-pending',
              startedAt: new Date().toISOString(),
              naverAlreadyRestored: true,
            };
          } else if (task.priorNaverBlockChanged !== true) {
            row = restoreSkippedNotOwnedRow(task);
          } else {
            row = await setNaverAvailability(activeContext, task, {
              businessId: args.naverBusinessId,
              targetStatus: 'available',
            });
            row.taskType = taskType;
            if (['restored', 'already-available'].includes(row.status)) {
              await updateRemoteTask(args, task.id, 'google_pending', JSON.stringify(row, null, 2));
            }
          }

          if (['restored', 'already-available', 'restore-skipped-not-owned', 'google-delete-pending'].includes(row.status)) {
            const naverStatus = row.status === 'google-delete-pending' ? 'restored' : row.status;
            let calendarStatus = 'google-deleted';
            try {
              const googleResult = await deleteRemoteGoogleEventForNaverRestoreTask(args, task.id);
              calendarStatus = applyCalendarDeleteResult(row, googleResult, 'Google Calendar after-naver-restore');
            } catch (error) {
              calendarStatus = applyCalendarDeleteError(row, 'Google Calendar after-naver-restore', error);
            }
            row.naverStatus = naverStatus;
            row.status = calendarStatus === 'google-deleted' ? naverStatus : calendarStatus;
            row.finishedAt = new Date().toISOString();
          }
        } else {
          if (task.status === 'google_pending') {
            row = {
              ...naverBlockTaskSummary(task),
              taskType,
              status: 'google-pending',
              startedAt: new Date().toISOString(),
              naverAlreadyApplied: true,
            };
            let calendarStatus = 'google-recorded';
            try {
              const googleResult = await createRemoteGoogleEventForNaverBlockTask(args, task.id);
              calendarStatus = applyCalendarCreateResult(row, googleResult, 'Google Calendar after-naver-block');
            } catch (error) {
              calendarStatus = applyCalendarCreateError(row, 'Google Calendar after-naver-block', error);
            }
            row.status = calendarStatus;
            row.finishedAt = new Date().toISOString();
          } else {
            row = await setNaverAvailability(activeContext, task, {
              businessId: args.naverBusinessId,
              targetStatus: 'unavailable',
            });
            row.taskType = taskType;
            if (['blocked', 'already-blocked'].includes(row.status)) {
              let calendarStatus = 'google-recorded';
              try {
                const googleResult = await createRemoteGoogleEventForNaverBlockTask(args, task.id);
                calendarStatus = applyCalendarCreateResult(row, googleResult, 'Google Calendar after-naver-block');
              } catch (error) {
                calendarStatus = applyCalendarCreateError(row, 'Google Calendar after-naver-block', error);
              }
              row.naverStatus = row.status;
              row.status = calendarStatus === 'google-recorded' ? row.naverStatus : calendarStatus;
            }
          }
        }
      }

      if (taskType !== 'naver_restore' && ['blocked', 'already-blocked', 'google-recorded'].includes(row.status)) {
        try {
          row.sms = await sendSpacecloudOriginConfirmationSms(args, activeContext, task);
        } catch (smsError) {
          row.sms = {
            status: 'failed',
            reason: 'sms-send-exception',
            error: String(smsError?.message || smsError),
          };
        }
      }

      rows.push(row);
      const status = taskType === 'naver_restore'
        ? dbStatusForNaverRestoreRow(row)
        : dbStatusForNaverBlockRow(row);
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && isLoginProblem(row.error)) {
        break;
      }
      if (status === 'failed' || status === 'needs_review') {
        break;
      }
      await sleep(800);
    }
  } finally {
    if (ownedContext) await ownedContext.close();
  }

  const failed = rows.filter((row) => {
    if (row.taskType === 'naver_restore') {
      return ![
        'restored',
        'already-available',
        'restore-skipped-not-owned',
        'calendar-record-warning',
        'stale-ledger-skip',
      ].includes(row.status);
    }
    return ![
      'blocked',
      'already-blocked',
      'google-recorded',
      'calendar-record-warning',
      'stale-ledger-skip',
    ].includes(row.status);
  });
  return {
    status: failed.length ? 'naver-availability-needs-review' : 'naver-availability-processed',
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
  };
}

function runNodeJson(args) {
  const cp = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (cp.status !== 0) {
    throw new Error((cp.stderr || cp.stdout || `node exited ${cp.status}`).trim());
  }
  return JSON.parse(cp.stdout);
}

async function buildPlan(args, planPath) {
  const from = args.from || kstToday();
  const plan = runNodeJson([
    'tools/spacecloud-sync.mjs',
    'plan',
    '--config',
    args.config,
    '--state',
    args.state,
    '--from',
    from,
    '--days',
    String(args.days),
    '--rooms',
    args.rooms,
    '--json',
  ]);
  await writeJson(planPath, plan);
  return plan;
}

function markSubmittedRows(args, rows) {
  let marked = 0;
  const unique = new Set();
  for (const row of rows || []) {
    if (row.status !== 'submitted') continue;
    if (unique.has(row.fingerprint)) continue;
    unique.add(row.fingerprint);
    const cp = spawnSync(process.execPath, [
      'tools/spacecloud-sync.mjs',
      'mark-uploaded',
      '--state',
      args.state,
      '--fingerprint',
      row.fingerprint,
      '--source-event-id',
      row.sourceEventId || '',
      '--reservation-no',
      row.reservationNo || '',
      '--note',
      'spacecloud-watch',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    if (cp.status !== 0) {
      throw new Error((cp.stderr || cp.stdout || `mark-uploaded exited ${cp.status}`).trim());
    }
    marked += 1;
  }
  return marked;
}

async function readResults(resultsPath) {
  try {
    const value = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function runLogin(args) {
  const context = await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  });
  const page = context.pages()[0] || await context.newPage();
  const targetUrl = 'https://partner.spacecloud.kr/reservation-calendar?product=108674&space=66056';
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  logLine(`Chrome profile opened: ${args.profileDir}`);
  logLine('Log in manually. This command exits when the reservation add button is visible.');

  const deadline = Date.now() + 30 * 60 * 1000;
  let lastUrl = '';
  let postLoginNavigateAttempted = false;
  while (Date.now() < deadline) {
    const addCount = await page.locator('a._additionalReserveLayerOpen').filter({ visible: true }).count().catch(() => 0);
    if (addCount === 1) {
      const result = {
        ok: true,
        url: page.url(),
        title: await page.title().catch(() => ''),
        reason: '',
      };
      logLine('login check ok');
      await context.close();
      return result;
    }
    const currentUrl = page.url();

    // Do not navigate while the user is inside the Naver/SpaceCloud auth flow.
    // Restarting these URLs can invalidate the active OAuth token and force a new login page.
    const isAuthFlow = /nid\.naver\.com|partner\.spacecloud\.kr\/auth\//.test(currentUrl);
    if (
      !postLoginNavigateAttempted
      && !isAuthFlow
      && /partner\.spacecloud\.kr/.test(currentUrl)
      && !/reservation-calendar/.test(currentUrl)
    ) {
      postLoginNavigateAttempted = true;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      logLine(`waiting for login: ${currentUrl}`);
    }
    await sleep(5000);
  }

  await context.close();
  throw new Error('login check timed out after 30 minutes');
}

async function runCheckLogin(args) {
  const context = await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  });
  try {
    return await checkSpacecloudLogin(context);
  } finally {
    await context.close();
  }
}

async function runCheckNaverLogin(args) {
  const context = await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  });
  try {
    return await checkNaverSmartplaceLogin(context, {
      businessId: args.naverBusinessId,
    });
  } finally {
    await context.close();
  }
}

async function runCycle(args, context = null) {
  const workDir = args.workDir;
  const planPath = path.join(workDir, 'latest-plan.json');
  const resultsPath = path.join(workDir, 'results.json');
  const runLogPath = path.join(workDir, 'runs.jsonl');
  const plan = args.legacyCalendarPlan ? await buildPlan(args, planPath) : null;
  const cycle = {
    at: new Date().toISOString(),
    mode: args.legacyCalendarPlan ? 'db-queue-plus-legacy-calendar-plan' : 'db-queue',
    planPath: args.legacyCalendarPlan ? planPath : '',
    resultsPath: args.legacyCalendarPlan ? resultsPath : '',
    sourceGeneratedAt: plan?.source?.generatedAt || null,
    sourceEventsInRange: plan?.source?.eventCountInRange || 0,
    uploadCandidates: plan?.upload?.length || 0,
    skipped: plan?.skipped?.length || 0,
    dryRun: args.dryRun,
  };

  let ownedContext = null;
  let activeContext = context;
  const getContext = async () => {
    if (activeContext) return activeContext;
    activeContext = await openSpacecloudContext({
      profileDir: args.profileDir,
      headless: args.headless,
    });
    ownedContext = activeContext;
    return activeContext;
  };

  try {
    const row = {
      ...cycle,
      status: args.dryRun ? 'dry-run' : 'planned',
      attempted: 0,
      submittedInPlan: 0,
      remainingInPlan: plan?.upload?.length || 0,
      marked: 0,
      failed: [],
    };

    row.uploadTasks = await runUploadTasks(args, activeContext);
    if (['planned', 'dry-run'].includes(row.status) && row.uploadTasks.attempted > 0) {
      row.status = hasBlockingFailures(row.uploadTasks)
        ? 'upload-task-needs-review'
        : (row.uploadTasks.failed.length ? 'upload-task-google-pending' : 'upload-task-processed');
    }

    if (args.legacyCalendarPlan && !hasBlockingFailures(row.uploadTasks) && plan.upload.length > 0 && !args.dryRun) {
      const uploader = await createSpacecloudPlaywrightUploader({
        context: await getContext(),
        planPath,
        resultsPath,
      });
      const result = await uploader.runBatch(args.limitPerCycle);
      const allResults = await readResults(resultsPath);
      const marked = markSubmittedRows(args, allResults);
      const uploadedRows = (result.rows || []).filter((uploadRow) => uploadRow.status === 'submitted');
      row.status = result.failed?.length ? 'failed' : 'uploaded';
      row.attempted = result.attempted;
      row.submittedInPlan = result.submitted;
      row.remainingInPlan = result.remaining;
      row.marked = marked;
      row.failed = result.failed;
      row.uploadedRows = uploadedRows;
    }

    if (!row.failed?.length && !hasBlockingFailures(row.uploadTasks)) {
      row.deleteTasks = await runDeleteTasks(args, activeContext);
      if (['planned', 'dry-run'].includes(row.status) && row.deleteTasks.attempted > 0) {
        row.status = hasBlockingFailures(row.deleteTasks)
          ? 'delete-needs-review'
          : (row.deleteTasks.failed.length ? 'delete-google-pending' : 'delete-processed');
      }
    }

    if (!row.failed?.length && !hasBlockingFailures(row.uploadTasks) && !hasBlockingFailures(row.deleteTasks)) {
      row.naverAvailabilityTasks = await runNaverAvailabilityTasks(args, activeContext);
      const split = splitNaverAvailabilityResult(row.naverAvailabilityTasks);
      row.naverBlockTasks = split.naverBlockTasks;
      row.naverRestoreTasks = split.naverRestoreTasks;
      if (['planned', 'dry-run'].includes(row.status) && row.naverAvailabilityTasks.attempted > 0) {
        row.status = hasBlockingFailures(row.naverAvailabilityTasks)
          ? 'naver-availability-needs-review'
          : (row.naverAvailabilityTasks.failed.length ? 'naver-availability-google-pending' : 'naver-availability-processed');
      }
    }

    if (!args.legacyCalendarPlan && row.status === 'planned') {
      row.status = 'idle';
    }

    await appendJsonl(runLogPath, row);
    return row;
  } finally {
    if (ownedContext) await ownedContext.close();
  }
}

async function runWatch(args) {
  const context = await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  logLine(`watch started; interval=${args.intervalSeconds}s profile=${args.profileDir} mode=${args.legacyCalendarPlan ? 'db+legacy-calendar-plan' : 'db-queue'}`);
  try {
    while (!stopping) {
      try {
        const row = await runCycle(args, context);
        logLine(`cycle ${row.status}; candidates=${row.uploadCandidates}; attempted=${row.attempted || 0}; remaining=${row.remainingInPlan ?? 0}; uploadTasks=${row.uploadTasks?.attempted || 0}; deleteTasks=${row.deleteTasks?.attempted || 0}; naverBlockTasks=${row.naverBlockTasks?.attempted || 0}; naverRestoreTasks=${row.naverRestoreTasks?.attempted || 0}`);
        if (row.uploadedRows?.length || row.uploadTasks?.rows?.some((taskRow) => [
          'google-recorded',
          'submitted',
          'calendar-record-warning',
        ].includes(taskRow.status))) {
          const result = await sendTelegram(args, uploadSuccessMessage(row));
          const successCount = (row.uploadedRows?.length || 0)
            + (row.uploadTasks?.rows || []).filter((taskRow) => [
              'google-recorded',
              'submitted',
              'calendar-record-warning',
            ].includes(taskRow.status)).length;
          if (result.sent) logLine(`telegram sent: spacecloud-upload-success count=${successCount}`);
          else logLine(`telegram upload success skipped: ${result.reason}`);
        }
        if (row.naverBlockTasks?.rows?.some((taskRow) => [
          'blocked',
          'already-blocked',
          'google-recorded',
          'calendar-record-warning',
        ].includes(taskRow.status))) {
          const result = await sendTelegram(args, naverBlockSuccessMessage(row));
          if (result.sent) logLine(`telegram sent: naver-block-success count=${row.naverBlockTasks.rows.length}`);
          else logLine(`telegram naver block success skipped: ${result.reason}`);
        }
        if (row.naverRestoreTasks?.rows?.some((taskRow) => [
          'restored',
          'already-available',
          'restore-skipped-not-owned',
          'calendar-record-warning',
        ].includes(taskRow.status))) {
          const result = await sendTelegram(args, naverRestoreSuccessMessage(row));
          if (result.sent) logLine(`telegram sent: naver-restore-success count=${row.naverRestoreTasks.rows.length}`);
          else logLine(`telegram naver restore success skipped: ${result.reason}`);
        }
        if (row.deleteTasks?.rows?.some((taskRow) => [
          'deleted',
          'already-gone',
        ].includes(taskRow.status))) {
          const result = await sendTelegram(args, deleteSuccessMessage(row));
          if (result.sent) logLine(`telegram sent: spacecloud-delete-success count=${row.deleteTasks.rows.length}`);
          else logLine(`telegram delete success skipped: ${result.reason}`);
        }
        const smsRows = smsRowsFromCycle(row);
        const smsSuccessRows = smsRows.filter((taskRow) => ['sent', 'already_sent'].includes(taskRow.sms?.status));
        const smsFailureRows = smsRows.filter((taskRow) => smsNeedsAttention(taskRow));
        if (smsSuccessRows.length) {
          const result = await sendTelegram(args, smsSuccessMessage(smsSuccessRows));
          if (result.sent) logLine(`telegram sent: confirmation-sms-success count=${smsSuccessRows.length}`);
          else logLine(`telegram confirmation sms success skipped: ${result.reason}`);
        }
        if (smsFailureRows.length) {
          const result = await sendTelegram(args, smsFailureMessage(smsFailureRows));
          if (result.sent) logLine(`telegram sent: confirmation-sms-failed count=${smsFailureRows.length}`);
          else logLine(`telegram confirmation sms failure skipped: ${result.reason}`);
        }
        if (row.failed?.length) {
          const errorText = row.failed.map((failedRow) => failedRow.error).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(row));
            logLine(`login needed; waiting for manual login: ${JSON.stringify(row.failed)}`);
          } else {
            await notifyWithCooldown(args, 'spacecloud-upload-failed', uploadFailureMessage(row));
            logLine(`stopping after non-login failure: ${JSON.stringify(row.failed)}`);
            break;
          }
        }
        if (row.uploadTasks?.failed?.length) {
          const errorText = row.uploadTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(row.uploadTasks));
            logLine(`login needed during db upload; waiting for manual login: ${JSON.stringify(row.uploadTasks.failed)}`);
          } else if (row.uploadTasks.failed.every((failedRow) => failedRow.status === 'google-create-failed')) {
            await notifyWithCooldown(args, 'spacecloud-upload-google-pending', uploadTaskFailureMessage(row.uploadTasks), {
              cooldownSeconds: Math.min(args.notifyCooldownSeconds, 60 * 60),
            });
            logLine(`google calendar record pending after db upload; will retry: ${JSON.stringify(row.uploadTasks.failed)}`);
          } else {
            await notifyWithCooldown(args, 'spacecloud-upload-task-failed', uploadTaskFailureMessage(row.uploadTasks));
            logLine(`stopping after db upload failure: ${JSON.stringify(row.uploadTasks.failed)}`);
            break;
          }
        }
        if (row.deleteTasks?.failed?.length) {
          const errorText = row.deleteTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(row.deleteTasks));
            logLine(`login needed during delete; waiting for manual login: ${JSON.stringify(row.deleteTasks.failed)}`);
          } else if (row.deleteTasks.failed.every((failedRow) => failedRow.status === 'google-delete-failed')) {
            await notifyWithCooldown(args, 'spacecloud-delete-google-pending', deleteFailureMessage(row.deleteTasks), {
              cooldownSeconds: Math.min(args.notifyCooldownSeconds, 60 * 60),
            });
            logLine(`google calendar delete pending after spacecloud delete; will retry: ${JSON.stringify(row.deleteTasks.failed)}`);
          } else {
            await notifyWithCooldown(args, 'spacecloud-delete-failed', deleteFailureMessage(row.deleteTasks));
            logLine(`stopping after delete failure: ${JSON.stringify(row.deleteTasks.failed)}`);
            break;
          }
        }
        if (row.naverBlockTasks?.failed?.length) {
          const errorText = row.naverBlockTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(row.naverBlockTasks));
            logLine(`login needed during naver block; waiting for manual login: ${JSON.stringify(row.naverBlockTasks.failed)}`);
          } else if (row.naverBlockTasks.failed.every((failedRow) => failedRow.status === 'google-create-failed')) {
            await notifyWithCooldown(args, 'naver-block-google-pending', naverBlockFailureMessage(row.naverBlockTasks), {
              cooldownSeconds: Math.min(args.notifyCooldownSeconds, 60 * 60),
            });
            logLine(`google calendar record pending after naver block; will retry: ${JSON.stringify(row.naverBlockTasks.failed)}`);
          } else {
            await notifyWithCooldown(args, 'naver-block-failed', naverBlockFailureMessage(row.naverBlockTasks));
            logLine(`stopping after naver block failure: ${JSON.stringify(row.naverBlockTasks.failed)}`);
            break;
          }
        }
        if (row.naverRestoreTasks?.failed?.length) {
          const errorText = row.naverRestoreTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(row.naverRestoreTasks));
            logLine(`login needed during naver restore; waiting for manual login: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
          } else if (row.naverRestoreTasks.failed.every((failedRow) => failedRow.status === 'google-delete-failed')) {
            await notifyWithCooldown(args, 'naver-restore-google-pending', naverRestoreFailureMessage(row.naverRestoreTasks), {
              cooldownSeconds: Math.min(args.notifyCooldownSeconds, 60 * 60),
            });
            logLine(`google calendar delete pending after naver restore; will retry: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
          } else {
            await notifyWithCooldown(args, 'naver-restore-failed', naverRestoreFailureMessage(row.naverRestoreTasks));
            logLine(`stopping after naver restore failure: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
            break;
          }
        }
      } catch (error) {
        const errorRow = {
          at: new Date().toISOString(),
          status: 'error',
          error: String(error?.message || error),
        };
        await appendJsonl(path.join(args.workDir, 'runs.jsonl'), errorRow);
        logLine(`cycle error: ${errorRow.error}`);
        if (isLoginProblem(errorRow.error)) {
          await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(errorRow.error));
          logLine('login needed; waiting for manual login');
        } else if (isTransientRemoteProblem(errorRow.error)) {
          await notifyWithCooldown(args, 'spacecloud-cycle-error', cycleErrorMessage(errorRow.error, { transient: true }), {
            cooldownSeconds: Math.min(args.notifyCooldownSeconds, 60 * 60),
          });
          logLine('transient remote problem; will retry next cycle');
        } else {
          await notifyWithCooldown(args, 'spacecloud-cycle-error', cycleErrorMessage(errorRow.error));
          break;
        }
      }

      const waitUntil = Date.now() + args.intervalSeconds * 1000;
      while (!stopping && Date.now() < waitUntil) {
        await sleep(Math.min(1000, waitUntil - Date.now()));
      }
    }
  } finally {
    await context.close();
    logLine('watch stopped');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    console.log(usage());
    return;
  }

  await fs.mkdir(args.workDir, { recursive: true });
  await loadEnvFile(args.envFile);

  if (args.command === 'login') {
    const result = await runLogin(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'check-login') {
    const result = await runCheckLogin(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.ok ? 'SpaceCloud login OK' : `SpaceCloud login needed: ${result.reason}`);
    process.exitCode = result.ok ? 0 : 2;
    return;
  }

  if (args.command === 'check-naver-login') {
    const result = await runCheckNaverLogin(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.ok ? 'Naver SmartPlace login OK' : `Naver SmartPlace login needed: ${result.reason}`);
    process.exitCode = result.ok ? 0 : 2;
    return;
  }

  if (args.command === 'notify-test') {
    const result = await sendTelegram(args, `✅ 성공: 텔레그램 알림 테스트
${kstNowText()}

이 메시지가 보이면 성공 알림은 ✅ 성공, 실패/확인 필요 알림은 ⚠️ 실패로 전송됩니다.`);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.sent ? 'Telegram notification OK' : `Telegram notification skipped: ${result.reason}`);
    return;
  }

  if (args.command === 'sms-test') {
    const result = await runSmsTest(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${smsStatusText(result.status)}: ${result.maskedPhone || '-'} (${result.providerCode || result.reason || '-'})`);
    return;
  }

  if (args.command === 'once') {
    const result = await runCycle(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`cycle ${result.status}; candidates=${result.uploadCandidates}; attempted=${result.attempted || 0}; remaining=${result.remainingInPlan ?? 0}; uploadTasks=${result.uploadTasks?.attempted || 0}; deleteTasks=${result.deleteTasks?.attempted || 0}; naverBlockTasks=${result.naverBlockTasks?.attempted || 0}; naverRestoreTasks=${result.naverRestoreTasks?.attempted || 0}`);
    return;
  }

  if (args.command === 'watch') {
    await runWatch(args);
    return;
  }

  throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
