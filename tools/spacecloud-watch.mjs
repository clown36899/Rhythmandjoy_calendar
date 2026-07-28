#!/usr/bin/env node

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  cancelSpacecloudConfirmedReservation,
  checkSpacecloudLogin,
  createSpacecloudPlaywrightUploader,
  deleteSpacecloudDirectReservation,
  fetchSpacecloudReservationPhone,
  openSpacecloudContext,
  spacecloudUploadEventFromTask,
  uploadSpacecloudDirectReservation,
} from './spacecloud-playwright-uploader.mjs';
import {
  cancelNaverConfirmedReservation,
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
const DEFAULT_DAILY_RECONCILE_STATE_PATH = path.join(DEFAULT_WORK_DIR, 'daily-reconcile-state.json');
const DEFAULT_REFLECTION_AUDIT_STATE_PATH = path.join(DEFAULT_WORK_DIR, 'reflection-audit-state.json');
const DEFAULT_REFLECTION_AUDIT_INTERVAL_MINUTES = 30;
const CONFIRMATION_SMS_TEMPLATE_NAME = 'reservation-confirmed-v1';
const CONFIRMATION_SMS_TITLE = '리듬앤조이 연습실 예약 확정 안내문자';
const PRIOR_BOOKING_CANCEL_SMS_TEMPLATE_NAME = 'spacecloud-prior-booking-canceled-v1';
const PRIOR_BOOKING_CANCEL_SMS_TITLE = '리듬앤조이 연습실 예약취소 안내';
const DEFAULT_CONFIRMATION_INFO_URL = 'https://리듬앤조이일정표.com/info';
const TELEGRAM_LOG_HINT = '로그: 자동화 관리패널 또는 spacecloud-watch/launchd.log';
const CUSTOMER_RESERVATION_CANCELLATION_DISABLED = true;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function usage() {
  return `Usage:
  node tools/spacecloud-watch.mjs login [options]
  node tools/spacecloud-watch.mjs check-login [options]
  node tools/spacecloud-watch.mjs check-naver-login [options]
  node tools/spacecloud-watch.mjs notify-test [options]
  node tools/spacecloud-watch.mjs sms-test --to <phone> [options]
  node tools/spacecloud-watch.mjs now-mode-self-test
  node tools/spacecloud-watch.mjs reflection-audit [options]
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
  --daily-reconcile-hour <0-23>
                            Defaults to 5. Sends one daily DB health summary.
  --daily-reconcile-state <path>
                            Defaults to ${DEFAULT_DAILY_RECONCILE_STATE_PATH}.
  --no-daily-reconcile      Disable daily DB health summary.
  --reflection-audit-interval-minutes <n>
                            Defaults to ${DEFAULT_REFLECTION_AUDIT_INTERVAL_MINUTES}. Checks email ledger reflection.
  --reflection-audit-state <path>
                            Defaults to ${DEFAULT_REFLECTION_AUDIT_STATE_PATH}.
  --no-reflection-audit     Disable email-ledger reflection audit.
  --from <YYYY-MM-DD>       Defaults to today in KST.
  --days <n>                Defaults to 370.
  --rooms <keys>            Defaults to a,b,c,d,e.
  --interval-seconds <n>    Defaults to 30 for watch mode.
  --limit-per-cycle <n>     Defaults to 3.
  --delete-limit-per-cycle <n>
                            Defaults to 2.
  --naver-block-limit-per-cycle <n>
                            Defaults to 2.
  --naver-cancel-limit-per-cycle <n>
                            Defaults to 1.
  --spacecloud-cancel-limit-per-cycle <n>
                            Defaults to 1.
  --now-mode                Prioritize duplicate cancellation and near-time availability work.
  --urgent-window-minutes <n>
                            Defaults to 180.
  --urgent-interval-seconds <n>
                            Defaults to 15 in now-mode.
  --urgent-cooldown-seconds <n>
                            Defaults to 300 in now-mode.
  --restore-grace-seconds <n>
                            Defaults to 45 in now-mode.
  --session-check-interval-seconds <n>
                            Defaults to 180 in now-mode.
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
  --sms-test-source <source>
                            Optional source for sms-test links: naver or spacecloud.

Examples:
  node tools/spacecloud-watch.mjs login
  node tools/spacecloud-watch.mjs check-login
  node tools/spacecloud-watch.mjs check-naver-login
  node tools/spacecloud-watch.mjs notify-test
  node tools/spacecloud-watch.mjs sms-test --to 01000000000 --json
  node tools/spacecloud-watch.mjs sms-test --to 01000000000 --sms-test-source naver --json
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
    dailyReconcileHour: 5,
    dailyReconcileState: DEFAULT_DAILY_RECONCILE_STATE_PATH,
    dailyReconcile: true,
    reflectionAudit: true,
    reflectionAuditIntervalMinutes: DEFAULT_REFLECTION_AUDIT_INTERVAL_MINUTES,
    reflectionAuditState: DEFAULT_REFLECTION_AUDIT_STATE_PATH,
    days: 370,
    rooms: 'a,b,c,d,e',
    intervalSeconds: 30,
    limitPerCycle: 3,
    deleteLimitPerCycle: 2,
    naverBlockLimitPerCycle: 2,
    naverCancelLimitPerCycle: 1,
    spacecloudCancelLimitPerCycle: 1,
    nowMode: false,
    urgentWindowMinutes: 180,
    urgentIntervalSeconds: 15,
    urgentCooldownSeconds: 300,
    restoreGraceSeconds: 45,
    sessionCheckIntervalSeconds: 180,
    naverBusinessId: '1257912',
    legacyCalendarPlan: false,
    headless: false,
    dryRun: false,
    json: false,
    telegram: true,
    smsTestTo: '',
    smsTestTaskId: '',
    smsTestTaskType: 'manual_sms_test',
    smsTestSource: 'manual-test',
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
    if (arg === '--no-daily-reconcile') {
      args.dailyReconcile = false;
      continue;
    }
    if (arg === '--no-reflection-audit') {
      args.reflectionAudit = false;
      continue;
    }
    if (arg === '--legacy-calendar-plan') {
      args.legacyCalendarPlan = true;
      continue;
    }
    if (arg === '--now-mode') {
      args.nowMode = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;

    if ([
      'days',
      'interval-seconds',
      'limit-per-cycle',
      'delete-limit-per-cycle',
      'naver-block-limit-per-cycle',
      'naver-cancel-limit-per-cycle',
      'spacecloud-cancel-limit-per-cycle',
      'notify-cooldown-seconds',
      'urgent-window-minutes',
      'urgent-interval-seconds',
      'urgent-cooldown-seconds',
      'restore-grace-seconds',
      'session-check-interval-seconds',
      'reflection-audit-interval-minutes',
    ].includes(key)) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${arg} must be a positive integer`);
      args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = parsed;
    } else if (key === 'daily-reconcile-hour') {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) throw new Error(`${arg} must be 0-23`);
      args.dailyReconcileHour = parsed;
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
    } else if (key === 'daily-reconcile-state') {
      args.dailyReconcileState = next;
    } else if (key === 'reflection-audit-state') {
      args.reflectionAuditState = next;
    } else if (key === 'to') {
      args.smsTestTo = next;
    } else if (key === 'sms-test-task-id') {
      args.smsTestTaskId = next;
    } else if (key === 'sms-test-task-type') {
      args.smsTestTaskType = next;
    } else if (key === 'sms-test-source') {
      args.smsTestSource = next;
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

function confirmationPlatformCode(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'n' || normalized.includes('naver')) return 'n';
  if (normalized === 's' || normalized === 'sc' || normalized.includes('spacecloud')) return 's';
  return '';
}

function confirmationInfoUrl(source) {
  const platformCode = confirmationPlatformCode(source);
  return platformCode
    ? `${DEFAULT_CONFIRMATION_INFO_URL}?p=${platformCode}`
    : DEFAULT_CONFIRMATION_INFO_URL;
}

function confirmationSmsMessage(source = '') {
  return process.env.RHYTHMJOY_CONFIRMATION_SMS_MESSAGE || `${CONFIRMATION_SMS_TITLE}
비번, 정보확인: ${confirmationInfoUrl(source)}`;
}

