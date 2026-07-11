#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  checkSpacecloudLogin,
  createSpacecloudPlaywrightUploader,
  deleteSpacecloudDirectReservation,
  openSpacecloudContext,
} from './spacecloud-playwright-uploader.mjs';
import {
  checkNaverSmartplaceLogin,
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
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function usage() {
  return `Usage:
  node tools/spacecloud-watch.mjs login [options]
  node tools/spacecloud-watch.mjs check-login [options]
  node tools/spacecloud-watch.mjs check-naver-login [options]
  node tools/spacecloud-watch.mjs notify-test [options]
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
  --interval-seconds <n>    Defaults to 60 for watch mode.
  --limit-per-cycle <n>     Defaults to 3.
  --delete-limit-per-cycle <n>
                            Defaults to 2.
  --naver-block-limit-per-cycle <n>
                            Defaults to 2.
  --naver-business-id <id>  Defaults to 1257912.
  --headless                Run Chrome headless. Not recommended for first login.
  --dry-run                 Plan only; do not upload.
  --json                    Print machine-readable output for once/check-login.
  --no-telegram             Disable Telegram notifications.

Examples:
  node tools/spacecloud-watch.mjs login
  node tools/spacecloud-watch.mjs check-login
  node tools/spacecloud-watch.mjs check-naver-login
  node tools/spacecloud-watch.mjs notify-test
  node tools/spacecloud-watch.mjs once --dry-run
  node tools/spacecloud-watch.mjs watch --interval-seconds 60 --limit-per-cycle 3
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
    intervalSeconds: 60,
    limitPerCycle: 3,
    deleteLimitPerCycle: 2,
    naverBlockLimitPerCycle: 2,
    naverBusinessId: '1257912',
    headless: false,
    dryRun: false,
    json: false,
    telegram: true,
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
  const cp = spawnSync('ssh', [
    '-i',
    target.SSH_KEY,
    '-o',
    'IdentitiesOnly=yes',
    target.SSH_TARGET,
    'bash -s',
  ], {
    cwd: process.cwd(),
    input: script,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (cp.status !== 0) {
    throw new Error((cp.stderr || cp.stdout || `ssh exited ${cp.status}`).trim());
  }
  return cp.stdout;
}

async function fetchRemoteTasks(args, { taskType, limit }) {
  const target = await loadCafe24Target(args);
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_TASK_TYPE=${shellQuote(taskType)}
export TASK_LIMIT=${shellQuote(limit)}
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

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
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
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                id,
                status,
                room_key AS roomKey,
                reservation_number AS reservationNo,
                reserver_name AS reserverName,
                product,
                DATE_FORMAT(reservation_date, '%%Y-%%m-%%d') AS date,
                TIME_FORMAT(start_time, '%%H:%%i') AS startTime,
                TIME_FORMAT(end_time, '%%H:%%i') AS endTime,
                payload_json AS payloadJson,
                attempts
            FROM rhythmjoy_spacecloud_tasks
            WHERE task_type=%s
              AND (
                status='pending'
                OR (status='google_pending' AND %s='naver_block')
                OR (status='running' AND locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
              )
            ORDER BY created_at ASC, id ASC
            LIMIT %s
            """,
            (
                os.environ['RHYTHMJOY_TASK_TYPE'],
                os.environ['RHYTHMJOY_TASK_TYPE'],
                int(os.environ.get('TASK_LIMIT', '2')),
            )
        )
        rows = cur.fetchall()
        ids = [row['id'] for row in rows]
        if ids:
            cur.execute(
                f"""
                UPDATE rhythmjoy_spacecloud_tasks
                SET status='running', attempts=attempts+1, locked_at=NOW(), updated_at=NOW()
                WHERE id IN ({','.join(['%s'] * len(ids))})
                """,
                ids
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

async function fetchRemoteNaverBlockTasks(args) {
  return fetchRemoteTasks(args, {
    taskType: 'naver_block',
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

async function createRemoteGoogleEventForNaverBlockTask(args, taskId) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({ taskId }), 'utf8').toString('base64');
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
            SELECT id, email_event_id, reservation_number, payload_json
            FROM rhythmjoy_spacecloud_tasks
            WHERE id=%s AND task_type='naver_block'
            LIMIT 1
            """,
            (task_id,),
        )
        task = cur.fetchone()
    if not task:
        print(json.dumps({'status': 'failed', 'error': f'task not found: {task_id}'}, ensure_ascii=False))
        raise SystemExit(0)

    event_data = json.loads(task.get('payload_json') or '{}')
    calendar_key = event_data.get('calendarKey') or event_data.get('calendar_key')
    if not calendar_key:
        print(json.dumps({'status': 'failed', 'error': 'calendar key missing'}, ensure_ascii=False))
        raise SystemExit(0)
    event_data['target_calendar'] = calendar_key
    event_data['calendar_key'] = calendar_key

    reservation_number = event_data.get('reservation_number') or task.get('reservation_number') or ''
    existing = importer.find_calendar_event_by_reservation(service, calendar_key, reservation_number, logger)
    if existing:
        if task.get('email_event_id'):
            importer.update_email_processing(
                config,
                task['email_event_id'],
                'calendar_after_apply_existing',
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
                'calendar_after_apply_conflict',
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
            'calendar_after_apply_created',
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

async function sendTelegram(args, text) {
  if (!args.telegram) return { sent: false, reason: 'disabled' };
  if (process.env.TELEGRAM_DRY_RUN === '1') {
    logLine(`telegram dry-run: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
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
      body: JSON.stringify({ chat_id: chatId, text }),
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
      textPreview: text.replace(/\s+/g, ' ').slice(0, 240),
    };
    await writeJson(args.notifyState, state);
    if (result.sent) logLine(`telegram sent: ${key}`);
    return result;
  } catch (error) {
    state[key] = {
      lastAttemptAt: new Date().toISOString(),
      lastSentAt: state[key]?.lastSentAt || null,
      result: { sent: false, reason: String(error?.message || error) },
      textPreview: text.replace(/\s+/g, ' ').slice(0, 240),
    };
    await writeJson(args.notifyState, state);
    logLine(`telegram failed: ${String(error?.message || error)}`);
    return { sent: false, reason: String(error?.message || error) };
  }
}

function isLoginProblem(message) {
  return /login|logged out|add button not visible|로그인|세션|인증/i.test(String(message || ''));
}

function loginNeededMessage(rowOrError) {
  const errorText = typeof rowOrError === 'string'
    ? rowOrError
    : (rowOrError?.failed || []).map((row) => row.error).filter(Boolean).join('\n');
  const candidates = typeof rowOrError === 'object' ? rowOrError?.uploadCandidates : null;
  return `스페이스클라우드 로그인 필요
${kstNowText()}

자동등록/자동삭제가 로그인 또는 세션 확인 단계에서 대기 중입니다.
조치: 이 Mac의 자동화 Chrome 창에서 네이버/스페이스클라우드 로그인을 다시 해주세요.

등록 후보: ${candidates ?? '-'}건
오류: ${String(errorText || '-').slice(0, 500)}
로그: /Users/inteyeo/Rhythmjoy_calendar/state/spacecloud-watch/launchd.log`;
}

function uploadFailureMessage(rowOrError) {
  const errorText = typeof rowOrError === 'string'
    ? rowOrError
    : (rowOrError?.failed || []).map((row) => `${row.fingerprint}: ${row.error}`).filter(Boolean).join('\n');
  return `스페이스클라우드 자동등록 확인 필요
${kstNowText()}

로그인 문제가 아닌 등록 오류가 발생해 자동 반복을 멈췄습니다.

오류: ${String(errorText || '-').slice(0, 900)}
로그: /Users/inteyeo/Rhythmjoy_calendar/state/spacecloud-watch/launchd.log`;
}