function parseEventAt(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = new Date(normalized.includes('+') || normalized.endsWith('Z') ? normalized : `${normalized}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function receiptTimeText(value) {
  const date = parseEventAt(value);
  if (!date) return '--:--';
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

function elapsedText(laterValue, earlierValue) {
  const later = parseEventAt(laterValue);
  const earlier = parseEventAt(earlierValue);
  if (!later || !earlier) return '';
  const totalSeconds = Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}초 차이`;
  if (seconds === 0) return `${minutes}분 차이`;
  return `${minutes}분 ${seconds}초 차이`;
}

function reservationSmsTimeText(task) {
  const date = String(task.date || task.reservation_date || '').trim();
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const month = dateMatch?.[2] || '';
  const day = dateMatch?.[3] || '';
  const dateText = month && day ? `${Number(month)}/${Number(day)}` : date || '-';
  const room = String(task.roomKey || task.room_key || '').toUpperCase();
  const start = task.startTime || task.start_time || '-';
  const end = displayEndTime(start, task.endTime || task.end_time || '');
  return `${dateText} ${room}홀 ${start}-${end}`;
}

function platformLabel(value) {
  return {
    naver: '네이버',
    spacecloud: '스페이스클라우드',
    admin: '관리자',
    'google-backfill': '구글기록',
  }[value] || value || '선예약';
}

function priorBookingCancelSmsMessage(task) {
  const payload = payloadForTask(task);
  const winning = payload.winningBooking || {};
  const losing = payload.losingBooking || {};
  const winnerAt = winning.lastEventAt || winning.last_event_at || '';
  const loserAt = losing.lastEventAt || losing.last_event_at || task.ledgerLastEventAt || task.ledger_last_event_at || '';
  const winnerPlatform = platformLabel(winning.sourcePlatform || winning.source_platform);
  const elapsed = elapsedText(loserAt, winnerAt);
  const elapsedPart = elapsed ? ` (${elapsed})` : '';
  return [
    '예약 취소 안내',
    '리듬앤조이 연습실 예약이 선대관으로 취소되었습니다.',
    `예약내역 : ${reservationSmsTimeText(task)}`,
    `${winnerPlatform} 예약이 ${receiptTimeText(winnerAt)}에 먼저 접수되어 해당 예약은 취소 처리되었습니다.`,
    `고객님 예약 접수: ${receiptTimeText(loserAt)}${elapsedPart}`,
    '불편을 드려 죄송합니다. 다른 시간대로 재예약 부탁드립니다.',
  ].join('\n');
}

function safeSmsResult(result) {
  const safe = {
    status: result?.status || 'unknown',
    maskedPhone: result?.maskedPhone || '',
    templateName: result?.templateName || CONFIRMATION_SMS_TEMPLATE_NAME,
    provider: result?.provider || '',
    providerCode: result?.providerCode || result?.code || '',
    remaining: Number.isFinite(result?.remaining) ? result.remaining : result?.remaining ?? null,
  };
  if (result?.reason) safe.reason = result.reason;
  if (result?.error) safe.error = cleanTelegramText(result.error, 180);
  if (result?.deliveryId) safe.deliveryId = result.deliveryId;
  return safe;
}

async function sendRemoteSms(args, {
  task,
  phone,
  source,
  message,
  subject,
  templateName,
  enabled = true,
} = {}) {
  if (!enabled) {
    return { status: 'disabled', reason: 'sms-disabled', maskedPhone: '' };
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
    message: message || '',
    subject: subject || '',
    templateName: templateName || 'manual-sms-v1',
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
import aligo_sms

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
            result = aligo_sms.send_sms(
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
                'provider': result.get('provider') or 'aligo',
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

async function sendRemoteConfirmationSms(args, {
  task,
  phone,
  source,
} = {}) {
  return sendRemoteSms(args, {
    task,
    phone,
    source,
    message: confirmationSmsMessage(source),
    subject: process.env.RHYTHMJOY_CONFIRMATION_SMS_SUBJECT || CONFIRMATION_SMS_TITLE,
    templateName: CONFIRMATION_SMS_TEMPLATE_NAME,
    enabled: confirmationSmsEnabled(),
  });
}

async function sendPriorBookingCancellationSms(args, {
  task,
  phone,
} = {}) {
  const taskType = task.taskType || task.task_type || 'prior_booking_cancel';
  return sendRemoteSms(args, {
    task: {
      ...task,
      taskType,
    },
    phone,
    source: taskType === 'naver_cancel' ? 'naver-cancel' : 'spacecloud-cancel',
    message: priorBookingCancelSmsMessage(task),
    subject: process.env.RHYTHMJOY_PRIOR_BOOKING_CANCEL_SMS_SUBJECT || PRIOR_BOOKING_CANCEL_SMS_TITLE,
    templateName: PRIOR_BOOKING_CANCEL_SMS_TEMPLATE_NAME,
    enabled: String(process.env.RHYTHMJOY_PRIOR_BOOKING_CANCEL_SMS_ENABLED || '1').trim() !== '0',
  });
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
    if task_type in ('naver_block', 'naver_restore', 'spacecloud_cancel'):
        return 'spacecloud'
    if task_type == 'naver_cancel':
        return 'naver'
    return ''

def task_time_value(value):
    text = str(value or '')
    if len(text) == 5:
        return text + ':00'
    return text

def enrich_task_row(cur, row):
    payload = parse_payload(row)
    task_type = row.get('taskType') or ''
    source_platform = source_platform_for_task(task_type)
    calendar_key = payload.get('calendarKey') or payload.get('calendar_key') or payload.get('target_calendar') or ''
    row['ledgerStatus'] = ''
    row['ledgerId'] = None
    row['ledgerKey'] = ''
    row['ledgerLastEventAt'] = ''
    row['ledgerConfirmedEmailEventId'] = None
    row['ledgerCanceledEmailEventId'] = None
    if source_platform and calendar_key:
        ledger_key = importer.booking_ledger_key(source_platform, payload, calendar_key)
        row['ledgerKey'] = ledger_key
        cur.execute(
            """
            SELECT id, current_status,
                   confirmed_email_event_id, canceled_email_event_id,
                   CAST(last_event_at AS CHAR) AS last_event_at
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
            row['ledgerConfirmedEmailEventId'] = ledger.get('confirmed_email_event_id')
            row['ledgerCanceledEmailEventId'] = ledger.get('canceled_email_event_id')

    if task_type == 'naver_restore':
        row['priorNaverBlockChanged'] = False
        row['priorNaverBlockTaskId'] = None
        row['priorNaverBlockStatus'] = ''
        row['restoreSafeWithoutPriorBlock'] = False
        row['restoreActiveOverlapCount'] = 0
        row['restoreBlockingBookings'] = []
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
        cur.execute(
            """
            SELECT
                id,
                source_platform AS sourcePlatform,
                source_mode AS sourceMode,
                reservation_number AS reservationNumber,
                reserver_name AS reserverName,
                CAST(last_event_at AS CHAR) AS lastEventAt,
                CONCAT(LPAD(HOUR(start_time), 2, '0'), ':', LPAD(MINUTE(start_time), 2, '0')) AS startTime,
                CONCAT(LPAD(HOUR(end_time), 2, '0'), ':', LPAD(MINUTE(end_time), 2, '0')) AS endTime
            FROM rhythmjoy_booking_ledger
            WHERE current_status='confirmed'
              AND room_key=%s
              AND reservation_date=%s
              AND COALESCE(source_mode, '') <> 'admin-task-anchor'
              AND start_time < %s
              AND end_time > %s
            ORDER BY COALESCE(last_event_at, created_at, '9999-12-31 23:59:59') ASC, id ASC
            LIMIT 10
            """,
            (
                row.get('roomKey'),
                row.get('date'),
                task_time_value(row.get('endTime')),
                task_time_value(row.get('startTime')),
            ),
        )
        active_overlaps = cur.fetchall()
        row['restoreActiveOverlapCount'] = len(active_overlaps)
        row['restoreBlockingBookings'] = active_overlaps[:5]
        row['restoreSafeWithoutPriorBlock'] = len(active_overlaps) == 0
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
export RHYTHMJOY_NOW_MODE=${shellQuote(args.nowMode ? '1' : '0')}
export RHYTHMJOY_URGENT_WINDOW_MINUTES=${shellQuote(args.urgentWindowMinutes)}
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
                email_event_id AS emailEventId,
                status,
                room_key AS roomKey,
                reservation_number AS reservationNo,
                reserver_name AS reserverName,
                product,
                CAST(reservation_date AS CHAR) AS date,
                CONCAT(LPAD(HOUR(start_time), 2, '0'), ':', LPAD(MINUTE(start_time), 2, '0')) AS startTime,
                CONCAT(LPAD(HOUR(end_time), 2, '0'), ':', LPAD(MINUTE(end_time), 2, '0')) AS endTime,
                payload_json AS payloadJson,
                attempts,
                CAST(locked_at AS CHAR) AS lockedAt,
                CAST(created_at AS CHAR) AS createdAt,
                CAST(updated_at AS CHAR) AS updatedAt,
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
              CASE
                WHEN %s = '1'
                  AND reservation_date IS NOT NULL
                  AND start_time IS NOT NULL
                  AND TIMESTAMP(reservation_date, start_time) <= DATE_ADD(NOW(), INTERVAL %s MINUTE)
                THEN 0
                ELSE 1
              END,
              created_at ASC,
              id ASC
            LIMIT %s
            FOR UPDATE
            """,
            (
                os.environ['RHYTHMJOY_TASK_TYPE'],
                os.environ['RHYTHMJOY_TASK_TYPE'],
                os.environ.get('RHYTHMJOY_NOW_MODE', '0'),
                int(os.environ.get('RHYTHMJOY_URGENT_WINDOW_MINUTES', '180')),
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
export RHYTHMJOY_NOW_MODE=${shellQuote(args.nowMode ? '1' : '0')}
export RHYTHMJOY_URGENT_WINDOW_MINUTES=${shellQuote(args.urgentWindowMinutes)}
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
                email_event_id AS emailEventId,
                status,
                room_key AS roomKey,
                reservation_number AS reservationNo,
                reserver_name AS reserverName,
                product,
                CAST(reservation_date AS CHAR) AS date,
                CONCAT(LPAD(HOUR(start_time), 2, '0'), ':', LPAD(MINUTE(start_time), 2, '0')) AS startTime,
                CONCAT(LPAD(HOUR(end_time), 2, '0'), ':', LPAD(MINUTE(end_time), 2, '0')) AS endTime,
                payload_json AS payloadJson,
                attempts,
                CAST(locked_at AS CHAR) AS lockedAt,
                CAST(created_at AS CHAR) AS createdAt,
                CAST(updated_at AS CHAR) AS updatedAt,
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
              CASE
                WHEN %s = '1' AND task_type='naver_block' THEN 0
                WHEN %s = '1' AND task_type='naver_restore' THEN 2
                ELSE 1
              END,
              CASE
                WHEN %s = '1'
                  AND reservation_date IS NOT NULL
                  AND start_time IS NOT NULL
                  AND TIMESTAMP(reservation_date, start_time) <= DATE_ADD(NOW(), INTERVAL %s MINUTE)
                THEN 0
                ELSE 1
              END,
              created_at ASC,
              id ASC
            LIMIT %s
            FOR UPDATE
            """,
            [
                *task_types,
                os.environ.get('RHYTHMJOY_NOW_MODE', '0'),
                os.environ.get('RHYTHMJOY_NOW_MODE', '0'),
                os.environ.get('RHYTHMJOY_NOW_MODE', '0'),
                int(os.environ.get('RHYTHMJOY_URGENT_WINDOW_MINUTES', '180')),
                int(os.environ.get('TASK_LIMIT', '2')),
            ],
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

async function fetchRemoteSpacecloudCancelTasks(args) {
  return fetchRemoteTasks(args, {
    taskType: 'spacecloud_cancel',
    limit: args.spacecloudCancelLimitPerCycle,
  });
}

async function fetchRemoteNaverCancelTasks(args) {
  return fetchRemoteTasks(args, {
    taskType: 'naver_cancel',
    limit: args.naverCancelLimitPerCycle,
  });
}

async function createRemoteSpacecloudCancelTask(args, sourceTask, conflictRow) {
  if (CUSTOMER_RESERVATION_CANCELLATION_DISABLED) {
    throw new Error('customer reservation cancellation automation is disabled');
  }
  const target = await loadCafe24Target(args);
  const sourcePayload = payloadForTask(sourceTask);
  const losing = conflictRow.losingBooking || {};
  const winning = conflictRow.winningBooking || {};
  const reservationId = String(
    sourcePayload.spacecloud_reservation_id
    || sourcePayload.spacecloudReservationId
    || conflictRow.reservationId
    || ''
  ).trim();
  const payload = {
    ...sourcePayload,
    sourceTaskId: sourceTask.id || sourceTask.taskId || null,
    sourceTaskType: sourceTask.taskType || sourceTask.task_type || 'naver_block',
    source: 'spacecloud-later-reservation-conflict',
    action: 'cancel-spacecloud-confirmed-reservation',
    priorityRule: conflictRow.priorityRule || 'first-real-platform-confirmed-email-wins',
    winningBooking: winning,
    losingBooking: losing,
    spacecloud_reservation_id: reservationId,
    originalPayload: sourcePayload,
  };
  const insertPayload = Buffer.from(JSON.stringify({
    dedupeKey: `spacecloud_cancel|${sourceTask.id || sourceTask.taskId || ''}|${reservationId}`.slice(0, 96),
    emailEventId: sourceTask.emailEventId || sourceTask.email_event_id || null,
    roomKey: sourceTask.roomKey || sourceTask.room_key || losing.roomKey || losing.room_key || '',
    reservationNumber: reservationId,
    reserverName: sourceTask.reserverName || sourceTask.reserver_name || losing.reserverName || losing.reserver_name || '',
    product: sourceTask.product || losing.product || sourcePayload.product || '',
    date: sourceTask.date || sourceTask.reservation_date || losing.date || losing.reservation_date || '',
    startTime: sourceTask.startTime || sourceTask.start_time || losing.startTime || losing.start_time || '',
    endTime: sourceTask.endTime || sourceTask.end_time || losing.endTime || losing.end_time || '',
    payload,
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export SPACECLOUD_CANCEL_TASK_B64=${shellQuote(insertPayload)}
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

def none_if_empty(value):
    text = str(value or '').strip()
    return text or None

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
row = json.loads(base64.b64decode(os.environ['SPACECLOUD_CANCEL_TASK_B64']).decode('utf-8'))
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
        cur.execute(
            """
            INSERT INTO rhythmjoy_spacecloud_tasks (
                dedupe_key, email_event_id, task_type, status,
                room_key, reservation_number, reserver_name, product,
                reservation_date, start_time, end_time, payload_json,
                created_at, updated_at
            )
            VALUES (%s,%s,'spacecloud_cancel','pending',%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
            ON DUPLICATE KEY UPDATE
                status=IF(status IN ('done', 'needs_review', 'failed'), status, 'pending'),
                payload_json=VALUES(payload_json),
                updated_at=NOW()
            """,
            (
                row.get('dedupeKey'),
                row.get('emailEventId'),
                row.get('roomKey') or '',
                row.get('reservationNumber') or '',
                row.get('reserverName') or '',
                row.get('product') or '',
                none_if_empty(row.get('date')),
                none_if_empty(row.get('startTime')),
                none_if_empty(row.get('endTime')),
                json.dumps(row.get('payload') or {}, ensure_ascii=False, separators=(',', ':')),
            ),
        )
        cur.execute('SELECT id, status FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s LIMIT 1', (row.get('dedupeKey'),))
        saved = cur.fetchone() or {}
    print(json.dumps({'id': saved.get('id'), 'status': saved.get('status'), 'dedupeKey': row.get('dedupeKey')}, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '{}');
}

async function createRemoteNaverCancelTask(args, sourceTask, conflictRow) {
  if (CUSTOMER_RESERVATION_CANCELLATION_DISABLED) {
    throw new Error('customer reservation cancellation automation is disabled');
  }
  const target = await loadCafe24Target(args);
  const sourcePayload = payloadForTask(sourceTask);
  const losing = conflictRow.losingBooking || {};
  const winning = conflictRow.winningBooking || {};
  const reservationNo = String(
    sourceTask.reservationNo
    || sourceTask.reservation_number
    || sourcePayload.reservation_number
    || sourcePayload.reservationNo
    || losing.reservationNumber
    || losing.reservation_number
    || ''
  ).trim();
  const payload = {
    ...sourcePayload,
    sourceTaskId: sourceTask.id || sourceTask.taskId || null,
    sourceTaskType: sourceTask.taskType || sourceTask.task_type || 'upload',
    source: 'naver-later-reservation-conflict',
    action: 'cancel-naver-confirmed-reservation',
    priorityRule: conflictRow.priorityRule || 'first-real-platform-confirmed-email-wins',
    winningBooking: winning,
    losingBooking: losing,
    originalPayload: sourcePayload,
  };
  const insertPayload = Buffer.from(JSON.stringify({
    dedupeKey: `naver_cancel|${sourceTask.id || sourceTask.taskId || ''}|${reservationNo}`.slice(0, 96),
    emailEventId: sourceTask.emailEventId || sourceTask.email_event_id || null,
    roomKey: sourceTask.roomKey || sourceTask.room_key || losing.roomKey || losing.room_key || '',
    reservationNumber: reservationNo,
    reserverName: sourceTask.reserverName || sourceTask.reserver_name || losing.reserverName || losing.reserver_name || '',
    product: sourceTask.product || losing.product || sourcePayload.product || '',
    date: sourceTask.date || sourceTask.reservation_date || losing.date || losing.reservation_date || '',
    startTime: sourceTask.startTime || sourceTask.start_time || losing.startTime || losing.start_time || '',
    endTime: sourceTask.endTime || sourceTask.end_time || losing.endTime || losing.end_time || '',
    payload,
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export NAVER_CANCEL_TASK_B64=${shellQuote(insertPayload)}
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

def none_if_empty(value):
    text = str(value or '').strip()
    return text or None

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
row = json.loads(base64.b64decode(os.environ['NAVER_CANCEL_TASK_B64']).decode('utf-8'))
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
        cur.execute(
            """
            INSERT INTO rhythmjoy_spacecloud_tasks (
                dedupe_key, email_event_id, task_type, status,
                room_key, reservation_number, reserver_name, product,
                reservation_date, start_time, end_time, payload_json,
                created_at, updated_at
            )
            VALUES (%s,%s,'naver_cancel','pending',%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
            ON DUPLICATE KEY UPDATE
                status=IF(status IN ('done', 'needs_review', 'failed'), status, 'pending'),
                payload_json=VALUES(payload_json),
                updated_at=NOW()
            """,
            (
                row.get('dedupeKey'),
                row.get('emailEventId'),
                row.get('roomKey') or '',
                row.get('reservationNumber') or '',
                row.get('reserverName') or '',
                row.get('product') or '',
                none_if_empty(row.get('date')),
                none_if_empty(row.get('startTime')),
                none_if_empty(row.get('endTime')),
                json.dumps(row.get('payload') or {}, ensure_ascii=False, separators=(',', ':')),
            ),
        )
        cur.execute('SELECT id, status FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s LIMIT 1', (row.get('dedupeKey'),))
        saved = cur.fetchone() or {}
    print(json.dumps({'id': saved.get('id'), 'status': saved.get('status'), 'dedupeKey': row.get('dedupeKey')}, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '{}');
}

function shortenResultString(value, maxLength = 220) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function compactCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  return {
    index: candidate.index,
    cellIndex: candidate.cellIndex,
    dateScopeMethod: candidate.dateScopeMethod,
    text: shortenResultString(candidate.text || candidate.visibleText || '', 120),
    className: candidate.className,
    directHint: Boolean(candidate.directHint),
  };
}

function compactTaskResultObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const row = { ...value };

  if (row.candidateSearch && typeof row.candidateSearch === 'object') {
    row.candidateSearch = {
      waitedMs: row.candidateSearch.waitedMs,
      dayCellText: shortenResultString(row.candidateSearch.dayCellText, 180),
      dateScope: row.candidateSearch.dateScope,
      candidates: (row.candidateSearch.candidates || []).slice(0, 8).map(compactCandidate),
    };
  }
  if (Array.isArray(row.candidates)) row.candidates = row.candidates.slice(0, 8).map(compactCandidate);
  if (row.selectedCandidate) row.selectedCandidate = compactCandidate(row.selectedCandidate);
  if (row.ignoredCandidates) row.ignoredCandidates = row.ignoredCandidates.slice(0, 8).map(compactCandidate);
  if (row.remaining) row.remaining = row.remaining.slice(0, 8).map(compactCandidate);
  if (row.remainingNonDirectCandidates) row.remainingNonDirectCandidates = row.remainingNonDirectCandidates.slice(0, 8).map(compactCandidate);
  if (row.remainingSearch && typeof row.remainingSearch === 'object') {
    row.remainingSearch = {
      waitedMs: row.remainingSearch.waitedMs,
      dayCellText: shortenResultString(row.remainingSearch.dayCellText, 180),
      dateScope: row.remainingSearch.dateScope,
      candidates: (row.remainingSearch.candidates || []).slice(0, 8).map(compactCandidate),
    };
  }
  if (Array.isArray(row.deleteCandidateAttempts)) {
    row.deleteCandidateAttempts = row.deleteCandidateAttempts.slice(0, 8).map((attempt) => ({
      candidate: compactCandidate(attempt.candidate),
      status: attempt.status,
      error: shortenResultString(attempt.error, 180),
      popupTextPreview: shortenResultString(attempt.popupTextPreview, 220),
      verification: attempt.verification,
    }));
  }
  if (row.popupTextPreview) row.popupTextPreview = shortenResultString(row.popupTextPreview, 260);
  if (row.textPreview) row.textPreview = shortenResultString(row.textPreview, 260);
  if (row.error) row.error = shortenResultString(row.error, 500);

  return row;
}

function taskResultTextForDb(resultText, maxLength = 4000) {
  const raw = String(resultText || '');
  if (!raw) return '';
  try {
    const compacted = compactTaskResultObject(JSON.parse(raw));
    const compactText = JSON.stringify(compacted, null, 2);
    if (compactText.length <= maxLength) return compactText;
    const summaryText = JSON.stringify({
      status: compacted.status || '',
      taskId: compacted.taskId || null,
      taskType: compacted.taskType || '',
      roomKey: compacted.roomKey || '',
      date: compacted.date || '',
      startTime: compacted.startTime || '',
      endTime: compacted.endTime || '',
      reserverName: compacted.reserverName || '',
      reservationNo: compacted.reservationNo || compacted.reservationId || '',
      error: shortenResultString(compacted.error, 500),
      resultSummary: 'result compacted to keep valid JSON in DB',
      deleteVerification: compacted.deleteVerification,
      selectedCandidate: compacted.selectedCandidate,
      candidateSearch: compacted.candidateSearch,
    }, null, 2);
    if (summaryText.length <= maxLength) return summaryText;
    return JSON.stringify({
      status: compacted.status || '',
      taskId: compacted.taskId || null,
      taskType: compacted.taskType || '',
      roomKey: compacted.roomKey || '',
      date: compacted.date || '',
      startTime: compacted.startTime || '',
      endTime: compacted.endTime || '',
      reservationNo: compacted.reservationNo || compacted.reservationId || '',
      error: shortenResultString(compacted.error, 500),
      resultSummary: 'result compacted to keep valid JSON in DB',
    }, null, 2);
  } catch {
    return JSON.stringify({
      status: '',
      resultSummary: 'non-json result compacted to keep valid JSON in DB',
      rawPreview: shortenResultString(raw, 1000),
    }, null, 2);
  }
}

async function updateRemoteTask(args, taskId, status, resultText) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({
    taskId,
    status,
    resultText: taskResultTextForDb(resultText),
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

async function updateRemoteAdminSessions(args, sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return { updated: 0 };
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify(sessions.map((session) => ({
    platform: session.platform,
    status: session.status,
    note: String(session.note || '').slice(0, 240),
  }))), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export SESSION_UPDATE_B64=${shellQuote(payload)}
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
payload = json.loads(base64.b64decode(os.environ['SESSION_UPDATE_B64']).decode('utf-8'))
allowed_platforms = {'naver', 'spacecloud'}
allowed_statuses = {'ready', 'login_required', 'check_failed', 'checking', 'needs_check'}
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
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rhythmjoy_admin_sessions (
                platform VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'needs_check',
                ready_at DATETIME NULL,
                last_checked_at DATETIME NULL,
                note VARCHAR(255) NOT NULL DEFAULT '',
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (platform)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        updated = 0
        for row in payload:
            platform = str(row.get('platform') or '').strip()
            if platform not in allowed_platforms:
                continue
            status = str(row.get('status') or '').strip()
            if status not in allowed_statuses:
                status = 'check_failed'
            note = str(row.get('note') or '')[:255]
            cur.execute(
                """
                INSERT INTO rhythmjoy_admin_sessions (platform, status, ready_at, last_checked_at, note, updated_at)
                VALUES (%s, %s, IF(%s='ready', NOW(), NULL), NOW(), %s, NOW())
                ON DUPLICATE KEY UPDATE
                    status=VALUES(status),
                    ready_at=IF(VALUES(status)='ready', NOW(), NULL),
                    last_checked_at=NOW(),
                    note=VALUES(note),
                    updated_at=NOW()
                """,
                (platform, status, status, note),
            )
            updated += cur.rowcount
        print(json.dumps({'updated': updated}, ensure_ascii=False))
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
import re
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

    existing_by_details = importer.find_calendar_event_by_details(service, calendar_key, event_data, logger)
    if existing_by_details:
        private = existing_by_details.get('extendedProperties', {}).get('private', {})
        description = existing_by_details.get('description', '')
        match = re.search(r'예약번호\\s*[:：]?\\s*(\\d{7,})', description)
        existing_number = str(private.get('reservationNumber') or (match.group(1) if match else ''))
        replace_stale = False
        if reservation_number and existing_number and existing_number != reservation_number:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) AS active_count
                    FROM rhythmjoy_booking_ledger
                    WHERE reservation_number=%s
                      AND current_status='confirmed'
                    """,
                    (existing_number,),
                )
                replace_stale = int((cur.fetchone() or {}).get('active_count') or 0) == 0
        if replace_stale:
            service.events().delete(
                calendarId=importer.CALENDAR_IDS[calendar_key],
                eventId=existing_by_details.get('id'),
            ).execute()
            created = importer.create_calendar_event(
                service,
                event_data,
                logger,
                dedupe_google_calendar=False,
            )
            if task.get('email_event_id'):
                importer.update_email_processing(
                    config,
                    task['email_event_id'],
                    f'{status_prefix}_replaced',
                    logger,
                    google_calendar_event_id=created.get('id', ''),
                    error_text='',
                )
            print(json.dumps({
                'status': 'replaced',
                'eventId': created.get('id', ''),
                'replacedEventId': existing_by_details.get('id', ''),
                'replacedReservationNumber': existing_number,
            }, ensure_ascii=False))
            raise SystemExit(0)
        print(json.dumps({
            'status': 'conflict',
            'error': 'same slot belongs to another active or unidentifiable Google event',
            'eventId': existing_by_details.get('id', ''),
            'existingReservationNumber': existing_number,
        }, ensure_ascii=False))
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
  const suffix = '\n...\n관리패널에서 확인';
  return `${normalized.slice(0, Math.max(0, limit - suffix.length))}${suffix}`;
}

function maskChatId(value) {
  const text = String(value || '');
  if (text.length <= 6) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

function telegramDeliverySummary(result) {
  if (!result?.sent) return result?.reason || 'not-sent';
  const parts = [];
  if (result.messageId) parts.push(`message_id=${result.messageId}`);
  if (result.chatId) parts.push(`chat=${maskChatId(result.chatId)}`);
  if (result.chatType) parts.push(`type=${result.chatType}`);
  if (result.chatName) parts.push(`name=${result.chatName}`);
  return parts.join(' ') || 'accepted';
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
    const body = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`telegram http ${response.status}: ${body.slice(0, 160)}`);
    }
    let data = null;
    try {
      data = body ? JSON.parse(body) : null;
    } catch {
      data = null;
    }
    if (data && data.ok === false) {
      throw new Error(`telegram api rejected: ${JSON.stringify(data).slice(0, 180)}`);
    }
    const messageResult = data?.result || {};
    const chat = messageResult.chat || {};
    const result = {
      sent: true,
      reason: '',
      messageId: messageResult.message_id || null,
      chatId: chat.id ? String(chat.id) : String(chatId),
      chatType: chat.type || '',
      chatName: chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() || '',
    };
    logLine(`telegram accepted: ${telegramDeliverySummary(result)}`);
    return result;
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
    if (result.sent) logLine(`telegram sent: ${key} ${telegramDeliverySummary(result)}`);
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

function kstDateHour() {
  const shifted = new Date(Date.now() + KST_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`,
    hour: shifted.getUTCHours(),
  };
}

async function fetchRemoteDailyReconcile(args) {
  const target = await loadCafe24Target(args);
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
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

def table_exists(cur, name):
    cur.execute("SHOW TABLES LIKE %s", (name,))
    return cur.fetchone() is not None

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
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
out = {'ok': True, 'sessions': [], 'taskSummary': [], 'attention': {}, 'amounts': {}, 'reflectionAudit': {}}
with conn:
    with conn.cursor() as cur:
        if table_exists(cur, 'rhythmjoy_admin_sessions'):
            cur.execute("""
                SELECT platform, status, CAST(last_checked_at AS CHAR) AS lastCheckedAt,
                       CAST(updated_at AS CHAR) AS updatedAt, note
                FROM rhythmjoy_admin_sessions
                ORDER BY platform
            """)
            out['sessions'] = cur.fetchall()
        if table_exists(cur, 'rhythmjoy_spacecloud_tasks'):
            cur.execute("""
                SELECT task_type AS taskType, status, COUNT(*) AS cnt
                FROM rhythmjoy_spacecloud_tasks
                WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
                GROUP BY task_type, status
                ORDER BY task_type, status
            """)
            out['taskSummary'] = cur.fetchall()
            cur.execute("""
                SELECT
                  SUM(status IN ('pending','running','claimed')) AS pending,
                  SUM(status IN ('failed','needs_review','needs-review') AND updated_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) AS recentFailed,
                  SUM(status IN ('failed','needs_review','needs-review') AND updated_at < DATE_SUB(NOW(), INTERVAL 1 DAY)) AS archivedFailed,
                  SUM(task_type IN ('naver_block','naver_restore','spacecloud_cancel','naver_cancel') AND status IN ('pending','running','claimed')) AS urgentPending
                FROM rhythmjoy_spacecloud_tasks
            """)
            out['attention'] = cur.fetchone() or {}
        if table_exists(cur, 'rhythmjoy_booking_ledger'):
            cur.execute("""
                SELECT
                  SUM(CASE WHEN reservation_date >= CURDATE() AND current_status <> 'canceled' AND COALESCE(gross_amount, 0)=0 THEN 1 ELSE 0 END) AS futureMissingAmount,
                  SUM(CASE WHEN reservation_date = CURDATE() AND current_status <> 'canceled' THEN 1 ELSE 0 END) AS todayReservations,
                  SUM(CASE WHEN reservation_date = CURDATE() AND current_status <> 'canceled' THEN COALESCE(gross_amount, price, 0) ELSE 0 END) AS todayGross,
                  SUM(CASE WHEN reservation_date = CURDATE() AND current_status <> 'canceled' THEN COALESCE(net_amount, 0) ELSE 0 END) AS todayNet
                FROM rhythmjoy_booking_ledger
                WHERE COALESCE(source_mode, '') <> 'admin-task-anchor'
            """)
            out['amounts'] = cur.fetchone() or {}
        if table_exists(cur, 'rhythmjoy_reflection_audits'):
            cur.execute("""
                SELECT
                  SUM(audit_status='issue') AS issues,
                  SUM(audit_status='waiting') AS waiting,
                  SUM(audit_status='ok') AS okCount,
                  MAX(checked_at) AS lastCheckedAt
                FROM rhythmjoy_reflection_audits
                WHERE checked_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
            """)
            out['reflectionAudit'] = cur.fetchone() or {}
print(json.dumps(out, ensure_ascii=False, default=str))
PY
`;
  const stdout = runSshScript(target, script);
  return JSON.parse(stdout);
}

function dailyReconcileMessage(data) {
  const sessions = (data.sessions || []).map((row) => {
    const label = row.platform === 'naver' ? '네이버' : row.platform === 'spacecloud' ? 'SC' : row.platform;
    const ok = /ready|ok|logged_in/i.test(String(row.status || ''));
    return `${ok ? '✅' : '⚠️'} ${label}: ${row.status || 'unknown'}${row.lastCheckedAt ? ` (${row.lastCheckedAt.slice(5, 16)})` : ''}`;
  });
  const attention = data.attention || {};
  const amounts = data.amounts || {};
  const reflection = data.reflectionAudit || {};
  const recentFailed = Number(attention.recentFailed ?? attention.failed ?? 0);
  const archivedFailed = Number(attention.archivedFailed || 0);
  const taskLines = (data.taskSummary || [])
    .filter((row) => Number(row.cnt || 0) > 0)
    .slice(0, 8)
    .map((row) => `- ${row.taskType}/${row.status}: ${Number(row.cnt || 0).toLocaleString()}건`);
  const archivedLine = archivedFailed
    ? `과거 실패기록 ${archivedFailed.toLocaleString()}건은 현재 반영검사 정상 시 보관값`
    : '';
  return [
    '✅ 자동화 일일 점검',
    new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    '',
    sessions.length ? sessions.join('\n') : '세션: 기록 없음',
    '',
    `대기 ${Number(attention.pending || 0).toLocaleString()}건 / 최근실패 ${recentFailed.toLocaleString()}건 / 긴급대기 ${Number(attention.urgentPending || 0).toLocaleString()}건`,
    `오늘 예약 ${Number(amounts.todayReservations || 0).toLocaleString()}건 / 결제 ${Number(amounts.todayGross || 0).toLocaleString()}원 / 정산 ${Number(amounts.todayNet || 0).toLocaleString()}원`,
    `미래 금액 미수집 ${Number(amounts.futureMissingAmount || 0).toLocaleString()}건`,
    `반영검사 문제 ${Number(reflection.issues || 0).toLocaleString()}건 / 대기 ${Number(reflection.waiting || 0).toLocaleString()}건${reflection.lastCheckedAt ? ` / ${String(reflection.lastCheckedAt).slice(5, 16)}` : ''}`,
    archivedLine,
    taskLines.length ? `\n최근 24시간 작업\n${taskLines.join('\n')}` : '',
    TELEGRAM_LOG_HINT,
  ].filter(Boolean).join('\n');
}

async function maybeSendDailyReconcile(args) {
  if (!args.dailyReconcile || !args.telegram) return;
  const now = kstDateHour();
  if (now.hour < args.dailyReconcileHour) return;
  const state = await readJsonObject(args.dailyReconcileState);
  if (state.lastSentDate === now.date) return;
  try {
    const data = await fetchRemoteDailyReconcile(args);
    const result = await sendTelegram(args, dailyReconcileMessage(data));
    await writeJson(args.dailyReconcileState, {
      lastSentDate: now.date,
      lastAttemptAt: new Date().toISOString(),
      result,
    });
    if (result.sent) logLine('telegram sent: daily-reconcile');
  } catch (error) {
    logLine(`daily reconcile failed: ${String(error?.message || error)}`);
  }
}

async function fetchRemoteReflectionAudit(args) {
  const target = await loadCafe24Target(args);
  const graceMinutes = Number.parseInt(process.env.RHYTHMJOY_REFLECTION_AUDIT_GRACE_MINUTES || '10', 10);
  const pastDays = Number.parseInt(process.env.RHYTHMJOY_REFLECTION_AUDIT_PAST_DAYS || '3', 10);
  const futureDays = Number.parseInt(process.env.RHYTHMJOY_REFLECTION_AUDIT_FUTURE_DAYS || '120', 10);
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export REFLECTION_AUDIT_GRACE_MINUTES=${shellQuote(Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : 10)}
export REFLECTION_AUDIT_PAST_DAYS=${shellQuote(Number.isFinite(pastDays) && pastDays >= 0 ? pastDays : 3)}
export REFLECTION_AUDIT_FUTURE_DAYS=${shellQuote(Number.isFinite(futureDays) && futureDays > 0 ? futureDays : 120)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
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

def table_exists(cur, name):
    cur.execute("SHOW TABLES LIKE %s", (name,))
    return cur.fetchone() is not None

def short_time(value):
    text = str(value or '')
    if len(text) >= 5:
        return text[:5]
    return ''

def display_end(start, end):
    if end == '00:00' and start and start != '00:00':
        return '24:00'
    return end or '-'

def mask_name(name):
    text = str(name or '').strip()
    if not text:
        return ''
    if len(text) <= 2:
        return text[0] + '*'
    return text[0] + ('*' * max(1, len(text) - 2)) + text[-1]

def platform_label(value):
    return {'naver': '네이버', 'spacecloud': '스페이스클라우드'}.get(value or '', value or '-')

def ensure_schema(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rhythmjoy_reflection_audits (
            audit_key VARCHAR(180) NOT NULL,
            ledger_id BIGINT UNSIGNED NULL,
            source_platform VARCHAR(32) NOT NULL DEFAULT '',
            target_platform VARCHAR(32) NOT NULL DEFAULT '',
            expected_task_type VARCHAR(32) NOT NULL DEFAULT '',
            current_status VARCHAR(32) NOT NULL DEFAULT '',
            audit_status VARCHAR(32) NOT NULL DEFAULT 'issue',
            severity VARCHAR(16) NOT NULL DEFAULT 'warning',
            reason VARCHAR(255) NOT NULL DEFAULT '',
            task_id BIGINT UNSIGNED NULL,
            task_status VARCHAR(32) NOT NULL DEFAULT '',
            reservation_date DATE NULL,
            room_key VARCHAR(8) NOT NULL DEFAULT '',
            start_time TIME NULL,
            end_time TIME NULL,
            reserver_name VARCHAR(128) NOT NULL DEFAULT '',
            reservation_number VARCHAR(64) NOT NULL DEFAULT '',
            checked_at DATETIME NOT NULL,
            first_seen_at DATETIME NOT NULL,
            resolved_at DATETIME NULL,
            detail_json TEXT NULL,
            PRIMARY KEY (audit_key),
            KEY idx_status (audit_status, severity),
            KEY idx_checked (checked_at),
            KEY idx_ledger (ledger_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

def expected_task(row):
    source = row.get('source_platform') or ''
    status = row.get('current_status') or ''
    if status == 'confirmed' and source == 'naver':
        event_id = row.get('confirmed_email_event_id')
        return {'task_type': 'upload', 'target_platform': 'spacecloud', 'event_id': event_id} if event_id else None
    if status == 'confirmed' and source == 'spacecloud':
        event_id = row.get('confirmed_email_event_id')
        return {'task_type': 'naver_block', 'target_platform': 'naver', 'event_id': event_id} if event_id else None
    return None

def latest_task(cur, event_id, task_type, row):
    if event_id:
        cur.execute("""
            SELECT id, status, attempts,
                   CAST(created_at AS CHAR) AS created_at,
                   CAST(updated_at AS CHAR) AS updated_at,
                   CAST(processed_at AS CHAR) AS processed_at,
                   TIMESTAMPDIFF(MINUTE, COALESCE(created_at, updated_at, NOW()), NOW()) AS age_minutes,
                   result_text
            FROM rhythmjoy_spacecloud_tasks
            WHERE email_event_id=%s AND task_type=%s
            ORDER BY CASE WHEN status IN ('done', 'google_pending') THEN 0 ELSE 1 END, id DESC
            LIMIT 1
        """, (event_id, task_type))
        found = cur.fetchone()
        if found:
            return found
    cur.execute("""
        SELECT id, status, attempts,
               CAST(created_at AS CHAR) AS created_at,
               CAST(updated_at AS CHAR) AS updated_at,
               CAST(processed_at AS CHAR) AS processed_at,
               TIMESTAMPDIFF(MINUTE, COALESCE(created_at, updated_at, NOW()), NOW()) AS age_minutes,
               result_text
        FROM rhythmjoy_spacecloud_tasks
        WHERE task_type=%s
          AND room_key=%s
          AND reservation_date=%s
          AND start_time=%s
          AND end_time=%s
          AND (
              reservation_number=%s
              OR reserver_name=%s
          )
        ORDER BY CASE WHEN status IN ('done', 'google_pending') THEN 0 ELSE 1 END, id DESC
        LIMIT 1
    """, (
        task_type,
        row.get('room_key') or '',
        row.get('reservation_date'),
        row.get('start_time'),
        row.get('end_time'),
        row.get('reservation_number') or '',
        row.get('reserver_name') or '',
    ))
    return cur.fetchone()

def classify_task(task, row, expected, grace_minutes):
    task_type = expected['task_type']
    if not task:
        age = int(row.get('ledger_age_minutes') or 0)
        if age <= grace_minutes:
            return 'waiting', 'info', '원장 생성 직후라 반영 작업 생성 대기'
        return 'issue', 'critical', '반대 플랫폼 반영 작업이 없음'
    status = task.get('status') or ''
    if status in ('done', 'google_pending'):
        return 'ok', 'info', '반대 플랫폼 반영 완료'
    if status in ('pending', 'running', 'claimed'):
        age = int(task.get('age_minutes') or 0)
        if age <= grace_minutes:
            return 'waiting', 'info', '반영 작업 진행 대기'
        return 'issue', 'warning', f'반영 작업이 {age}분째 {status}'
    if status in ('failed', 'needs_review', 'needs-review'):
        return 'issue', 'critical', f'반영 작업 {status}'
    return 'issue', 'warning', f'알 수 없는 작업 상태 {status}'

def upsert_item(cur, item):
    cur.execute("""
        INSERT INTO rhythmjoy_reflection_audits (
            audit_key, ledger_id, source_platform, target_platform, expected_task_type,
            current_status, audit_status, severity, reason, task_id, task_status,
            reservation_date, room_key, start_time, end_time, reserver_name, reservation_number,
            checked_at, first_seen_at, resolved_at, detail_json
        ) VALUES (
            %(audit_key)s, %(ledger_id)s, %(source_platform)s, %(target_platform)s, %(expected_task_type)s,
            %(current_status)s, %(audit_status)s, %(severity)s, %(reason)s, %(task_id)s, %(task_status)s,
            %(reservation_date)s, %(room_key)s, %(start_time)s, %(end_time)s, %(reserver_name)s, %(reservation_number)s,
            NOW(), NOW(), %(resolved_at)s, %(detail_json)s
        )
        ON DUPLICATE KEY UPDATE
            ledger_id=VALUES(ledger_id),
            source_platform=VALUES(source_platform),
            target_platform=VALUES(target_platform),
            expected_task_type=VALUES(expected_task_type),
            current_status=VALUES(current_status),
            first_seen_at=IF(VALUES(audit_status)='ok', first_seen_at, IF(audit_status=VALUES(audit_status), first_seen_at, NOW())),
            audit_status=VALUES(audit_status),
            severity=VALUES(severity),
            reason=VALUES(reason),
            task_id=VALUES(task_id),
            task_status=VALUES(task_status),
            reservation_date=VALUES(reservation_date),
            room_key=VALUES(room_key),
            start_time=VALUES(start_time),
            end_time=VALUES(end_time),
            reserver_name=VALUES(reserver_name),
            reservation_number=VALUES(reservation_number),
            checked_at=NOW(),
            resolved_at=IF(VALUES(audit_status)='ok', NOW(), NULL),
            detail_json=VALUES(detail_json)
    """, item)

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
grace_minutes = int(os.environ.get('REFLECTION_AUDIT_GRACE_MINUTES', '10'))
past_days = int(os.environ.get('REFLECTION_AUDIT_PAST_DAYS', '3'))
future_days = int(os.environ.get('REFLECTION_AUDIT_FUTURE_DAYS', '120'))

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

out = {
    'ok': True,
    'checked': 0,
    'okCount': 0,
    'waitingCount': 0,
    'issueCount': 0,
    'duplicateCount': 0,
    'latestIssues': [],
    'latestWaiting': [],
}
seen_audit_keys = []

try:
    with conn.cursor() as cur:
        ensure_schema(cur)
        if not table_exists(cur, 'rhythmjoy_booking_ledger'):
            print(json.dumps({'ok': False, 'error': 'booking ledger table missing'}, ensure_ascii=False))
            raise SystemExit(0)

        cur.execute("""
            SELECT id, source_platform, source_mode, current_status, target_calendar, room_key,
                   reservation_number, reserver_name, reserver_name_key, product,
                   CAST(reservation_date AS CHAR) AS reservation_date,
                   CAST(start_time AS CHAR) AS start_time,
                   CAST(end_time AS CHAR) AS end_time,
                   confirmed_email_event_id, canceled_email_event_id,
                   CAST(last_event_at AS CHAR) AS last_event_at,
                   TIMESTAMPDIFF(MINUTE, COALESCE(last_event_at, created_at, updated_at, NOW()), NOW()) AS ledger_age_minutes
            FROM rhythmjoy_booking_ledger
            WHERE source_platform IN ('naver', 'spacecloud')
              AND current_status='confirmed'
              AND confirmed_email_event_id IS NOT NULL
              AND (
                    (source_platform='naver' AND COALESCE(source_mode, '')='')
                 OR (source_platform='spacecloud' AND COALESCE(source_mode, '')='spacecloud_email')
              )
              AND reservation_date BETWEEN DATE_SUB(CURDATE(), INTERVAL %s DAY)
                                      AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
            ORDER BY COALESCE(last_event_at, created_at, updated_at) DESC, id DESC
        """, (past_days, future_days))
        rows = cur.fetchall()

        for row in rows:
            expected = expected_task(row)
            if not expected:
                continue
            task = latest_task(cur, expected.get('event_id'), expected['task_type'], row)
            audit_status, severity, reason = classify_task(task, row, expected, grace_minutes)
            out['checked'] += 1
            if audit_status == 'ok':
                out['okCount'] += 1
            elif audit_status == 'waiting':
                out['waitingCount'] += 1
            else:
                out['issueCount'] += 1

            start = short_time(row.get('start_time'))
            end = short_time(row.get('end_time'))
            item = {
                'audit_key': f"ledger:{row.get('id')}:{expected['task_type']}",
                'ledger_id': row.get('id'),
                'source_platform': row.get('source_platform') or '',
                'target_platform': expected['target_platform'],
                'expected_task_type': expected['task_type'],
                'current_status': row.get('current_status') or '',
                'audit_status': audit_status,
                'severity': severity,
                'reason': reason[:255],
                'task_id': task.get('id') if task else None,
                'task_status': task.get('status') if task else '',
                'reservation_date': row.get('reservation_date'),
                'room_key': row.get('room_key') or '',
                'start_time': row.get('start_time'),
                'end_time': row.get('end_time'),
                'reserver_name': row.get('reserver_name') or '',
                'reservation_number': row.get('reservation_number') or '',
                'resolved_at': None,
                'detail_json': json.dumps({
                    'ledgerId': row.get('id'),
                    'source': row.get('source_platform'),
                    'target': expected['target_platform'],
                    'expectedTaskType': expected['task_type'],
                    'emailEventId': expected.get('event_id'),
                    'task': task,
                }, ensure_ascii=False, default=str),
            }
            seen_audit_keys.append(item['audit_key'])
            upsert_item(cur, item)

            view = {
                'ledgerId': row.get('id'),
                'sourcePlatform': row.get('source_platform') or '',
                'sourceLabel': platform_label(row.get('source_platform')),
                'targetPlatform': expected['target_platform'],
                'targetLabel': platform_label(expected['target_platform']),
                'taskType': expected['task_type'],
                'status': audit_status,
                'severity': severity,
                'reason': reason,
                'taskId': task.get('id') if task else None,
                'taskStatus': task.get('status') if task else '',
                'date': row.get('reservation_date'),
                'roomKey': (row.get('room_key') or '').upper(),
                'startTime': start,
                'endTime': display_end(start, end),
                'reserverNameMasked': mask_name(row.get('reserver_name')),
                'reservationNumber': row.get('reservation_number') or '',
            }
            if audit_status == 'issue' and len(out['latestIssues']) < 8:
                out['latestIssues'].append(view)
            elif audit_status == 'waiting' and len(out['latestWaiting']) < 5:
                out['latestWaiting'].append(view)

        cur.execute("""
            SELECT CAST(reservation_date AS CHAR) AS reservation_date, room_key,
                   CAST(start_time AS CHAR) AS start_time, CAST(end_time AS CHAR) AS end_time,
                   COUNT(*) AS cnt,
                   GROUP_CONCAT(CONCAT(id, ':', source_platform, ':', COALESCE(reservation_number, ''), ':', COALESCE(reserver_name, '')) ORDER BY COALESCE(last_event_at, created_at, updated_at), id SEPARATOR ' | ') AS rows_text
            FROM rhythmjoy_booking_ledger
            WHERE current_status='confirmed'
              AND confirmed_email_event_id IS NOT NULL
              AND (
                    (source_platform='naver' AND COALESCE(source_mode, '')='')
                 OR (source_platform='spacecloud' AND COALESCE(source_mode, '')='spacecloud_email')
              )
              AND reservation_date BETWEEN DATE_SUB(CURDATE(), INTERVAL %s DAY)
                                      AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
            GROUP BY reservation_date, room_key, start_time, end_time
            HAVING COUNT(*) > 1
            ORDER BY reservation_date ASC, start_time ASC, room_key ASC
            LIMIT 30
        """, (past_days, future_days))
        duplicates = cur.fetchall()
        out['duplicateCount'] = len(duplicates)
        for duplicate in duplicates:
            start = short_time(duplicate.get('start_time'))
            end = short_time(duplicate.get('end_time'))
            item = {
                'audit_key': f"duplicate:{duplicate.get('reservation_date')}:{duplicate.get('room_key')}:{start}:{end}",
                'ledger_id': None,
                'source_platform': 'ledger',
                'target_platform': 'ledger',
                'expected_task_type': 'dedupe',
                'current_status': 'confirmed',
                'audit_status': 'issue',
                'severity': 'critical',
                'reason': f"원장 확정 예약 중복 {duplicate.get('cnt')}건"[:255],
                'task_id': None,
                'task_status': '',
                'reservation_date': duplicate.get('reservation_date'),
                'room_key': duplicate.get('room_key') or '',
                'start_time': duplicate.get('start_time'),
                'end_time': duplicate.get('end_time'),
                'reserver_name': '',
                'reservation_number': '',
                'resolved_at': None,
                'detail_json': json.dumps(duplicate, ensure_ascii=False, default=str),
            }
            seen_audit_keys.append(item['audit_key'])
            upsert_item(cur, item)
            if len(out['latestIssues']) < 8:
                out['latestIssues'].append({
                    'sourceLabel': '원장',
                    'targetLabel': '원장',
                    'taskType': 'dedupe',
                    'status': 'issue',
                    'severity': 'critical',
                    'reason': item['reason'],
                    'date': duplicate.get('reservation_date'),
                    'roomKey': (duplicate.get('room_key') or '').upper(),
                    'startTime': start,
                    'endTime': display_end(start, end),
                    'reserverNameMasked': '',
                    'reservationNumber': '',
                })

        if seen_audit_keys:
            placeholders = ','.join(['%s'] * len(seen_audit_keys))
            cur.execute(f"""
                UPDATE rhythmjoy_reflection_audits
                SET audit_status='ok',
                    severity='info',
                    reason='이번 검사 대상 아님',
                    checked_at=NOW(),
                    resolved_at=NOW()
                WHERE audit_status <> 'ok'
                  AND audit_key NOT IN ({placeholders})
            """, seen_audit_keys)
        else:
            cur.execute("""
                UPDATE rhythmjoy_reflection_audits
                SET audit_status='ok',
                    severity='info',
                    reason='이번 검사 대상 아님',
                    checked_at=NOW(),
                    resolved_at=NOW()
                WHERE audit_status <> 'ok'
            """)

    conn.commit()
finally:
    conn.close()

print(json.dumps(out, ensure_ascii=False, default=str))
PY
`;
  const stdout = runSshScript(target, script);
  return JSON.parse(stdout.trim() || '{}');
}

function reflectionAuditLine(row, index) {
  const source = row.sourceLabel || row.sourcePlatform || '-';
  const target = row.targetLabel || row.targetPlatform || '-';
  const room = row.roomKey ? `${row.roomKey}홀` : '-';
  const name = row.reserverNameMasked ? ` / ${row.reserverNameMasked}` : '';
  const reservationNo = row.reservationNumber ? ` / ${row.reservationNumber}` : '';
  const task = row.taskId ? ` / 작업 #${row.taskId}` : '';
  return `${index + 1}. ${source}→${target} ${row.date || '-'} ${room} ${row.startTime || '-'}-${row.endTime || '-'}${name}${reservationNo}${task}\n   ${cleanTelegramText(row.reason || '-', 120)}`;
}

function reflectionAuditMessage(data) {
  const issues = data.latestIssues || [];
  const waiting = data.latestWaiting || [];
  return compactNotice('⚠️ 반영 정규검사 확인 필요', [
    `원장 기준 점검 ${Number(data.checked || 0).toLocaleString()}건 / 문제 ${Number(data.issueCount || 0).toLocaleString()}건 / 대기 ${Number(data.waitingCount || 0).toLocaleString()}건`,
    issues.length ? issues.map(reflectionAuditLine).join('\n') : '문제 상세 없음',
    waiting.length ? `\n대기 중\n${waiting.map(reflectionAuditLine).join('\n')}` : '',
    '기준: 이메일 원장 최종 확정 -> 반대 플랫폼 최종 반영',
  ]);
}

async function maybeSendReflectionAudit(args) {
  if (!args.reflectionAudit || !args.telegram) return;
  const intervalMs = Math.max(1, args.reflectionAuditIntervalMinutes || DEFAULT_REFLECTION_AUDIT_INTERVAL_MINUTES) * 60 * 1000;
  const state = await readJsonObject(args.reflectionAuditState);
  const lastCheckedAt = state.checkedAt ? new Date(state.checkedAt).getTime() : 0;
  if (lastCheckedAt && Date.now() - lastCheckedAt < intervalMs) return;

  try {
    const data = await fetchRemoteReflectionAudit(args);
    const issueKey = [
      data.issueCount || 0,
      data.duplicateCount || 0,
      ...(data.latestIssues || []).map((row) => [
        row.sourcePlatform,
        row.targetPlatform,
        row.date,
        row.roomKey,
        row.startTime,
        row.endTime,
        row.taskType,
        row.taskId,
        row.reason,
      ].join('|')),
    ].join('||');
    const nextState = {
      checkedAt: new Date().toISOString(),
      issueKey,
      summary: {
        checked: data.checked || 0,
        okCount: data.okCount || 0,
        waitingCount: data.waitingCount || 0,
        issueCount: data.issueCount || 0,
        duplicateCount: data.duplicateCount || 0,
      },
    };
    if (Number(data.issueCount || 0) > 0 || Number(data.duplicateCount || 0) > 0) {
      const cooldownSeconds = issueKey === state.issueKey ? Math.min(args.notifyCooldownSeconds, 60 * 60) : 0;
      const result = await notifyWithCooldown(args, `reflection-audit:${issueKey.slice(0, 120)}`, reflectionAuditMessage(data), {
        cooldownSeconds,
      });
      nextState.lastNotification = result;
      if (result.sent) logLine(`telegram sent: reflection-audit issues=${data.issueCount || 0}`);
    } else {
      logLine(`reflection audit ok: checked=${data.checked || 0} waiting=${data.waitingCount || 0}`);
    }
    await writeJson(args.reflectionAuditState, nextState);
  } catch (error) {
    await writeJson(args.reflectionAuditState, {
      checkedAt: new Date().toISOString(),
      error: String(error?.message || error),
    });
    logLine(`reflection audit failed: ${String(error?.message || error)}`);
  }
}

function isLoginProblem(message) {
  return /login|logged out|add button not visible|로그인|세션|인증/i.test(String(message || ''));
}

function isTransientRemoteProblem(message) {
  return /ssh failed|timed out|ETIMEDOUT|SIGKILL|Connection timed out|Connection reset|Connection closed by|Broken pipe/i.test(String(message || ''));
}

function isBrowserContextClosedProblem(message) {
  return /Target (?:page, context or browser|page|context|browser) has been closed/i.test(String(message || ''));
}

function isRetryablePlatformProblem(message) {
  return isBrowserContextClosedProblem(message)
    || /page\.goto|Timeout \d+ms exceeded|domcontentloaded|net::|ERR_|ECONNRESET|ETIMEDOUT|Connection reset|Connection closed|page load|navigation|modal still visible after submit|calendar title month not found/i.test(String(message || ''));
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
  const roomKey = String(row.roomKey || row.room_key || '').toUpperCase();
  const room = roomKey ? `${roomKey}홀` : '-';
  const name = maskTelegramName(row.reserverName || row.reserver_name || '');
  return cleanTelegramText(`${taskTimeText(row)} · ${room}${name ? ` · ${name}` : ''}`, 160);
}

function telegramStatusText(status) {
  const map = {
    blocked: '반영 성공',
    'already-blocked': '이미 반영됨',
    restored: '복구 성공',
    'already-available': '이미 예약가능',
    'restore-skipped-not-owned': '복구 생략',
    submitted: '등록 성공',
    created: '기록 완료',
    existing: '기존 기록 확인',
    deleted: '삭제 완료',
    not_found: '삭제 대상 없음',
    'already-gone': '이미 없음',
    'google-recorded': '구글 기록 완료',
    'calendar-record-warning': '구글 기록 경고',
    'google-create-failed': '구글 기록 재시도',
    'google-delete-failed': '구글 삭제 재시도',
    'naver-conflict': '네이버 충돌',
    'later-reservation-conflict': '후예약 취소 필요',
    'spacecloud-cancel-queued': '후예약 취소 대기',
    'naver-cancel-queued': '후예약 취소 대기',
    canceled: '취소 성공',
    'already-canceled': '이미 취소됨',
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

function notificationKeyForRows(prefix, rowOrError) {
  const row = firstProblemRow(rowOrError);
  const target = [
    row.taskId || row.id || '',
    row.roomKey || row.room_key || '',
    row.date || row.reservation_date || '',
    row.startTime || row.start_time || '',
    row.endTime || row.end_time || '',
  ].filter(Boolean).join('|');
  return target ? `${prefix}:${target}` : prefix;
}

function isLaterReservationConflictRow(row) {
  return row?.status === 'later-reservation-conflict';
}

function formatConflictBookingLine(label, booking) {
  if (!booking) return `${label}: -`;
  const platform = {
    naver: '네이버',
    spacecloud: '스페이스클라우드',
    admin: '관리자',
    'google-backfill': '구글기록',
  }[booking.sourcePlatform || booking.source_platform] || booking.sourcePlatform || booking.source_platform || '-';
  const reservationNo = booking.reservationNumber || booking.reservation_number || '';
  const name = booking.reserverName || booking.reserver_name || '-';
  const time = `${booking.date || booking.reservation_date || '-'} ${booking.startTime || booking.start_time || '-'}-${displayEndTime(booking.startTime || booking.start_time || '', booking.endTime || booking.end_time || '')}`;
  const room = booking.roomKey || booking.room_key || '-';
  const received = booking.lastEventAt || booking.last_event_at || booking.createdAt || booking.created_at || '-';
  return `${label}: ${platform} / ${room} / ${time} / ${name}${reservationNo ? ` / ${reservationNo}` : ''} / 접수 ${received}`;
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
    ...(row.uploadTasks?.rows || []).map((taskRow) => ({ ...taskRow, taskType: taskRow.taskType || 'upload' })),
    ...(row.naverBlockTasks?.rows || []).map((taskRow) => ({ ...taskRow, taskType: taskRow.taskType || 'naver_block' })),
    ...(row.naverAvailabilityTasks?.rows || []).map((taskRow) => ({ ...taskRow, taskType: taskRow.taskType || 'naver_restore' })),
    ...(row.naverCancelTasks?.rows || []).map((taskRow) => ({ ...taskRow, taskType: taskRow.taskType || 'naver_cancel' })),
    ...(row.spacecloudCancelTasks?.rows || []).map((taskRow) => ({ ...taskRow, taskType: taskRow.taskType || 'spacecloud_cancel' })),
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
    const provider = sms.provider ? `${sms.provider} ` : '';
    const reason = ['failed', 'skipped'].includes(sms.status)
      ? (sms.reason || sms.error || sms.providerCode || '')
      : '';
    return `${index + 1}. ${taskTargetText(row)} / ${sms.maskedPhone || '-'} (${provider}${smsStatusText(sms.status)}${reason ? `: ${cleanTelegramText(reason, 80)}` : ''})`;
  });
  if (rows.length > visible.length) lines.push(`외 ${rows.length - visible.length}건`);
  return lines.join('\n') || '-';
}

function taskIdentityKey(row, fallbackTaskType = '') {
  const taskType = row.taskType || row.task_type || fallbackTaskType || '';
  const id = row.taskId || row.id || row.task_id || '';
  if (id) return `${taskType}:${id}`;
  return [
    taskType,
    row.roomKey || row.room_key || '',
    row.date || row.reservation_date || '',
    row.startTime || row.start_time || '',
    row.endTime || row.end_time || '',
    row.reservationNo || row.reservation_number || '',
    row.reserverName || row.reserver_name || '',
  ].join('|');
}

function taskDateShort(row) {
  const date = String(row.date || row.reservation_date || '');
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date || '-';
  return `${Number(match[2])}/${Number(match[3])}`;
}

function maskTelegramName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const clean = raw.replace(/\s*님\s*$/, '').trim();
  if (!clean) return '';
  if (clean.includes('*')) return `${clean}님`;
  if (clean.length >= 3) return `${clean[0]}${'*'.repeat(clean.length - 2)}${clean[clean.length - 1]}님`;
  if (clean.length === 2) return `${clean[0]}*님`;
  return `${clean}님`;
}

function syncReservationLine(row) {
  const roomKey = String(row.roomKey || row.room_key || '').toUpperCase();
  const room = roomKey ? `${roomKey}홀` : '-';
  const startTime = row.startTime || row.start_time || '-';
  const endTime = displayEndTime(startTime, row.endTime || row.end_time || '');
  const name = maskTelegramName(row.reserverName || row.reserver_name || '');
  return [
    `${taskDateShort(row)} ${room} ${startTime}-${endTime}`,
    name,
  ].filter(Boolean).join(' · ');
}

function syncActionResultText(row) {
  const taskType = row.taskType || row.task_type || '';
  const status = row.status || '';
  if (taskType === 'upload') {
    if (['google-recorded', 'submitted', 'calendar-record-warning'].includes(status)) return 'SC 등록 완료';
    return `SC 등록 ${telegramStatusText(status)}`;
  }
  if (taskType === 'naver_block') {
    if (['blocked', 'already-blocked', 'google-recorded', 'calendar-record-warning'].includes(status)) return '네이버 예약불가 완료';
    return `네이버 예약불가 ${telegramStatusText(status)}`;
  }
  if (taskType === 'naver_restore') {
    if (status === 'restore-skipped-not-owned') return '네이버 복구 생략';
    if (['restored', 'already-available', 'calendar-record-warning'].includes(status)) return '네이버 예약가능 복구 완료';
    return `네이버 예약가능 ${telegramStatusText(status)}`;
  }
  if (taskType === 'delete') {
    if (['deleted', 'already-gone'].includes(status)) return 'SC 삭제 완료';
    return `SC 삭제 ${telegramStatusText(status)}`;
  }
  if (taskType === 'spacecloud_cancel') {
    if (['canceled', 'already-canceled'].includes(status)) return 'SC 후예약 취소 완료';
    return `SC 후예약 취소 ${telegramStatusText(status)}`;
  }
  if (taskType === 'naver_cancel') {
    if (['canceled', 'already-canceled'].includes(status)) return '네이버 후예약 취소 완료';
    return `네이버 후예약 취소 ${telegramStatusText(status)}`;
  }
  return telegramStatusText(status);
}

function syncGoogleStatusText(row) {
  if (row.calendarRecordWarning || row.status === 'calendar-record-warning') return '구글 기록 경고';
  const googleStatus = row.googleCalendar?.status
    || (row.status === 'google-recorded' ? 'created' : '')
    || (row.status === 'google-deleted' ? 'deleted' : '');
  if (!googleStatus) return '';
  if (['created', 'existing', 'google-recorded'].includes(googleStatus)) return '구글 기록 완료';
  if (['deleted', 'not_found', 'google-deleted'].includes(googleStatus)) return '구글 삭제 완료';
  return `구글 ${telegramStatusText(googleStatus)}`;
}

function syncSmsStatusText(row) {
  const sms = row.sms || null;
  if (!sms) return '';
  const phone = sms.maskedPhone ? ` ${sms.maskedPhone}` : '';
  const reason = ['failed', 'skipped'].includes(sms.status)
    ? (sms.reason || sms.error || sms.providerCode || '')
    : '';
  return `문자 ${smsStatusText(sms.status)}${phone}${reason ? `: ${cleanTelegramText(reason, 60)}` : ''}`;
}

function syncOriginText(row) {
  const taskType = row.taskType || row.task_type || '';
  if (taskType === 'upload') return '네이버 예약 접수';
  if (taskType === 'delete') return '네이버 취소 접수';
  if (taskType === 'naver_block') return 'SC 예약 접수';
  if (taskType === 'naver_restore') return 'SC 취소 접수';
  if (taskType === 'naver_cancel') return '네이버 후예약 접수';
  if (taskType === 'spacecloud_cancel') return 'SC 후예약 접수';
  return '예약 접수';
}

function successRowsForResult(result, statuses, taskType) {
  return (result?.rows || [])
    .filter((row) => statuses.includes(row.status))
    .map((row) => ({
      ...row,
      taskType: row.taskType || row.task_type || taskType,
    }));
}

function syncSuccessRowsFromCycle(row) {
  const rows = [
    ...((row.uploadedRows || [])
      .filter((taskRow) => ['submitted', 'google-recorded', 'calendar-record-warning'].includes(taskRow.status))
      .map((taskRow) => ({ ...taskRow, taskType: taskRow.taskType || 'upload' }))),
    ...successRowsForResult(row.uploadTasks, ['google-recorded', 'submitted', 'calendar-record-warning'], 'upload'),
    ...successRowsForResult(row.naverBlockTasks, ['blocked', 'already-blocked', 'google-recorded', 'calendar-record-warning'], 'naver_block'),
    ...successRowsForResult(row.naverRestoreTasks, ['restored', 'already-available', 'restore-skipped-not-owned', 'calendar-record-warning'], 'naver_restore'),
    ...successRowsForResult(row.deleteTasks, ['deleted', 'already-gone'], 'delete'),
    ...successRowsForResult(row.spacecloudCancelTasks, ['canceled', 'already-canceled'], 'spacecloud_cancel'),
    ...successRowsForResult(row.naverCancelTasks, ['canceled', 'already-canceled'], 'naver_cancel'),
  ];
  const seen = new Set();
  return rows.filter((taskRow) => {
    const key = taskIdentityKey(taskRow);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatSyncSuccessRows(rows, limit = 5) {
  const visible = rows.slice(0, limit);
  const lines = visible.map((row, index) => {
    const details = [
      syncOriginText(row),
      syncActionResultText(row),
      syncGoogleStatusText(row),
      syncSmsStatusText(row),
    ].filter(Boolean).join(' · ');
    return `${index + 1}. ${syncReservationLine(row)}\n흐름: ${details.replaceAll(' · ', ' → ') || telegramStatusText(row.status)}`;
  });
  if (rows.length > visible.length) lines.push(`외 ${rows.length - visible.length}건`);
  return lines.join('\n') || '-';
}

function syncSuccessNeedsAttention(row) {
  return Boolean(row.calendarRecordWarning || row.status === 'calendar-record-warning' || smsNeedsAttention(row));
}

function syncSuccessTitle(rows) {
  const taskTypes = [...new Set(rows.map((row) => row.taskType || row.task_type || '').filter(Boolean))];
  if (taskTypes.length !== 1) return '✅ 처리 완료: 예약 반영';

  const map = {
    upload: '✅ 완료: 네이버 예약 반영',
    naver_block: '✅ 완료: SC 예약 반영',
    naver_restore: '✅ 완료: 네이버 예약가능 복구',
    delete: '✅ 완료: SC 삭제',
    spacecloud_cancel: '✅ 완료: SC 후예약 취소',
    naver_cancel: '✅ 완료: 네이버 후예약 취소',
  };
  return map[taskTypes[0]] || '✅ 처리 완료: 예약 반영';
}

function syncSuccessMessage(rows) {
  const needsAttention = rows.some(syncSuccessNeedsAttention);
  const title = needsAttention ? '⚠️ 처리 완료: 확인 필요' : syncSuccessTitle(rows);
  return compactNotice(title, [
    formatSyncSuccessRows(rows),
  ]);
}

function compactNotice(title, lines) {
  return [
    title,
    ...lines.filter((line) => line !== ''),
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
  const allLaterConflicts = rows.length && rows.every(isLaterReservationConflictRow);
  if (allLaterConflicts) {
    const row = rows[0] || {};
    return compactNotice('⚠️ 중복예약: 후예약 취소 필요', [
      '판정: 먼저 들어온 예약 우선',
      formatConflictBookingLine('선예약', row.winningBooking),
      formatConflictBookingLine('취소대상', row.losingBooking || row),
      `상태: ${row.error || '네이버 확정 슬롯이 있어 스페이스클라우드 예약을 반영할 수 없음'}`,
      '다음: 후예약 플랫폼 취소 후 선대관 안내 문자 발송',
    ]);
  }
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

function spacecloudCancelSuccessMessage(row) {
  const processed = (row.spacecloudCancelTasks?.rows || []).filter((taskRow) => [
    'canceled',
    'already-canceled',
  ].includes(taskRow.status));
  return compactNotice('✅ 성공: 스페이스클라우드 후예약 취소', [
    `처리: ${processed.length}건`,
    formatBriefRows(processed),
    `문자: ${processed.map((taskRow) => smsStatusText(taskRow.sms?.status)).filter(Boolean).join(', ') || '-'}`,
  ]);
}

function spacecloudCancelFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  return compactNotice('⚠️ 실패: 스페이스클라우드 후예약 취소', [
    '상태: 자동 처리 중지',
    `대상: ${rows.length || '-'}건`,
    formatBriefRows(rows),
    `원인: ${firstFailureReason(rowOrError)}`,
    '기준: 전화번호 확보 전에는 취소하지 않음',
  ]);
}

function naverCancelSuccessMessage(row) {
  const processed = (row.naverCancelTasks?.rows || []).filter((taskRow) => [
    'canceled',
    'already-canceled',
  ].includes(taskRow.status));
  return compactNotice('✅ 성공: 네이버 후예약 취소', [
    `처리: ${processed.length}건`,
    formatBriefRows(processed),
    `문자: ${processed.map((taskRow) => smsStatusText(taskRow.sms?.status)).filter(Boolean).join(', ') || '-'}`,
  ]);
}

function naverCancelFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  return compactNotice('⚠️ 실패: 네이버 후예약 취소', [
    '상태: 자동 처리 중지',
    `대상: ${rows.length || '-'}건`,
    formatBriefRows(rows),
    `원인: ${firstFailureReason(rowOrError)}`,
    '기준: 전화번호 확보 전에는 취소하지 않음',
  ]);
}

function smsMessageKind(rows) {
  const templateNames = new Set(rows.map((row) => row.sms?.templateName).filter(Boolean));
  if (templateNames.size === 1 && templateNames.has(PRIOR_BOOKING_CANCEL_SMS_TEMPLATE_NAME)) return '후예약 취소 문자';
  if (templateNames.size === 1 && templateNames.has(CONFIRMATION_SMS_TEMPLATE_NAME)) return '예약확정 문자';
  return '문자';
}

function smsSuccessMessage(rows) {
  return compactNotice(`✅ 성공: ${smsMessageKind(rows)} 발송`, [
    `처리: ${rows.length}건`,
    formatSmsRows(rows),
  ]);
}

function smsFailureMessage(rows) {
  return compactNotice(`⚠️ 실패: ${smsMessageKind(rows)}`, [
    `대상: ${rows.length}건`,
    formatSmsRows(rows),
    '조치: 전화번호 조회 또는 알리고 전송결과 확인',
  ]);
}

function cycleErrorMessage(errorText, { transient = false } = {}) {
  return compactNotice(transient ? '⚠️ 주의: 서버 연결 재시도' : '⚠️ 실패: 자동화 감시 중지', [
    `상태: ${transient ? '일시 연결 오류, 다음 주기 자동 재시도' : '감시 주기 오류로 중지'}`,
    `원인: ${cleanTelegramText(errorText || '-', 180)}`,
    `조치: ${transient ? '자동 재시도 중, 반복되면 네트워크/서버 연결 확인' : '로그 확인 후 재시작'}`,
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
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForUploadRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'naver-cancel-queued') return 'done';
  if (row.status === 'google-recorded') return 'done';
  if (row.status === 'submitted' || row.status === 'calendar-record-warning') return 'done';
  if (row.status === 'google-create-failed') return 'google_pending';
  if (row.status === 'google-conflict' || row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForNaverBlockRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'blocked' || row.status === 'already-blocked' || row.status === 'google-recorded') return 'done';
  if (row.status === 'spacecloud-cancel-queued') return 'done';
  if (row.status === 'calendar-record-warning') return 'done';
  if (row.status === 'google-create-failed') return 'google_pending';
  if (row.status === 'google-conflict') return 'needs_review';
  if (row.status === 'naver-conflict' || row.status === 'later-reservation-conflict' || row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForSpacecloudCancelRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'canceled' || row.status === 'already-canceled') return 'done';
  if (row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForNaverCancelRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'canceled' || row.status === 'already-canceled') return 'done';
  if (row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForNaverRestoreRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip' || row.status === 'restore-skipped-not-owned') return 'done';
  if (row.status === 'restore-grace-wait') return 'pending';
  if (row.status === 'restored' || row.status === 'already-available') return 'done';
  if (row.status === 'calendar-record-warning') return 'done';
  if (row.status === 'google-delete-failed') return 'google_pending';
  if (row.status === 'needs-review' || row.status === 'naver-conflict') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function isRetryingPlatformRow(row) {
  return row?.dbStatus === 'pending'
    && !isLoginProblem(row.error)
    && isRetryablePlatformProblem(row.error);
}

function taskRowsRetrying(rows) {
  return rows.filter(isRetryingPlatformRow);
}

function taskRowsNeedingReview(rows, doneStatuses) {
  return rows.filter((row) => !doneStatuses.includes(row.status) && !isRetryingPlatformRow(row));
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
    ledgerConfirmedEmailEventId: task.ledgerConfirmedEmailEventId || task.ledger_confirmed_email_event_id || null,
    ledgerCanceledEmailEventId: task.ledgerCanceledEmailEventId || task.ledger_canceled_email_event_id || null,
    emailEventId: task.emailEventId || task.email_event_id || null,
    createdAt: task.createdAt || task.created_at || '',
    updatedAt: task.updatedAt || task.updated_at || '',
  };
}

function parseKstMysqlTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = new Date(`${normalized}+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function taskAgeSeconds(task, now = new Date()) {
  const created = parseKstMysqlTimestamp(task.createdAt || task.created_at);
  if (!created) return null;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 1000));
}

function restoreGraceWaitRow(task, graceSeconds) {
  const ageSeconds = taskAgeSeconds(task);
  return {
    ...basicTaskSummary(task),
    taskType: 'naver_restore',
    status: 'restore-grace-wait',
    ageSeconds,
    graceSeconds,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason: `waiting ${graceSeconds}s before restoring Naver availability to absorb quick cancel/rebook changes`,
  };
}

function expectedLedgerStatus(taskType) {
  if (taskType === 'upload' || taskType === 'naver_block' || taskType === 'spacecloud_cancel' || taskType === 'naver_cancel') return 'confirmed';
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

function staleLedgerEventSkipRow(task, taskType) {
  const expectedEventId = taskType === 'delete' || taskType === 'naver_restore'
    ? (task.ledgerCanceledEmailEventId || task.ledger_canceled_email_event_id || null)
    : (task.ledgerConfirmedEmailEventId || task.ledger_confirmed_email_event_id || null);
  const taskEventId = task.emailEventId || task.email_event_id || null;
  return {
    ...basicTaskSummary(task),
    taskType,
    status: 'stale-ledger-skip',
    expectedEmailEventId: expectedEventId,
    actualEmailEventId: taskEventId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason: `task email event ${taskEventId || 'missing'} is not latest ledger event ${expectedEventId || 'missing'}`,
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
  if ((taskType === 'spacecloud_cancel' || taskType === 'naver_cancel') && task.ledgerStatus === 'canceled') return 'already-canceled';
  if (task.ledgerStatus !== expected) return 'stale';
  const taskEventId = String(task.emailEventId || task.email_event_id || '');
  const latestEventId = String(
    taskType === 'delete' || taskType === 'naver_restore'
      ? (task.ledgerCanceledEmailEventId || task.ledger_canceled_email_event_id || '')
      : (task.ledgerConfirmedEmailEventId || task.ledger_confirmed_email_event_id || '')
  );
  if (!taskEventId || !latestEventId) return 'missing-event';
  if (taskEventId !== latestEventId) return 'stale-event';
  return null;
}

function ledgerIssueRow(task, taskType, issue) {
  if (issue === 'missing') return missingLedgerNeedsReviewRow(task, taskType);
  if (issue === 'stale') return staleLedgerSkipRow(task, taskType);
  if (issue === 'missing-event') return missingLedgerNeedsReviewRow(task, taskType);
  if (issue === 'stale-event') return staleLedgerEventSkipRow(task, taskType);
  if (issue === 'already-canceled') {
    return {
      ...basicTaskSummary(task),
      taskType,
      status: 'already-canceled',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      reason: 'booking ledger is already canceled',
    };
  }
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
    restoreSafeWithoutPriorBlock: !!task.restoreSafeWithoutPriorBlock,
    restoreActiveOverlapCount: task.restoreActiveOverlapCount || 0,
    restoreBlockingBookings: task.restoreBlockingBookings || [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason: task.restoreActiveOverlapCount
      ? 'automatic restore skipped because another active booking overlaps this canceled SpaceCloud slot'
      : 'automatic restore skipped because no prior automation-owned Naver block was found',
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
  if (['created', 'existing', 'replaced'].includes(result?.status)) return 'google-recorded';
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

function payloadForTask(task) {
  const raw = task?.payloadJson || task?.payload_json || '{}';
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isAdminPanelTask(task) {
  const payload = payloadForTask(task);
  return payload.source === 'admin-panel' || payload.source_mode === 'admin-panel';
}

function adminPanelSmsSkipped(task, source) {
  return {
    status: 'disabled',
    reason: 'admin-panel-task',
    source,
    maskedPhone: payloadForTask(task).phone_last4 ? `****-${payloadForTask(task).phone_last4}` : '',
  };
}

async function classifyLaterReservationConflict(args, task, row, currentPlatform) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({
    taskId: task.id || task.taskId || null,
    ledgerId: task.ledgerId || null,
    sourcePlatform: currentPlatform,
    reservationNo: task.reservationNo || task.reservation_number || row.reservationNo || row.reservation_number || '',
    roomKey: task.roomKey || task.room_key || '',
    date: task.date || task.reservation_date || '',
    startTime: task.startTime || task.start_time || '',
    endTime: task.endTime || task.end_time || '',
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export CONFLICT_PAYLOAD_B64=${shellQuote(payload)}
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

def time_value(value):
    text = str(value or '')
    if len(text) == 5:
        return text + ':00'
    return text

def is_real_booking(item):
    return item.get('sourcePlatform') in {'naver', 'spacecloud'}

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
payload = json.loads(base64.b64decode(os.environ['CONFLICT_PAYLOAD_B64']).decode('utf-8'))
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
        cur.execute(
            """
            SELECT
                id,
                source_platform AS sourcePlatform,
                source_mode AS sourceMode,
                current_status AS currentStatus,
                room_key AS roomKey,
                CAST(reservation_date AS CHAR) AS date,
                CONCAT(LPAD(HOUR(start_time), 2, '0'), ':', LPAD(MINUTE(start_time), 2, '0')) AS startTime,
                CONCAT(LPAD(HOUR(end_time), 2, '0'), ':', LPAD(MINUTE(end_time), 2, '0')) AS endTime,
                reserver_name AS reserverName,
                reservation_number AS reservationNumber,
                product,
                CAST(last_event_at AS CHAR) AS lastEventAt,
                CAST(created_at AS CHAR) AS createdAt
            FROM rhythmjoy_booking_ledger
            WHERE current_status='confirmed'
              AND room_key=%s
              AND reservation_date=%s
              AND COALESCE(source_mode, '') <> 'admin-task-anchor'
              AND start_time < %s
              AND end_time > %s
            ORDER BY
              COALESCE(last_event_at, created_at, '9999-12-31 23:59:59') ASC,
              id ASC
            """,
            (
                payload.get('roomKey') or '',
                payload.get('date') or None,
                time_value(payload.get('endTime')),
                time_value(payload.get('startTime')),
            ),
        )
        overlaps = cur.fetchall()
    actionable_overlaps = [item for item in overlaps if is_real_booking(item)]
    ignored_record_only_overlaps = [item for item in overlaps if not is_real_booking(item)]
    current = None
    current_platform = payload.get('sourcePlatform') or ''
    current_reservation_no = str(payload.get('reservationNo') or '').strip()
    for item in actionable_overlaps:
        if payload.get('ledgerId') and int(item.get('id') or 0) == int(payload.get('ledgerId') or 0):
            current = item
            break
    if current is None and current_reservation_no:
        for item in actionable_overlaps:
            if item.get('sourcePlatform') == current_platform and str(item.get('reservationNumber') or '').strip() == current_reservation_no:
                current = item
                break
    if current is None:
        for item in actionable_overlaps:
            if item.get('sourcePlatform') == current_platform:
                current = item
                break
    winner = actionable_overlaps[0] if actionable_overlaps else None
    print(json.dumps({
        'overlaps': overlaps,
        'actionableOverlaps': actionable_overlaps,
        'ignoredRecordOnlyOverlaps': ignored_record_only_overlaps,
        'current': current,
        'winner': winner,
        'isLaterReservation': bool(winner and current and winner.get('id') != current.get('id')),
    }, ensure_ascii=False))
finally:
    conn.close()
PY
  `;

  let classification = {};
  try {
    classification = JSON.parse(runSshScript(target, script).trim() || '{}');
  } catch (error) {
    return {
      ...row,
      conflictClassificationError: String(error?.message || error),
    };
  }

  if (classification.isLaterReservation) {
    const winner = classification.winner || null;
    const current = classification.current || null;
    return {
      ...row,
      status: 'later-reservation-conflict',
      originalStatus: row.status || '',
      priorityRule: 'first-real-platform-confirmed-email-wins',
      winningBooking: winner,
      losingBooking: current,
      overlapBookings: classification.overlaps || [],
      actionableOverlapBookings: classification.actionableOverlaps || [],
      ignoredRecordOnlyOverlapBookings: classification.ignoredRecordOnlyOverlaps || [],
      error: '후예약 충돌: 선예약이 이미 확정되어 후예약 취소 처리가 필요합니다.',
      nextAction: 'cancel-later-reservation-and-send-prior-booking-sms',
    };
  }

  return {
    ...row,
    priorityRule: 'first-real-platform-confirmed-email-wins',
    overlapBookings: classification.overlaps || [],
    actionableOverlapBookings: classification.actionableOverlaps || [],
    ignoredRecordOnlyOverlapBookings: classification.ignoredRecordOnlyOverlaps || [],
  };
}

async function classifyNaverConflict(args, task, row) {
  if (row?.status !== 'naver-conflict') return row;
  return classifyLaterReservationConflict(args, task, row, 'spacecloud');
}

async function classifyUploadConflict(args, task, row) {
  return classifyLaterReservationConflict(args, task, row, 'naver');
}

function hasBlockingFailures(result) {
  return (result?.failed || []).some((row) => !isGoogleRetryableStatus(row.status));
}

async function sendNaverOriginConfirmationSms(args, context, task) {
  if (isAdminPanelTask(task)) return adminPanelSmsSkipped(task, 'admin-panel');
  if (payloadForTask(task).suppress_confirmation_sms === true) {
    return {
      status: 'disabled',
      reason: 'manual-recovery-no-sms',
      source: 'naver',
      maskedPhone: '',
    };
  }
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
  if (isAdminPanelTask(task)) return adminPanelSmsSkipped(task, 'admin-panel');
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
    source: args.smsTestSource || 'manual-test',
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
              status: 'upload-pending',
              startedAt: new Date().toISOString(),
            };
            row = await classifyUploadConflict(args, task, row);
            if (row.status === 'later-reservation-conflict') {
              row.status = 'needs-review';
              row.error = '중복예약 충돌: 스페이스클라우드 선예약이 있어 네이버 예약을 반영하지 못했습니다. 자동 취소 없이 관리자 확인이 필요합니다.';
              row.nextAction = 'manual-review-no-cancellation';
            } else {
              row = await uploadSpacecloudDirectReservation(activeContext, event);
              if (row.status === 'submitted') {
                const marked = markSubmittedRows(args, [row]);
                row.marked = marked;
                await updateRemoteTask(args, task.id, 'google_pending', JSON.stringify(row, null, 2));
              }
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
      row.dbStatus = status;
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && (isLoginProblem(row.error) || isRetryablePlatformProblem(row.error))) {
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

  const retrying = taskRowsRetrying(rows);
  const failed = taskRowsNeedingReview(rows, [
    'google-recorded',
    'submitted',
    'calendar-record-warning',
    'naver-cancel-queued',
    'stale-ledger-skip',
  ]);
  return {
    status: failed.length ? 'upload-task-needs-review' : (retrying.length ? 'upload-task-retry-pending' : 'upload-task-processed'),
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
    retrying,
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
      row.dbStatus = status;
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && (isLoginProblem(row.error) || isRetryablePlatformProblem(row.error))) {
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

  const retrying = taskRowsRetrying(rows);
  const failed = taskRowsNeedingReview(rows, [
    'deleted',
    'already-gone',
    'stale-ledger-skip',
  ]);
  return {
    status: failed.length ? 'delete-needs-review' : (retrying.length ? 'delete-retry-pending' : 'delete-processed'),
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
    retrying,
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
      row.dbStatus = status;
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && (isLoginProblem(row.error) || isRetryablePlatformProblem(row.error))) {
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

  const retrying = taskRowsRetrying(rows);
  const failed = taskRowsNeedingReview(rows, [
    'blocked',
    'already-blocked',
    'google-recorded',
    'calendar-record-warning',
    'stale-ledger-skip',
  ]);
  return {
    status: failed.length ? 'naver-block-needs-review' : (retrying.length ? 'naver-block-retry-pending' : 'naver-block-processed'),
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
    retrying,
  };
}

async function runSpacecloudCancelTasks(args, context = null) {
  if (args.dryRun) {
    return {
      status: 'spacecloud-cancel-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = await fetchRemoteSpacecloudCancelTasks(args);
  if (tasks.length === 0) {
    return {
      status: 'no-spacecloud-cancel-tasks',
      fetched: tasks.length,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  if (CUSTOMER_RESERVATION_CANCELLATION_DISABLED) {
    const rows = [];
    for (const task of tasks) {
      const row = {
        ...basicTaskSummary(task),
        status: 'needs-review',
        error: '고객 예약 자동 취소는 영구 차단되어 있습니다.',
        safetyPolicy: 'manual-review-no-cancellation',
        dbStatus: 'needs_review',
      };
      rows.push(row);
      await updateRemoteTask(args, task.id, 'needs_review', JSON.stringify(row, null, 2));
    }
    return {
      status: 'spacecloud-cancel-needs-review',
      fetched: tasks.length,
      attempted: 0,
      rows,
      failed: rows,
      retrying: [],
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
        row = staleRunningNeedsReviewRow(task, 'spacecloud_cancel');
      } else {
        const ledgerIssue = ledgerIssueForTask(task, 'spacecloud_cancel');
        if (ledgerIssue) {
          row = ledgerIssueRow(task, 'spacecloud_cancel', ledgerIssue);
        } else {
          row = await cancelSpacecloudConfirmedReservation(activeContext, task);
          row.smsPreview = priorBookingCancelSmsMessage(task);
          if (row.status === 'canceled') {
            try {
              row.sms = await sendPriorBookingCancellationSms(args, {
                task,
                phone: row.phone,
              });
            } catch (smsError) {
              row.sms = {
                status: 'failed',
                reason: 'sms-send-exception',
                error: String(smsError?.message || smsError),
                templateName: PRIOR_BOOKING_CANCEL_SMS_TEMPLATE_NAME,
              };
            }
          }
        }
      }

      rows.push(row);
      const status = dbStatusForSpacecloudCancelRow(row);
      row.dbStatus = status;
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && (isLoginProblem(row.error) || isRetryablePlatformProblem(row.error))) {
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

  const retrying = taskRowsRetrying(rows);
  const failed = taskRowsNeedingReview(rows, [
    'canceled',
    'already-canceled',
    'stale-ledger-skip',
  ]);
  return {
    status: failed.length ? 'spacecloud-cancel-needs-review' : (retrying.length ? 'spacecloud-cancel-retry-pending' : 'spacecloud-cancel-processed'),
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
    retrying,
  };
}

async function runNaverCancelTasks(args, context = null) {
  if (args.dryRun) {
    return {
      status: 'naver-cancel-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = await fetchRemoteNaverCancelTasks(args);
  if (tasks.length === 0) {
    return {
      status: 'no-naver-cancel-tasks',
      fetched: tasks.length,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  if (CUSTOMER_RESERVATION_CANCELLATION_DISABLED) {
    const rows = [];
    for (const task of tasks) {
      const row = {
        ...basicTaskSummary(task),
        status: 'needs-review',
        error: '고객 예약 자동 취소는 영구 차단되어 있습니다.',
        safetyPolicy: 'manual-review-no-cancellation',
        dbStatus: 'needs_review',
      };
      rows.push(row);
      await updateRemoteTask(args, task.id, 'needs_review', JSON.stringify(row, null, 2));
    }
    return {
      status: 'naver-cancel-needs-review',
      fetched: tasks.length,
      attempted: 0,
      rows,
      failed: rows,
      retrying: [],
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
        row = staleRunningNeedsReviewRow(task, 'naver_cancel');
      } else {
        const ledgerIssue = ledgerIssueForTask(task, 'naver_cancel');
        if (ledgerIssue) {
          row = ledgerIssueRow(task, 'naver_cancel', ledgerIssue);
        } else {
          row = await cancelNaverConfirmedReservation(activeContext, task, {
            businessId: args.naverBusinessId,
          });
          row.smsPreview = priorBookingCancelSmsMessage(task);
          if (row.status === 'canceled') {
            try {
              row.sms = await sendPriorBookingCancellationSms(args, {
                task: {
                  ...task,
                  taskType: 'naver_cancel',
                },
                phone: row.phone,
              });
            } catch (smsError) {
              row.sms = {
                status: 'failed',
                reason: 'sms-send-exception',
                error: String(smsError?.message || smsError),
                templateName: PRIOR_BOOKING_CANCEL_SMS_TEMPLATE_NAME,
              };
            }
          }
        }
      }

      rows.push(row);
      const status = dbStatusForNaverCancelRow(row);
      row.dbStatus = status;
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && (isLoginProblem(row.error) || isRetryablePlatformProblem(row.error))) {
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

  const retrying = taskRowsRetrying(rows);
  const failed = taskRowsNeedingReview(rows, [
    'canceled',
    'already-canceled',
    'stale-ledger-skip',
  ]);
  return {
    status: failed.length ? 'naver-cancel-needs-review' : (retrying.length ? 'naver-cancel-retry-pending' : 'naver-cancel-processed'),
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
    retrying,
  };
}

function splitNaverAvailabilityResult(result) {
  const blockRows = (result.rows || []).filter((row) => row.taskType !== 'naver_restore');
  const restoreRows = (result.rows || []).filter((row) => row.taskType === 'naver_restore');
  const blockFailed = (result.failed || []).filter((row) => row.taskType !== 'naver_restore');
  const restoreFailed = (result.failed || []).filter((row) => row.taskType === 'naver_restore');
  const blockRetrying = (result.retrying || []).filter((row) => row.taskType !== 'naver_restore');
  const restoreRetrying = (result.retrying || []).filter((row) => row.taskType === 'naver_restore');
  return {
    naverBlockTasks: {
      status: blockFailed.length ? 'naver-block-needs-review' : (blockRetrying.length ? 'naver-block-retry-pending' : 'naver-block-processed'),
      fetched: blockRows.length,
      attempted: blockRows.length,
      rows: blockRows,
      failed: blockFailed,
      retrying: blockRetrying,
    },
    naverRestoreTasks: {
      status: restoreFailed.length ? 'naver-restore-needs-review' : (restoreRetrying.length ? 'naver-restore-retry-pending' : 'naver-restore-processed'),
      fetched: restoreRows.length,
      attempted: restoreRows.length,
      rows: restoreRows,
      failed: restoreFailed,
      retrying: restoreRetrying,
    },
  };
}

function mergeTaskResults(...results) {
  const valid = results.filter(Boolean);
  const rows = valid.flatMap((result) => result.rows || []);
  const failed = valid.flatMap((result) => result.failed || []);
  const retrying = valid.flatMap((result) => result.retrying || []);
  return {
    status: failed.length ? 'task-needs-review' : (retrying.length ? 'task-retry-pending' : 'task-processed'),
    fetched: valid.reduce((sum, result) => sum + (result.fetched || 0), 0),
    attempted: valid.reduce((sum, result) => sum + (result.attempted || 0), 0),
    rows,
    failed,
    retrying,
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
          if (args.nowMode && task.status !== 'google_pending') {
            const ageSeconds = taskAgeSeconds(task);
            if (ageSeconds !== null && ageSeconds < args.restoreGraceSeconds) {
              row = restoreGraceWaitRow(task, args.restoreGraceSeconds);
            }
          }

          if (!row && task.status === 'google_pending') {
            row = {
              ...naverBlockTaskSummary(task),
              taskType,
              status: 'google-delete-pending',
              startedAt: new Date().toISOString(),
              naverAlreadyRestored: true,
            };
          } else if (!row && task.priorNaverBlockChanged !== true && task.restoreSafeWithoutPriorBlock !== true) {
            row = restoreSkippedNotOwnedRow(task);
          } else if (!row) {
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
            row = await classifyNaverConflict(args, task, row);
            if (row.status === 'later-reservation-conflict') {
              row.status = 'needs-review';
              row.error = '중복예약 충돌: 네이버 선예약의 스페이스클라우드 반영 누락 가능성이 있습니다. 자동 취소 없이 관리자 확인이 필요합니다.';
              row.nextAction = 'manual-review-no-cancellation';
            }
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
      row.dbStatus = status;
      await updateRemoteTask(args, task.id, status, JSON.stringify(row, null, 2));
      if (status === 'pending' && (isLoginProblem(row.error) || isRetryablePlatformProblem(row.error))) {
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

  const retrying = taskRowsRetrying(rows);
  const failed = rows.filter((row) => {
    const doneStatuses = row.taskType === 'naver_restore'
      ? [
        'restored',
        'already-available',
        'restore-skipped-not-owned',
        'restore-grace-wait',
        'calendar-record-warning',
        'stale-ledger-skip',
      ]
      : [
        'blocked',
        'already-blocked',
        'google-recorded',
        'calendar-record-warning',
        'spacecloud-cancel-queued',
        'stale-ledger-skip',
      ];
    return taskRowsNeedingReview([row], doneStatuses).length > 0;
  });
  return {
    status: failed.length ? 'naver-availability-needs-review' : (retrying.length ? 'naver-availability-retry-pending' : 'naver-availability-processed'),
    fetched: tasks.length,
    attempted: rows.length,
    rows,
    failed,
    retrying,
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

function runNowModeSelfTest() {
  const parsed = parseArgs([
    'node',
    'tools/spacecloud-watch.mjs',
    'watch',
    '--now-mode',
    '--urgent-window-minutes',
    '180',
    '--restore-grace-seconds',
    '45',
    '--session-check-interval-seconds',
    '180',
  ]);
  assert.equal(parsed.nowMode, true);
  assert.equal(parsed.urgentWindowMinutes, 180);
  assert.equal(parsed.urgentIntervalSeconds, 15);
  assert.equal(parsed.urgentCooldownSeconds, 300);
  assert.equal(parsed.restoreGraceSeconds, 45);
  assert.equal(parsed.sessionCheckIntervalSeconds, 180);

  const freshTask = {
    id: 1,
    taskType: 'naver_restore',
    roomKey: 'a',
    date: '2026-07-16',
    startTime: '20:00',
    endTime: '22:00',
    createdAt: new Date(Date.now() + KST_OFFSET_MS - 10_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' '),
  };
  const waitRow = restoreGraceWaitRow(freshTask, 45);
  assert.equal(waitRow.status, 'restore-grace-wait');
  assert.equal(dbStatusForNaverRestoreRow(waitRow), 'pending');

  const merged = mergeTaskResults(
    { fetched: 1, attempted: 1, rows: [{ status: 'canceled' }], failed: [] },
    { fetched: 1, attempted: 1, rows: [{ status: 'already-canceled' }], failed: [] },
  );
  assert.equal(merged.fetched, 2);
  assert.equal(merged.attempted, 2);
  assert.equal(merged.rows.length, 2);
  assert.equal(merged.failed.length, 0);

  const retryRow = {
    status: 'failed',
    dbStatus: 'pending',
    error: 'page.goto: Timeout 20000ms exceeded while waiting until domcontentloaded',
  };
  const loginRow = {
    status: 'failed',
    dbStatus: 'pending',
    error: 'login required',
  };
  assert.equal(isRetryingPlatformRow(retryRow), true);
  assert.equal(taskRowsNeedingReview([retryRow], []).length, 0);
  assert.equal(taskRowsRetrying([retryRow]).length, 1);
  const closedContextRow = {
    status: 'failed',
    error: 'browserContext.newPage: Target page, context or browser has been closed',
  };
  assert.equal(isRetryablePlatformProblem(closedContextRow.error), true);
  assert.equal(dbStatusForUploadRow(closedContextRow), 'pending');
  assert.equal(dbStatusForDeleteRow(closedContextRow), 'pending');
  assert.equal(dbStatusForNaverBlockRow(closedContextRow), 'pending');
  assert.equal(dbStatusForNaverRestoreRow(closedContextRow), 'pending');
  assert.equal(dbStatusForNaverCancelRow(closedContextRow), 'pending');
  assert.equal(dbStatusForSpacecloudCancelRow(closedContextRow), 'pending');
  const ambiguousSubmitRow = {
    status: 'submitted-modal-still-visible',
    error: 'modal still visible after submit',
  };
  assert.equal(isRetryablePlatformProblem(ambiguousSubmitRow.error), true);
  assert.equal(dbStatusForUploadRow(ambiguousSubmitRow), 'pending');
  assert.equal(isRetryingPlatformRow(loginRow), false);
  assert.equal(taskRowsNeedingReview([loginRow], []).length, 1);

  assert.equal(hasBlockingFailures({ failed: [{ status: 'google-create-failed' }] }), false);
  assert.equal(hasBlockingFailures({ failed: [{ status: 'needs-review' }] }), true);
  assert.equal(hasBlockingFailures({ failed: [], retrying: [retryRow] }), false);
  assert.equal(CUSTOMER_RESERVATION_CANCELLATION_DISABLED, true);
  assert.match(dailyReconcileMessage({}), /spacecloud-watch\/launchd\.log/);

  return {
    ok: true,
    checks: [
      'now-mode argument parsing',
      'restore grace keeps task pending',
      'same-cycle cancellation result merge',
      'platform page timeout becomes next-cycle retry',
      'closed browser context retries every task type',
      'ambiguous SpaceCloud submit is verified on retry',
      'google-only retry does not block urgent flow',
      'customer reservation cancellation is hard-disabled',
      'daily reconcile message renders with log hint',
    ],
  };
}

async function checkAutomationSessionStatuses(args, context) {
  const statuses = [];
  const addStatus = (platform, result, error = null) => {
    if (error) {
      statuses.push({
        platform,
        status: 'check_failed',
        note: String(error?.message || error).slice(0, 240),
      });
      return;
    }
    statuses.push({
      platform,
      status: result?.ok ? 'ready' : 'login_required',
      note: String(result?.ok ? '자동화 화면 확인됨' : (result?.reason || 'login may be required')).slice(0, 240),
    });
  };

  try {
    addStatus('naver', await checkNaverSmartplaceLogin(context, {
      businessId: args.naverBusinessId,
      timeoutMs: 15000,
    }));
  } catch (error) {
    addStatus('naver', null, error);
  }

  try {
    addStatus('spacecloud', await checkSpacecloudLogin(context, {
      timeoutMs: 15000,
    }));
  } catch (error) {
    addStatus('spacecloud', null, error);
  }

  try {
    await updateRemoteAdminSessions(args, statuses);
  } catch (error) {
    logLine(`session status DB update failed: ${String(error?.message || error)}`);
  }

  return statuses;
}

async function maybeCheckAutomationSessionStatuses(args, context, workDir) {
  if (!args.nowMode || args.sessionCheckIntervalSeconds <= 0) {
    return checkAutomationSessionStatuses(args, context);
  }

  const statePath = path.join(workDir, 'session-check-state.json');
  const state = await readJsonObject(statePath);
  const lastCheckedAt = state.checkedAt ? new Date(state.checkedAt).getTime() : 0;
  const now = Date.now();
  if (lastCheckedAt && now - lastCheckedAt < args.sessionCheckIntervalSeconds * 1000) {
    return [{
      platform: 'all',
      status: 'check_skipped',
      note: `NOW mode: session check skipped until ${args.sessionCheckIntervalSeconds}s interval passes`,
    }];
  }

  const statuses = await checkAutomationSessionStatuses(args, context);
  await writeJson(statePath, {
    checkedAt: new Date(now).toISOString(),
    statuses,
  });
  return statuses;
}

function setCycleStatusFromResult(row, result, { processed, needsReview, retrying = 'task-retry-pending' }) {
  if (!result || result.attempted <= 0) return;
  if (hasBlockingFailures(result)) row.status = needsReview;
  else if (result.retrying?.length) row.status = retrying;
  else row.status = processed;
}

async function runNowModeCycleTasks(args, row, activeContext) {
  const firstSpacecloudCancel = await runSpacecloudCancelTasks(args, activeContext);
  row.spacecloudCancelTasks = firstSpacecloudCancel;
  setCycleStatusFromResult(row, row.spacecloudCancelTasks, {
    processed: 'spacecloud-cancel-processed',
    needsReview: 'spacecloud-cancel-needs-review',
    retrying: 'spacecloud-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.spacecloudCancelTasks)) return;

  const firstNaverCancel = await runNaverCancelTasks(args, activeContext);
  row.naverCancelTasks = firstNaverCancel;
  setCycleStatusFromResult(row, row.naverCancelTasks, {
    processed: 'naver-cancel-processed',
    needsReview: 'naver-cancel-needs-review',
    retrying: 'naver-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.naverCancelTasks)) return;

  row.naverAvailabilityTasks = await runNaverAvailabilityTasks(args, activeContext);
  const split = splitNaverAvailabilityResult(row.naverAvailabilityTasks);
  row.naverBlockTasks = split.naverBlockTasks;
  row.naverRestoreTasks = split.naverRestoreTasks;
  setCycleStatusFromResult(row, row.naverAvailabilityTasks, {
    processed: row.naverAvailabilityTasks.failed?.length ? 'naver-availability-google-pending' : 'naver-availability-processed',
    needsReview: 'naver-availability-needs-review',
    retrying: 'naver-availability-retry-pending',
  });
  if (hasBlockingFailures(row.naverAvailabilityTasks)) return;

  const secondSpacecloudCancel = await runSpacecloudCancelTasks(args, activeContext);
  row.spacecloudCancelTasks = mergeTaskResults(row.spacecloudCancelTasks, secondSpacecloudCancel);
  setCycleStatusFromResult(row, row.spacecloudCancelTasks, {
    processed: 'spacecloud-cancel-processed',
    needsReview: 'spacecloud-cancel-needs-review',
    retrying: 'spacecloud-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.spacecloudCancelTasks)) return;

  row.uploadTasks = await runUploadTasks(args, activeContext);
  setCycleStatusFromResult(row, row.uploadTasks, {
    processed: row.uploadTasks.failed?.length ? 'upload-task-google-pending' : 'upload-task-processed',
    needsReview: 'upload-task-needs-review',
    retrying: 'upload-task-retry-pending',
  });
  if (hasBlockingFailures(row.uploadTasks)) return;

  const secondNaverCancel = await runNaverCancelTasks(args, activeContext);
  row.naverCancelTasks = mergeTaskResults(row.naverCancelTasks, secondNaverCancel);
  setCycleStatusFromResult(row, row.naverCancelTasks, {
    processed: 'naver-cancel-processed',
    needsReview: 'naver-cancel-needs-review',
    retrying: 'naver-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.naverCancelTasks)) return;

  row.deleteTasks = await runDeleteTasks(args, activeContext);
  setCycleStatusFromResult(row, row.deleteTasks, {
    processed: row.deleteTasks.failed?.length ? 'delete-google-pending' : 'delete-processed',
    needsReview: 'delete-needs-review',
    retrying: 'delete-retry-pending',
  });
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

    row.sessionStatus = await maybeCheckAutomationSessionStatuses(args, await getContext(), workDir);

    if (args.nowMode) {
      await runNowModeCycleTasks(args, row, activeContext);
    } else {
      row.uploadTasks = await runUploadTasks(args, activeContext);
      if (['planned', 'dry-run'].includes(row.status) && row.uploadTasks.attempted > 0) {
        setCycleStatusFromResult(row, row.uploadTasks, {
          processed: row.uploadTasks.failed.length ? 'upload-task-google-pending' : 'upload-task-processed',
          needsReview: 'upload-task-needs-review',
          retrying: 'upload-task-retry-pending',
        });
      }

      if (!hasBlockingFailures(row.uploadTasks)) {
        row.naverCancelTasks = await runNaverCancelTasks(args, activeContext);
        if (['planned', 'dry-run', 'idle', 'upload-task-processed'].includes(row.status) && row.naverCancelTasks.attempted > 0) {
          setCycleStatusFromResult(row, row.naverCancelTasks, {
            processed: 'naver-cancel-processed',
            needsReview: 'naver-cancel-needs-review',
            retrying: 'naver-cancel-retry-pending',
          });
        }
      }

      if (args.legacyCalendarPlan && !hasBlockingFailures(row.uploadTasks) && !hasBlockingFailures(row.naverCancelTasks) && plan.upload.length > 0 && !args.dryRun) {
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

      if (!row.failed?.length && !hasBlockingFailures(row.uploadTasks) && !hasBlockingFailures(row.naverCancelTasks)) {
        row.deleteTasks = await runDeleteTasks(args, activeContext);
        if (['planned', 'dry-run'].includes(row.status) && row.deleteTasks.attempted > 0) {
          setCycleStatusFromResult(row, row.deleteTasks, {
            processed: row.deleteTasks.failed.length ? 'delete-google-pending' : 'delete-processed',
            needsReview: 'delete-needs-review',
            retrying: 'delete-retry-pending',
          });
        }
      }

      if (!row.failed?.length && !hasBlockingFailures(row.uploadTasks) && !hasBlockingFailures(row.naverCancelTasks) && !hasBlockingFailures(row.deleteTasks)) {
        row.naverAvailabilityTasks = await runNaverAvailabilityTasks(args, activeContext);
        const split = splitNaverAvailabilityResult(row.naverAvailabilityTasks);
        row.naverBlockTasks = split.naverBlockTasks;
        row.naverRestoreTasks = split.naverRestoreTasks;
        if (['planned', 'dry-run'].includes(row.status) && row.naverAvailabilityTasks.attempted > 0) {
          setCycleStatusFromResult(row, row.naverAvailabilityTasks, {
            processed: row.naverAvailabilityTasks.failed.length ? 'naver-availability-google-pending' : 'naver-availability-processed',
            needsReview: 'naver-availability-needs-review',
            retrying: 'naver-availability-retry-pending',
          });
        }
      }

      if (!row.failed?.length && !hasBlockingFailures(row.uploadTasks) && !hasBlockingFailures(row.naverCancelTasks) && !hasBlockingFailures(row.deleteTasks) && !hasBlockingFailures(row.naverAvailabilityTasks)) {
        row.spacecloudCancelTasks = await runSpacecloudCancelTasks(args, activeContext);
        if (['planned', 'dry-run', 'idle'].includes(row.status) && row.spacecloudCancelTasks.attempted > 0) {
          setCycleStatusFromResult(row, row.spacecloudCancelTasks, {
            processed: 'spacecloud-cancel-processed',
            needsReview: 'spacecloud-cancel-needs-review',
            retrying: 'spacecloud-cancel-retry-pending',
          });
        }
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

function resultAttempted(result) {
  return Number(result?.attempted || 0) > 0
    || Number(result?.fetched || 0) > 0
    || (Array.isArray(result?.failed) && result.failed.length > 0)
    || (Array.isArray(result?.retrying) && result.retrying.length > 0)
    || (Array.isArray(result?.rows) && result.rows.some((row) => [
      'pending',
      'restore-grace-wait',
      'needs-review',
      'google-create-failed',
      'google-delete-failed',
    ].includes(String(row.status || ''))));
}

function cycleNeedsUrgentFollowUp(row) {
  if (!row || typeof row !== 'object') return false;
  if (Number(row.attempted || 0) > 0 || (Array.isArray(row.failed) && row.failed.length > 0)) return true;
  return [
    row.uploadTasks,
    row.deleteTasks,
    row.naverBlockTasks,
    row.naverRestoreTasks,
    row.naverAvailabilityTasks,
    row.spacecloudCancelTasks,
    row.naverCancelTasks,
  ].some(resultAttempted);
}

function watchSleepSeconds(args, urgentUntil) {
  if (!args.nowMode) return args.intervalSeconds;
  if (Date.now() < urgentUntil) {
    return Math.max(5, Math.min(args.intervalSeconds, args.urgentIntervalSeconds));
  }
  return args.intervalSeconds;
}

async function runWatch(args) {
  let context = await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  });
  const reopenBrowserContext = async () => {
    await context.close().catch(() => {});
    context = await openSpacecloudContext({
      profileDir: args.profileDir,
      headless: args.headless,
    });
    logLine('browser context reopened after unexpected close');
  };
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let urgentUntil = 0;

  logLine(`watch started; interval=${args.intervalSeconds}s urgent=${args.nowMode ? `${args.urgentIntervalSeconds}s/${args.urgentCooldownSeconds}s` : 'off'} profile=${args.profileDir} mode=${args.legacyCalendarPlan ? 'db+legacy-calendar-plan' : 'db-queue'}`);
  try {
    while (!stopping) {
      try {
        const row = await runCycle(args, context);
        if (args.nowMode && cycleNeedsUrgentFollowUp(row)) {
          urgentUntil = Math.max(urgentUntil, Date.now() + args.urgentCooldownSeconds * 1000);
        }
        logLine(`cycle ${row.status}; candidates=${row.uploadCandidates}; attempted=${row.attempted || 0}; remaining=${row.remainingInPlan ?? 0}; uploadTasks=${row.uploadTasks?.attempted || 0}; naverCancelTasks=${row.naverCancelTasks?.attempted || 0}; deleteTasks=${row.deleteTasks?.attempted || 0}; naverBlockTasks=${row.naverBlockTasks?.attempted || 0}; naverRestoreTasks=${row.naverRestoreTasks?.attempted || 0}; spacecloudCancelTasks=${row.spacecloudCancelTasks?.attempted || 0}`);
        if (isBrowserContextClosedProblem(JSON.stringify(row))) {
          await reopenBrowserContext();
        }
        const successRows = syncSuccessRowsFromCycle(row);
        const successKeys = new Set(successRows.map((taskRow) => taskIdentityKey(taskRow)));
        if (successRows.length) {
          const result = await sendTelegram(args, syncSuccessMessage(successRows));
          if (result.sent) logLine(`telegram sent: sync-success count=${successRows.length}`);
          else logLine(`telegram sync success skipped: ${result.reason}`);
        }
        const smsRows = smsRowsFromCycle(row);
        const smsFailureRows = smsRows.filter((taskRow) => (
          smsNeedsAttention(taskRow)
          && !successKeys.has(taskIdentityKey(taskRow))
        ));
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
            await notifyWithCooldown(args, notificationKeyForRows('spacecloud-upload-task-failed', row.uploadTasks), uploadTaskFailureMessage(row.uploadTasks));
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
            await notifyWithCooldown(args, notificationKeyForRows('spacecloud-delete-failed', row.deleteTasks), deleteFailureMessage(row.deleteTasks));
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
            await notifyWithCooldown(args, notificationKeyForRows('naver-block-failed', row.naverBlockTasks), naverBlockFailureMessage(row.naverBlockTasks));
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
            await notifyWithCooldown(args, notificationKeyForRows('naver-restore-failed', row.naverRestoreTasks), naverRestoreFailureMessage(row.naverRestoreTasks));
            logLine(`stopping after naver restore failure: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
            break;
          }
        }
        if (row.naverCancelTasks?.failed?.length) {
          const errorText = row.naverCancelTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(row.naverCancelTasks));
            logLine(`login needed during naver cancel; waiting for manual login: ${JSON.stringify(row.naverCancelTasks.failed)}`);
          } else {
            await notifyWithCooldown(args, notificationKeyForRows('naver-cancel-failed', row.naverCancelTasks), naverCancelFailureMessage(row.naverCancelTasks));
            logLine(`stopping after naver cancel failure: ${JSON.stringify(row.naverCancelTasks.failed)}`);
            break;
          }
        }
        if (row.spacecloudCancelTasks?.failed?.length) {
          const errorText = row.spacecloudCancelTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(row.spacecloudCancelTasks));
            logLine(`login needed during spacecloud cancel; waiting for manual login: ${JSON.stringify(row.spacecloudCancelTasks.failed)}`);
          } else {
            await notifyWithCooldown(args, notificationKeyForRows('spacecloud-cancel-failed', row.spacecloudCancelTasks), spacecloudCancelFailureMessage(row.spacecloudCancelTasks));
            logLine(`stopping after spacecloud cancel failure: ${JSON.stringify(row.spacecloudCancelTasks.failed)}`);
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
        if (isBrowserContextClosedProblem(errorRow.error)) {
          await reopenBrowserContext();
          logLine('closed browser context recovered; will retry next cycle');
        } else if (isLoginProblem(errorRow.error)) {
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

      await maybeSendReflectionAudit(args);
      await maybeSendDailyReconcile(args);
      const sleepSeconds = watchSleepSeconds(args, urgentUntil);
      if (args.nowMode && sleepSeconds !== args.intervalSeconds) {
        logLine(`urgent follow-up interval active; next cycle in ${sleepSeconds}s`);
      }
      const waitUntil = Date.now() + sleepSeconds * 1000;
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

  if (args.command === 'now-mode-self-test') {
    const result = runNowModeSelfTest();
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`NOW mode self-test OK: ${result.checks.join(', ')}`);
    return;
  }

  if (args.command === 'reflection-audit') {
    const result = await fetchRemoteReflectionAudit(args);
    if (args.telegram && (Number(result.issueCount || 0) > 0 || Number(result.duplicateCount || 0) > 0)) {
      await sendTelegram(args, reflectionAuditMessage(result));
    }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`reflection audit checked=${result.checked || 0}; ok=${result.okCount || 0}; waiting=${result.waitingCount || 0}; issues=${result.issueCount || 0}; duplicates=${result.duplicateCount || 0}`);
    }
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
    else console.log(`cycle ${result.status}; candidates=${result.uploadCandidates}; attempted=${result.attempted || 0}; remaining=${result.remainingInPlan ?? 0}; uploadTasks=${result.uploadTasks?.attempted || 0}; naverCancelTasks=${result.naverCancelTasks?.attempted || 0}; deleteTasks=${result.deleteTasks?.attempted || 0}; naverBlockTasks=${result.naverBlockTasks?.attempted || 0}; naverRestoreTasks=${result.naverRestoreTasks?.attempted || 0}; spacecloudCancelTasks=${result.spacecloudCancelTasks?.attempted || 0}`);
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