function formatUploadRowLine(row) {
  return [
    `방=${row.roomKey || '-'}`,
    `일시=${row.date || '-'} ${row.startTime || '-'}-${row.endTime || '-'}`,
    `예약번호=${row.reservationNo || '-'}`,
    `예약자=${row.reserverName || '-'}`,
  ].join('\n');
}

function uploadSuccessMessage(row) {
  const uploadedRows = row.uploadedRows || [];
  const detailText = uploadedRows.map(formatUploadRowLine).join('\n\n');
  return `스페이스클라우드 자동등록 완료
${kstNowText()}

Google Calendar 확정 일정이 SpaceCloud 직접 추가 예약으로 등록됐습니다.

등록건수: ${uploadedRows.length}건
남은 후보: ${row.remainingInPlan ?? '-'}건

${String(detailText || '-').slice(0, 1200)}

로그: /Users/inteyeo/Rhythmjoy_calendar/state/spacecloud-watch/launchd.log`;
}

function formatDeleteTaskLine(row) {
  const verificationErrors = row.deleteVerification?.errors?.length
    ? ` / 검증실패=${row.deleteVerification.errors.join(',')}`
    : '';
  return [
    `task=${row.taskId || '-'}`,
    `방=${row.roomKey || '-'}`,
    `일시=${row.date || '-'} ${row.startTime || '-'}-${row.endTime || '-'}`,
    `예약번호=${row.reservationNo || '-'}`,
    `상태=${row.status || '-'}`,
    `사유=${row.error || '-'}${verificationErrors}`,
  ].join('\n');
}

function deleteFailureMessage(rowOrError) {
  const errorText = typeof rowOrError === 'string'
    ? rowOrError
    : (rowOrError?.failed || []).map(formatDeleteTaskLine).filter(Boolean).join('\n\n');
  return `스페이스클라우드 자동삭제 확인 필요
${kstNowText()}

Google Calendar 취소 처리와 별개로 SpaceCloud 삭제 작업 중 확인이 필요한 항목이 생겼습니다.
자동삭제는 직접 추가한 예약이고 방/시간/예약번호가 모두 맞을 때만 실행됩니다. 조건이 맞지 않으면 삭제하지 않고 멈춥니다.

오류: ${String(errorText || '-').slice(0, 1200)}
로그: /Users/inteyeo/Rhythmjoy_calendar/state/spacecloud-watch/launchd.log`;
}

function formatNaverBlockTaskLine(row) {
  const googleStatus = row.googleCalendar?.status
    ? `구글=${row.googleCalendar.status}${row.googleCalendar.eventId ? `(${row.googleCalendar.eventId})` : ''}`
    : '구글=-';
  return [
    `task=${row.taskId || '-'}`,
    `방=${row.roomKey || '-'}`,
    `일시=${row.date || '-'} ${row.startTime || '-'}-${row.endTime || '-'}`,
    `예약번호=${row.reservationNo || '-'}`,
    `예약자=${row.reserverName || '-'}`,
    `상태=${row.status || '-'}`,
    googleStatus,
    `사유=${row.error || '-'}`,
  ].join('\n');
}

function naverBlockTaskSummary(task) {
  return {
    taskId: task.id || task.taskId || null,
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
  const processed = (row.naverBlockTasks?.rows || []).filter((taskRow) => ['blocked', 'already-blocked', 'google-recorded'].includes(taskRow.status));
  const detailText = processed.map(formatNaverBlockTaskLine).join('\n\n');
  return `네이버 예약불가 반영 완료
${kstNowText()}

스페이스클라우드 예약완료 메일 기준으로 네이버 SmartPlace 해당 시간 예약가능 슬롯을 막고, 그 다음 Google Calendar에 기록했습니다.

처리건수: ${processed.length}건

${String(detailText || '-').slice(0, 1200)}

로그: /Users/inteyeo/Rhythmjoy_calendar/state/spacecloud-watch/launchd.log`;
}

function naverBlockFailureMessage(rowOrError) {
  const errorText = typeof rowOrError === 'string'
    ? rowOrError
    : (rowOrError?.failed || []).map(formatNaverBlockTaskLine).filter(Boolean).join('\n\n');
  return `네이버 예약불가 자동처리 확인 필요
${kstNowText()}

스페이스클라우드 예약완료 메일은 감지됐지만 네이버 예약불가 반영 또는 반영 후 Google Calendar 기록 중 확인이 필요한 항목이 생겼습니다.
네이버에 이미 확정/마감 슬롯이 있으면 네이버 예약을 우선으로 보고 자동 수정하지 않습니다.
Google Calendar 기록만 일시 실패한 경우에는 작업을 google_pending으로 되돌리고 다음 주기에 기록만 재시도합니다.

오류: ${String(errorText || '-').slice(0, 1200)}
로그: /Users/inteyeo/Rhythmjoy_calendar/state/spacecloud-watch/launchd.log`;
}

function cycleErrorMessage(errorText) {
  return `스페이스클라우드 자동화 점검 필요
${kstNowText()}

자동등록/자동삭제 감시 주기에서 오류가 발생해 반복 실행을 멈췄습니다.
가능 원인: Cafe24 SSH/DB 조회 실패, Google Calendar cache 응답 실패, 로컬 브라우저 자동화 오류.

오류: ${String(errorText || '-').slice(0, 900)}
로그: /Users/inteyeo/Rhythmjoy_calendar/state/spacecloud-watch/launchd.log`;
}

function dbStatusForDeleteRow(row) {
  if (row.status === 'deleted') return 'done';
  if (row.status === 'already-gone') return 'already_gone';
  if (row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForNaverBlockRow(row) {
  if (row.status === 'blocked' || row.status === 'already-blocked' || row.status === 'google-recorded') return 'done';
  if (row.status === 'google-create-failed') return 'google_pending';
  if (row.status === 'google-conflict') return 'needs_review';
  if (row.status === 'naver-conflict' || row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  return 'failed';
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
      const row = await deleteSpacecloudDirectReservation(activeContext, task);
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

  const failed = rows.filter((row) => !['deleted', 'already-gone'].includes(row.status));
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
      if (task.status === 'google_pending') {
        row = {
          ...naverBlockTaskSummary(task),
          status: 'google-pending',
          startedAt: new Date().toISOString(),
          naverAlreadyApplied: true,
        };
        const googleResult = await createRemoteGoogleEventForNaverBlockTask(args, task.id);
        row.googleCalendar = googleResult;
        if (['created', 'existing'].includes(googleResult.status)) {
          row.status = 'google-recorded';
        } else {
          row.status = googleResult.status === 'conflict' ? 'google-conflict' : 'google-create-failed';
          row.error = googleResult.error || `Google Calendar after-apply result: ${googleResult.status || 'unknown'}`;
        }
        row.finishedAt = new Date().toISOString();
      } else {
        row = await setNaverAvailability(activeContext, task, {
          businessId: args.naverBusinessId,
          targetStatus: 'unavailable',
        });
        if (['blocked', 'already-blocked'].includes(row.status)) {
          const googleResult = await createRemoteGoogleEventForNaverBlockTask(args, task.id);
          row.googleCalendar = googleResult;
          if (!['created', 'existing'].includes(googleResult.status)) {
            row.status = googleResult.status === 'conflict' ? 'google-conflict' : 'google-create-failed';
            row.error = googleResult.error || `Google Calendar after-apply result: ${googleResult.status || 'unknown'}`;
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

  const failed = rows.filter((row) => !['blocked', 'already-blocked', 'google-recorded'].includes(row.status));
  return {
    status: failed.length ? 'naver-block-needs-review' : 'naver-block-processed',
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
  const plan = await buildPlan(args, planPath);
  const cycle = {
    at: new Date().toISOString(),
    planPath,
    resultsPath,
    sourceGeneratedAt: plan.source?.generatedAt || null,
    sourceEventsInRange: plan.source?.eventCountInRange || 0,
    uploadCandidates: plan.upload.length,
    skipped: plan.skipped.length,
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
      status: plan.upload.length === 0 || args.dryRun ? 'planned' : 'uploaded',
      attempted: 0,
      submittedInPlan: 0,
      remainingInPlan: plan.upload.length,
      marked: 0,
      failed: [],
    };

    if (plan.upload.length > 0 && !args.dryRun) {
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

    if (!row.failed?.length) {
      row.deleteTasks = await runDeleteTasks(args, activeContext);
      if (row.status === 'planned' && row.deleteTasks.attempted > 0) {
        row.status = row.deleteTasks.failed.length ? 'delete-needs-review' : 'delete-processed';
      }
    }

    if (!row.failed?.length && !row.deleteTasks?.failed?.length) {
      row.naverBlockTasks = await runNaverBlockTasks(args, activeContext);
      if (row.status === 'planned' && row.naverBlockTasks.attempted > 0) {
        row.status = row.naverBlockTasks.failed.length ? 'naver-block-needs-review' : 'naver-block-processed';
      }
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

  logLine(`watch started; interval=${args.intervalSeconds}s profile=${args.profileDir}`);
  try {
    while (!stopping) {
      try {
        const row = await runCycle(args, context);
        logLine(`cycle ${row.status}; candidates=${row.uploadCandidates}; attempted=${row.attempted || 0}; remaining=${row.remainingInPlan ?? 0}; deleteTasks=${row.deleteTasks?.attempted || 0}; naverBlockTasks=${row.naverBlockTasks?.attempted || 0}`);
        if (row.uploadedRows?.length) {
          const result = await sendTelegram(args, uploadSuccessMessage(row));
          if (result.sent) logLine(`telegram sent: spacecloud-upload-success count=${row.uploadedRows.length}`);
          else logLine(`telegram upload success skipped: ${result.reason}`);
        }
        if (row.naverBlockTasks?.rows?.some((taskRow) => ['blocked', 'already-blocked', 'google-recorded'].includes(taskRow.status))) {
          const result = await sendTelegram(args, naverBlockSuccessMessage(row));
          if (result.sent) logLine(`telegram sent: naver-block-success count=${row.naverBlockTasks.rows.length}`);
          else logLine(`telegram naver block success skipped: ${result.reason}`);
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
        if (row.deleteTasks?.failed?.length) {
          const errorText = row.deleteTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(errorText));
            logLine(`login needed during delete; waiting for manual login: ${JSON.stringify(row.deleteTasks.failed)}`);
          } else {
            await notifyWithCooldown(args, 'spacecloud-delete-failed', deleteFailureMessage(row.deleteTasks));
            logLine(`stopping after delete failure: ${JSON.stringify(row.deleteTasks.failed)}`);
            break;
          }
        }
        if (row.naverBlockTasks?.failed?.length) {
          const errorText = row.naverBlockTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await notifyWithCooldown(args, 'spacecloud-login-needed', loginNeededMessage(errorText));
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
    const result = await sendTelegram(args, `스페이스클라우드 자동화 알림 테스트
${kstNowText()}

이 메시지가 보이면 등록 완료, 로그인 필요, 등록 실패, 삭제 확인 필요, 감시 주기 오류 알림도 텔레그램으로 전송됩니다.`);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.sent ? 'Telegram notification OK' : `Telegram notification skipped: ${result.reason}`);
    return;
  }

  if (args.command === 'once') {
    const result = await runCycle(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`cycle ${result.status}; candidates=${result.uploadCandidates}; attempted=${result.attempted || 0}; remaining=${result.remainingInPlan ?? 0}; deleteTasks=${result.deleteTasks?.attempted || 0}; naverBlockTasks=${result.naverBlockTasks?.attempted || 0}`);
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
