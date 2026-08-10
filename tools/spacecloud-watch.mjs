#!/usr/bin/env node

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  cancelSpacecloudConfirmedReservation,
  checkSpacecloudLogin,
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
const CONFIRMATION_INFO_URLS = {
  n: 'https://리듬앤조이일정표.com/n',
  s: 'https://리듬앤조이일정표.com/s',
};
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
  --headless                Run Chrome headless. Not recommended for first login.
  --dry-run                 Do not mutate DB rows or platform UI.
  --json                    Print machine-readable output for once/check-login.
  --no-telegram             Disable Telegram notifications.
  --to <phone>              Recipient for sms-test.
  --sms-test-task-id <id>   Optional fixed test id for duplicate-send checks.
  --sms-test-task-type <type>
                            Optional source task type for sms-test records.
  --sms-test-source <source>
                            Optional source for sms-test links: naver or spacecloud.
  --sms-test-date <YYYY-MM-DD>
  --sms-test-room <key>     Reservation values rendered by sms-test.
  --sms-test-start <HH:MM>
  --sms-test-end <HH:MM>

Examples:
  node tools/spacecloud-watch.mjs login
  node tools/spacecloud-watch.mjs check-login
  node tools/spacecloud-watch.mjs check-naver-login
  node tools/spacecloud-watch.mjs notify-test
  node tools/spacecloud-watch.mjs sms-test --to 01000000000 --json
  node tools/spacecloud-watch.mjs sms-test --to 01000000000 --sms-test-source naver --json
  node tools/spacecloud-watch.mjs once --dry-run
  node tools/spacecloud-watch.mjs watch --interval-seconds 30 --limit-per-cycle 3
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
    headless: false,
    dryRun: false,
    json: false,
    telegram: true,
    smsTestTo: '',
    smsTestTaskId: '',
    smsTestTaskType: 'manual_sms_test',
    smsTestSource: 'manual-test',
    smsTestDate: '',
    smsTestRoom: '',
    smsTestStart: '',
    smsTestEnd: '',
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
    } else if (key === 'sms-test-date') {
      args.smsTestDate = next;
    } else if (key === 'sms-test-room') {
      args.smsTestRoom = next;
    } else if (key === 'sms-test-start') {
      args.smsTestStart = next;
    } else if (key === 'sms-test-end') {
      args.smsTestEnd = next;
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function acquireAutomationProcessLock(workDir) {
  const lockPath = path.join(workDir, 'automation-process.lock');
  const token = `${process.pid}-${Date.now()}`;
  const create = async () => {
    const handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
    return handle;
  };

  let handle;
  try {
    handle = await create();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let existing = {};
    try {
      existing = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    } catch {
      existing = {};
    }
    if (processIsAlive(Number(existing.pid))) {
      throw new Error(`automation process already running: pid=${existing.pid}`);
    }
    await fs.unlink(lockPath).catch((unlinkError) => {
      if (unlinkError?.code !== 'ENOENT') throw unlinkError;
    });
    handle = await create();
  }

  return async () => {
    await handle.close().catch(() => {});
    try {
      const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (current.token === token) await fs.unlink(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
}

async function withAutomationProcessLock(args, callback) {
  const release = await acquireAutomationProcessLock(args.workDir);
  try {
    return await callback();
  } finally {
    await release();
  }
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

function redactPhoneText(value) {
  return String(value || '').replace(/01[016789][\s-]?\d{3,4}[\s-]?\d{4}/g, (phone) => maskPhone(phone));
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
  return CONFIRMATION_INFO_URLS[platformCode] || DEFAULT_CONFIRMATION_INFO_URL;
}

function confirmationSmsDateText(task) {
  const raw = String(task?.date || task?.reservation_date || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return raw || '-';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}${weekday}`;
}

function confirmationSmsClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return { hour, minute, total: hour * 60 + minute };
}

function confirmationSmsPeriod(totalMinutes) {
  const minuteOfDay = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  if (minuteOfDay < 6 * 60) return '새벽';
  if (minuteOfDay < 12 * 60) return '오전';
  return '오후';
}

function confirmationSmsClockText(clock, { midnightAs24 = false } = {}) {
  if (!clock) return '-';
  const hour = midnightAs24 && clock.total === 0 ? 24 : clock.hour;
  const hourText = String(hour).padStart(2, '0');
  return clock.minute === 0 ? hourText : `${hourText}:${String(clock.minute).padStart(2, '0')}`;
}

function confirmationSmsTimeText(task) {
  const start = confirmationSmsClock(task?.startTime || task?.start_time);
  const end = confirmationSmsClock(task?.endTime || task?.end_time);
  if (!start || !end) {
    const rawStart = String(task?.startTime || task?.start_time || '-');
    const rawEnd = String(task?.endTime || task?.end_time || '-');
    return `${rawStart}-${rawEnd}`;
  }

  const startTotal = start.total === 24 * 60 ? 0 : start.total;
  const rawEndTotal = end.total === 24 * 60 ? 0 : end.total;
  const crossesMidnight = rawEndTotal < startTotal || (rawEndTotal === 0 && startTotal > 0);
  const absoluteEnd = rawEndTotal + (crossesMidnight ? 24 * 60 : 0);
  const occupiedEndMinute = Math.max(startTotal, absoluteEnd - 1);
  const startPeriod = confirmationSmsPeriod(startTotal);
  const endPeriod = confirmationSmsPeriod(occupiedEndMinute);
  const startText = confirmationSmsClockText(start);
  const midnightEnd = crossesMidnight && rawEndTotal === 0;
  const endText = confirmationSmsClockText(end, { midnightAs24: midnightEnd });

  if (startPeriod === endPeriod && (!crossesMidnight || midnightEnd)) {
    return `${startPeriod}${startText}-${endText}시`;
  }
  const nextDay = crossesMidnight ? '익일' : '';
  return `${startPeriod}${startText}-${nextDay}${endPeriod}${endText}시`;
}

function legacySmsByteLength(value) {
  return Array.from(String(value || '')).reduce(
    (total, character) => total + (character.codePointAt(0) <= 0x7f ? 1 : 2),
    0,
  );
}

function confirmationSmsMessage(task = {}, source = '') {
  if (process.env.RHYTHMJOY_CONFIRMATION_SMS_MESSAGE) {
    return process.env.RHYTHMJOY_CONFIRMATION_SMS_MESSAGE;
  }
  const room = String(task.roomKey || task.room_key || '-').trim().toUpperCase();
  const time = confirmationSmsTimeText(task).replace(/시$/, '');
  const detail = `${confirmationSmsDateText(task)} ${room}홀 ${time}`;
  const message = `리듬앤조이 확정문자\n${detail}\n비번 정보\n${confirmationInfoUrl(source)}`;
  if (legacySmsByteLength(message) > 90) {
    throw new Error(`confirmation SMS exceeds 90 bytes: ${legacySmsByteLength(message)}`);
  }
  return message;
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
    'google-backfill': '과거백필',
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
  if (result?.reason) safe.reason = redactPhoneText(result.reason);
  if (result?.error) safe.error = cleanTelegramText(redactPhoneText(result.error), 180);
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
        cur.execute(
            """
            INSERT IGNORE INTO rhythmjoy_sms_deliveries (
                idempotency_key, source_task_type, source_task_id, template_name,
                recipient_phone_hash, recipient_phone_last4, status,
                created_at, updated_at
            )
            VALUES (%s,%s,%s,%s,%s,%s,'sending',NOW(),NOW())
            """,
            (idempotency_key, task_type, task_id or None, template_name, phone_hash, phone[-4:]),
        )
        claimed = cur.rowcount == 1
        if not claimed:
            cur.execute('SELECT * FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
            existing = cur.fetchone() or {}
            existing_status = existing.get('status') or ''
            if existing_status == 'sent':
                print(json.dumps({
                    'status': 'already_sent',
                    'deliveryId': existing.get('id'),
                    'maskedPhone': masked,
                    'templateName': template_name,
                    'providerCode': existing.get('provider_code') or '',
                    'remaining': existing.get('provider_remaining'),
                }, ensure_ascii=False))
                raise SystemExit(0)
            if existing_status == 'failed':
                cur.execute(
                    """
                    UPDATE rhythmjoy_sms_deliveries
                    SET status='sending', error_text=NULL, updated_at=NOW()
                    WHERE idempotency_key=%s AND status='failed'
                    """,
                    (idempotency_key,),
                )
                claimed = cur.rowcount == 1
            if not claimed:
                print(json.dumps({
                    'status': 'needs_review' if existing_status == 'uncertain' else 'delivery_in_progress',
                    'deliveryId': existing.get('id'),
                    'maskedPhone': masked,
                    'templateName': template_name,
                    'reason': 'provider-result-uncertain-no-auto-resend' if existing_status == 'uncertain' else 'same-message-send-already-claimed',
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
                UPDATE rhythmjoy_sms_deliveries
                SET status=%s,
                    provider_code=%s,
                    provider_remaining=%s,
                    provider_raw=%s,
                    error_text=%s,
                    sent_at=IF(%s='sent', NOW(), sent_at),
                    updated_at=NOW()
                WHERE idempotency_key=%s AND status='sending'
                """,
                (
                    status, result.get('code') or '', result.get('remaining'),
                    str(result.get('raw') or '')[:255], error_text, status, idempotency_key,
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
                UPDATE rhythmjoy_sms_deliveries
                SET status='uncertain', error_text=%s, updated_at=NOW()
                WHERE idempotency_key=%s AND status='sending'
                """,
                (str(error)[:1000], idempotency_key),
            )
            cur.execute('SELECT id FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
            saved = cur.fetchone() or {}
            print(json.dumps({
                'status': 'needs_review',
                'deliveryId': saved.get('id'),
                'maskedPhone': masked,
                'templateName': template_name,
                'reason': 'provider-result-uncertain-no-auto-resend',
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
    message: confirmationSmsMessage(task, source),
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

function shouldSendPriorBookingCancellationSms(task, row) {
  return row?.status === 'canceled'
    || (task?.recoveredFromStaleRunning === true && row?.status === 'already-canceled');
}

const REMOTE_TASK_ENRICHMENT_PY = String.raw`
from datetime import datetime, timedelta

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

def task_slot_datetimes(date_text, start_text, end_text):
    try:
        day = datetime.strptime(str(date_text or ''), '%Y-%m-%d')
        start_hour, start_minute = [int(part) for part in str(start_text or '').split(':')[:2]]
        end_hour, end_minute = [int(part) for part in str(end_text or '').split(':')[:2]]
    except (TypeError, ValueError):
        return None, None
    start_total = start_hour * 60 + start_minute
    end_total = end_hour * 60 + end_minute
    if end_total <= start_total:
        end_total += 24 * 60
    start_at = day + timedelta(minutes=start_total)
    end_at = day + timedelta(minutes=end_total)
    return start_at.strftime('%Y-%m-%d %H:%M:%S'), end_at.strftime('%Y-%m-%d %H:%M:%S')

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
        target_start_at, target_end_at = task_slot_datetimes(row.get('date'), row.get('startTime'), row.get('endTime'))
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
              AND COALESCE(source_mode, '') <> 'admin-task-anchor'
              AND DATE_ADD(TIMESTAMP(reservation_date, '00:00:00'), INTERVAL TIME_TO_SEC(start_time) SECOND) < %s
              AND DATE_ADD(
                    TIMESTAMP(reservation_date, '00:00:00'),
                    INTERVAL (TIME_TO_SEC(end_time) + IF(end_time <= start_time, 86400, 0)) SECOND
                  ) > %s
            ORDER BY COALESCE(last_event_at, created_at, '9999-12-31 23:59:59') ASC, id ASC
            LIMIT 10
            """,
            (
                row.get('roomKey'),
                target_end_at,
                target_start_at,
            ),
        )
        active_overlaps = cur.fetchall()
        row['restoreActiveOverlapCount'] = len(active_overlaps)
        row['restoreBlockingBookings'] = active_overlaps[:5]
        row['restoreSafeWithoutPriorBlock'] = len(active_overlaps) == 0
`;

function normalizeClaimedTaskForRecovery(task) {
  if (task?.status !== 'running') return task;
  let previousResultStatus = '';
  try {
    previousResultStatus = JSON.parse(task.resultText || '{}')?.status || '';
  } catch {
    previousResultStatus = '';
  }
  return {
    ...task,
    status: 'pending',
    recoveredFromStaleRunning: true,
    stalePreviousStatus: 'running',
    stalePreviousResultStatus: previousResultStatus,
    staleLockedAt: task.lockedAt || '',
    staleAttempts: task.attempts ?? null,
  };
}

function normalizeClaimedTasksForRecovery(tasks) {
  return (tasks || []).map(normalizeClaimedTaskForRecovery);
}

function safeTaskClaimLimit() {
  // One claim per transaction prevents untouched rows from remaining `running`
  // when a preceding platform operation stops the current cycle.
  return 1;
}

async function fetchRemoteTasks(args, { taskType, limit }) {
  const target = await loadCafe24Target(args);
  const opsRoot = target.OPS_ROOT || '/home/clown313python/rhythmjoy_ops';
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_OPS_ROOT=${shellQuote(opsRoot)}
export RHYTHMJOY_TASK_TYPE=${shellQuote(taskType)}
export TASK_LIMIT=${shellQuote(safeTaskClaimLimit(limit))}
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
                CAST(COALESCE(
                  (SELECT email_received_at FROM rhythmjoy_naver_email_events WHERE id=email_event_id LIMIT 1),
                  created_at
                ) AS CHAR) AS sourceReceivedAt,
                CAST(updated_at AS CHAR) AS updatedAt,
                result_text AS resultText
            FROM rhythmjoy_spacecloud_tasks
            WHERE task_type=%s
              AND (
                status='pending'
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
              COALESCE(
                (SELECT email_received_at FROM rhythmjoy_naver_email_events WHERE id=email_event_id LIMIT 1),
                created_at
              ) ASC,
              id ASC
            LIMIT %s
            FOR UPDATE
            """,
            (
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
            for row in rows:
                row['claimToken'] = claim_token
    conn.commit()
    print(json.dumps(rows, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return normalizeClaimedTasksForRecovery(JSON.parse(runSshScript(target, script).trim() || '[]'));
}

async function fetchRemoteTaskTypes(args, { taskTypes, limit }) {
  const target = await loadCafe24Target(args);
  const opsRoot = target.OPS_ROOT || '/home/clown313python/rhythmjoy_ops';
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_OPS_ROOT=${shellQuote(opsRoot)}
export RHYTHMJOY_TASK_TYPES=${shellQuote(JSON.stringify(taskTypes))}
export TASK_LIMIT=${shellQuote(safeTaskClaimLimit(limit))}
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
                CAST(COALESCE(
                  (SELECT email_received_at FROM rhythmjoy_naver_email_events WHERE id=email_event_id LIMIT 1),
                  created_at
                ) AS CHAR) AS sourceReceivedAt,
                CAST(updated_at AS CHAR) AS updatedAt,
                result_text AS resultText
            FROM rhythmjoy_spacecloud_tasks
            WHERE task_type IN ({placeholders})
              AND (
                status='pending'
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
              COALESCE(
                (SELECT email_received_at FROM rhythmjoy_naver_email_events WHERE id=email_event_id LIMIT 1),
                created_at
              ) ASC,
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
            for row in rows:
                row['claimToken'] = claim_token
    conn.commit()
    print(json.dumps(rows, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return normalizeClaimedTasksForRecovery(JSON.parse(runSshScript(target, script).trim() || '[]'));
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
                status=IF(status IN ('running', 'done', 'needs_review', 'failed'), status, 'pending'),
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
                status=IF(status IN ('running', 'done', 'needs_review', 'failed'), status, 'pending'),
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

async function updateRemoteTask(args, task, status, resultText, { releaseClaim = true } = {}) {
  const target = await loadCafe24Target(args);
  const sourcePayload = payloadForTask(task);
  const payload = Buffer.from(JSON.stringify({
    taskId: task.id || task.taskId,
    claimToken: task.claimToken || task.claim_token || '',
    taskType: task.taskType || task.task_type || '',
    adminReservationId: sourcePayload.admin_reservation_id || sourcePayload.adminReservationId || null,
    status,
    resultText: taskResultTextForDb(resultText),
    releaseClaim,
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
        release_claim = bool(payload.get('releaseClaim', True))
        processed_expr = 'NOW()' if release_claim and payload['status'] in ('done', 'already_gone', 'needs_review', 'failed') else 'processed_at'
        next_status = payload['status'] if release_claim else 'running'
        next_claim_token = '' if release_claim else payload['claimToken']
        cur.execute(
            f"""
            UPDATE rhythmjoy_spacecloud_tasks
            SET status=%s,
                processed_at={processed_expr},
                claim_token=%s,
                result_text=%s,
                updated_at=NOW()
            WHERE id=%s AND status='running' AND claim_token=%s
            """,
            (next_status, next_claim_token, payload['resultText'], payload['taskId'], payload['claimToken'])
        )
        updated = cur.rowcount
        if updated == 1:
            cur.execute(
                """
                UPDATE rhythmjoy_admin_sync_tasks
                SET status=%s, result_text=%s, updated_at=NOW()
                WHERE live_task_id=%s
                """,
                (next_status, payload['resultText'], payload['taskId']),
            )
            admin_reservation_id = payload.get('adminReservationId')
            if admin_reservation_id:
                cur.execute(
                    """
                    SELECT id, series_id, status
                    FROM rhythmjoy_admin_reservations
                    WHERE id=%s
                    LIMIT 1
                    """,
                    (admin_reservation_id,),
                )
                reservation = cur.fetchone() or {}
                if reservation:
                    cur.execute(
                        """
                        SELECT
                            SUM(action_type IN ('block_naver_availability','add_spacecloud_reservation')) AS create_total,
                            SUM(action_type IN ('block_naver_availability','add_spacecloud_reservation')
                                AND status IN ('done','already_gone')) AS create_done,
                            SUM(action_type IN ('delete_spacecloud_reservation','restore_naver_availability')) AS cancel_total,
                            SUM(action_type IN ('delete_spacecloud_reservation','restore_naver_availability')
                                AND status IN ('done','already_gone')) AS cancel_done
                        FROM rhythmjoy_admin_sync_tasks
                        WHERE reservation_id=%s
                        """,
                        (admin_reservation_id,),
                    )
                    totals = cur.fetchone() or {}
                    if reservation.get('status') == 'pending' and int(totals.get('create_total') or 0) >= 2 and int(totals.get('create_done') or 0) >= 2:
                        cur.execute("UPDATE rhythmjoy_admin_reservations SET status='confirmed', updated_at=NOW() WHERE id=%s", (admin_reservation_id,))
                    if reservation.get('status') == 'canceling' and int(totals.get('cancel_total') or 0) >= 2 and int(totals.get('cancel_done') or 0) >= 2:
                        cur.execute("UPDATE rhythmjoy_admin_reservations SET status='canceled', updated_at=NOW() WHERE id=%s", (admin_reservation_id,))
                    series_id = reservation.get('series_id')
                    if series_id:
                        cur.execute(
                            """
                            SELECT
                                SUM(reservation_date >= CURDATE() AND status <> 'canceled') AS remaining_count,
                                SUM(reservation_date >= CURDATE() AND status = 'canceling') AS canceling_count
                            FROM rhythmjoy_admin_reservations
                            WHERE series_id=%s
                            """,
                            (series_id,),
                        )
                        series_totals = cur.fetchone() or {}
                        if int(series_totals.get('remaining_count') or 0) == 0:
                            series_status = 'canceled'
                        elif int(series_totals.get('canceling_count') or 0) > 0:
                            series_status = 'canceling'
                        else:
                            series_status = 'active'
                        cur.execute("UPDATE rhythmjoy_admin_series SET status=%s, updated_at=NOW() WHERE id=%s", (series_status, series_id))
        print(json.dumps({'updated': updated}, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  const result = JSON.parse(runSshScript(target, script).trim() || '{}');
  if (result.updated !== 1) {
    throw new Error(`task claim lost before status update: task=${task.id || task.taskId || ''}`);
  }
  return result;
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

function notificationSuppressedByCooldown(entry, textPreview, now, cooldownSeconds) {
  const lastSentAt = entry?.lastSentAt ? Date.parse(entry.lastSentAt) : 0;
  return Boolean(
    entry?.textPreview === textPreview
    && lastSentAt
    && now - lastSentAt < cooldownSeconds * 1000
  );
}

function notificationSuppressedByState(entry, stateSignature) {
  return Boolean(entry?.stateSignature === stateSignature && entry?.lastSentAt);
}

async function notifyWithCooldown(args, key, text, {
  cooldownSeconds = args.notifyCooldownSeconds,
} = {}) {
  const state = await readJsonObject(args.notifyState);
  const now = Date.now();
  const textPreview = compactTelegramText(text).replace(/\s+/g, ' ').slice(0, 240);
  if (notificationSuppressedByCooldown(state[key], textPreview, now, cooldownSeconds)) {
    logLine(`telegram suppressed by cooldown: ${key}`);
    return { sent: false, reason: 'cooldown' };
  }

  try {
    const result = await sendTelegram(args, text);
    state[key] = {
      lastAttemptAt: new Date().toISOString(),
      lastSentAt: result.sent || result.reason === 'dry-run' ? new Date().toISOString() : state[key]?.lastSentAt || null,
      result,
      textPreview,
    };
    await writeJson(args.notifyState, state);
    if (result.sent) logLine(`telegram sent: ${key} ${telegramDeliverySummary(result)}`);
    return result;
  } catch (error) {
    state[key] = {
      lastAttemptAt: new Date().toISOString(),
      lastSentAt: state[key]?.lastSentAt || null,
      result: { sent: false, reason: String(error?.message || error) },
      textPreview,
    };
    await writeJson(args.notifyState, state);
    logLine(`telegram failed: ${String(error?.message || error)}`);
    return { sent: false, reason: String(error?.message || error) };
  }
}

async function notifyOnStateChange(args, key, stateSignature, text) {
  const state = await readJsonObject(args.notifyState);
  const previous = state[key] || {};
  if (notificationSuppressedByState(previous, stateSignature)) {
    logLine(`telegram suppressed; state unchanged: ${key} ${stateSignature}`);
    return { sent: false, reason: 'state-unchanged' };
  }

  const now = new Date().toISOString();
  const textPreview = compactTelegramText(text).replace(/\s+/g, ' ').slice(0, 240);
  try {
    const result = await sendTelegram(args, text);
    state[key] = {
      lastAttemptAt: now,
      lastSentAt: result.sent || result.reason === 'dry-run' ? now : previous.lastSentAt || null,
      stateSignature: result.sent || result.reason === 'dry-run'
        ? stateSignature
        : previous.stateSignature || null,
      result,
      textPreview,
    };
    await writeJson(args.notifyState, state);
    if (result.sent) logLine(`telegram sent on state change: ${key} ${stateSignature} ${telegramDeliverySummary(result)}`);
    return result;
  } catch (error) {
    state[key] = {
      ...previous,
      lastAttemptAt: now,
      result: { sent: false, reason: String(error?.message || error) },
      textPreview,
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
  const pastDays = Number.parseInt(process.env.RHYTHMJOY_REFLECTION_AUDIT_PAST_DAYS || '3650', 10);
  const futureDays = Number.parseInt(process.env.RHYTHMJOY_REFLECTION_AUDIT_FUTURE_DAYS || '730', 10);
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export REFLECTION_AUDIT_GRACE_MINUTES=${shellQuote(Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : 10)}
export REFLECTION_AUDIT_PAST_DAYS=${shellQuote(Number.isFinite(pastDays) && pastDays >= 0 ? pastDays : 3650)}
export REFLECTION_AUDIT_FUTURE_DAYS=${shellQuote(Number.isFinite(futureDays) && futureDays > 0 ? futureDays : 730)}
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

function reservationSlotInterval(slot) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(slot?.date || slot?.reservation_date || ''));
  const start = minutesFromTimeText(slot?.startTime || slot?.start_time);
  let end = minutesFromTimeText(slot?.endTime || slot?.end_time);
  if (!dateMatch || start === null || end === null) return null;
  if (end <= start) end += 24 * 60;
  const dayStart = Date.UTC(
    Number.parseInt(dateMatch[1], 10),
    Number.parseInt(dateMatch[2], 10) - 1,
    Number.parseInt(dateMatch[3], 10),
  ) / 60000;
  return { start: dayStart + start, end: dayStart + end };
}

function reservationSlotsOverlap(left, right) {
  const leftInterval = reservationSlotInterval(left);
  const rightInterval = reservationSlotInterval(right);
  if (!leftInterval || !rightInterval) return false;
  return leftInterval.start < rightInterval.end && leftInterval.end > rightInterval.start;
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
  const row = rowsFromResult(rowOrError).find((item) => item.error || item.reason || item.status) || {};
  return cleanTelegramText(row.error || row.reason || row.status || '-', 180);
}

function firstProblemRow(rowOrError) {
  return rowsFromResult(rowOrError).find((item) => (
    item.error
    || item.reason
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
    'google-backfill': '과거백필',
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
  const row = firstProblemRow(rowOrError);
  const raw = String(row.error || row.reason || row.status || '');

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

function smsStatusText(status) {
  const map = {
    sent: '발송 성공',
    already_sent: '이미 발송됨',
    delivery_in_progress: '동일 문자 발송 진행 중',
    needs_review: '발송 결과 확인 필요',
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
    const reason = ['failed', 'skipped', 'delivery_in_progress', 'needs_review'].includes(sms.status)
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
    if (status === 'submitted') return 'SC 등록 완료';
    return `SC 등록 ${telegramStatusText(status)}`;
  }
  if (taskType === 'naver_block') {
    if (['blocked', 'already-blocked'].includes(status)) return '네이버 예약불가 완료';
    return `네이버 예약불가 ${telegramStatusText(status)}`;
  }
  if (taskType === 'naver_restore') {
    if (status === 'restore-skipped-not-owned') return '네이버 복구 생략';
    if (['restored', 'already-available'].includes(status)) return '네이버 예약가능 복구 완료';
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

function syncPlatformResultLine(row) {
  const taskType = row.taskType || row.task_type || '';
  const action = syncActionResultText(row);
  if (taskType === 'upload' || taskType === 'delete' || taskType === 'spacecloud_cancel') {
    return `스페이스클라우드: ${action.replace(/^SC\s*/, '')}`;
  }
  if (taskType === 'naver_block' || taskType === 'naver_restore' || taskType === 'naver_cancel') {
    return `네이버: ${action.replace(/^네이버\s*/, '')}`;
  }
  return `상대 플랫폼: ${action}`;
}

function syncSmsStatusText(row) {
  const sms = row.sms || null;
  if (!sms) return '';
  const phone = sms.maskedPhone ? ` ${sms.maskedPhone}` : '';
  const reason = ['failed', 'skipped', 'delivery_in_progress', 'needs_review'].includes(sms.status)
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
    ...successRowsForResult(row.uploadTasks, ['submitted'], 'upload'),
    ...successRowsForResult(row.naverBlockTasks, ['blocked', 'already-blocked'], 'naver_block'),
    ...successRowsForResult(row.naverRestoreTasks, ['restored', 'already-available', 'restore-skipped-not-owned'], 'naver_restore'),
    ...successRowsForResult(row.deleteTasks, ['deleted', 'already-gone'], 'delete'),
    ...successRowsForResult(row.spacecloudCancelTasks, ['canceled', 'already-canceled'], 'spacecloud_cancel'),
    ...successRowsForResult(row.naverCancelTasks, ['canceled', 'already-canceled'], 'naver_cancel'),
  ];
  const seen = new Set();
  return rows.filter((taskRow) => {
    if (taskRow.adminPanelTask === true) return false;
    const key = taskIdentityKey(taskRow);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function syncSuccessNeedsAttention(row) {
  return smsNeedsAttention(row);
}

function syncSuccessMessage(row) {
  const needsAttention = syncSuccessNeedsAttention(row);
  const taskType = row.taskType || row.task_type || '';
  const isCancellation = ['delete', 'naver_restore', 'spacecloud_cancel', 'naver_cancel'].includes(taskType);
  const smsStatus = syncSmsStatusText(row);
  return compactNotice(
    needsAttention
      ? '🟡 예약 반영 후 확인 필요'
      : (isCancellation ? '✅ 예약 취소 반영 완료' : '✅ 예약 반영 완료'),
    [
      syncReservationLine(row),
      'DB 원장: 정상',
      syncPlatformResultLine(row),
      smsStatus || '',
      needsAttention ? '판정: 실제 예약 누락 확정 아님' : '',
    ],
  );
}

function reservationNotificationKey(row, fallbackTaskType = '') {
  return `reservation:${taskIdentityKey(row, fallbackTaskType)}`;
}

function reservationCompletionSignature(row) {
  return [
    'complete',
    row.status || '',
    row.sms?.status || '',
  ].join(':');
}

function reservationAttentionSignature(rowOrError, category) {
  const row = firstProblemRow(rowOrError);
  return `attention:${category}:${row.status || 'failed'}`;
}

async function notifyReservationAttention(args, rowOrError, category, taskType, text) {
  const row = firstProblemRow(rowOrError);
  const notificationKey = row.adminPanelTask && row.adminSeriesId
    ? `admin-series:${row.adminSeriesId}`
    : reservationNotificationKey(row, taskType);
  return notifyOnStateChange(
    args,
    notificationKey,
    reservationAttentionSignature(rowOrError, category),
    text,
  );
}

async function notifyWatcherProblem(args, stateSignature, text) {
  return notifyOnStateChange(args, 'system:watcher', stateSignature, text);
}

async function notifyWatcherRecoveredIfNeeded(args) {
  const state = await readJsonObject(args.notifyState);
  const previous = state['system:watcher'] || {};
  if (!previous.lastSentAt || !String(previous.stateSignature || '').startsWith('problem:')) return;
  await notifyOnStateChange(
    args,
    'system:watcher',
    'healthy',
    compactNotice('✅ 자동화 정상 복구', [
      'DB 연결 및 예약 감시: 정상',
      '이전 시스템 경고가 해제됐습니다.',
    ]),
  );
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
  return compactNotice('🟡 자동화 로그인 필요', [
    '예약 감시: 로그인 확인 대기',
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
    ...((row.uploadTasks?.rows || []).filter((taskRow) => taskRow.status === 'submitted')),
  ];
  return compactNotice('✅ 성공: 스페이스클라우드 등록', [
    `처리: ${uploadedRows.length}건`,
    formatBriefRows(uploadedRows),
  ]);
}

function uploadTaskFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  return compactNotice('🟡 스페이스클라우드 자동확인 필요', [
    formatBriefRows(rows),
    'DB 원장: 정상',
    '판정: 실제 플랫폼 누락 확정 아님',
    `자동화 기록: ${firstFailureReason(rowOrError)}`,
  ]);
}

function deleteFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  return compactNotice('🟡 스페이스클라우드 자동확인 필요', [
    formatBriefRows(rows),
    'DB 원장: 정상',
    '판정: 실제 플랫폼 잔존 확정 아님',
    `자동화 기록: ${deleteFailureReasonText(rowOrError)}`,
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
  ].includes(taskRow.status));
  return compactNotice('✅ 성공: 네이버 예약불가 반영', [
    `처리: ${processed.length}건`,
    formatBriefRows(processed),
  ]);
}

function naverBlockFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
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
  return compactNotice('🟡 네이버 자동확인 필요', [
    formatBriefRows(rows),
    'DB 원장: 정상',
    '판정: 실제 네이버 누락 확정 아님',
    `자동화 기록: ${firstFailureReason(rowOrError)}`,
  ]);
}

function naverRestoreSuccessMessage(row) {
  const processed = (row.naverRestoreTasks?.rows || []).filter((taskRow) => [
    'restored',
    'already-available',
    'restore-skipped-not-owned',
  ].includes(taskRow.status));
  return compactNotice('✅ 성공: 네이버 예약가능 복구', [
    `처리: ${processed.length}건`,
    formatBriefRows(processed),
  ]);
}

function naverRestoreFailureMessage(rowOrError) {
  const rows = rowsFromResult(rowOrError);
  return compactNotice('🟡 네이버 자동확인 필요', [
    formatBriefRows(rows),
    'DB 원장: 정상',
    '판정: 실제 네이버 상태 오류 확정 아님',
    `자동화 기록: ${firstFailureReason(rowOrError)}`,
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
  return compactNotice(transient ? '🟡 서버 연결 확인 중' : '🔴 자동화 감시 중지', [
    `상태: ${transient ? '다음 주기 자동 재시도' : '자동 재시작 필요'}`,
    `자동화 기록: ${cleanTelegramText(errorText || '-', 180)}`,
    '같은 상태는 다시 알리지 않습니다.',
  ]);
}

function dbStatusForDeleteRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'deleted') return 'done';
  if (row.status === 'already-gone') return 'already_gone';
  if (row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForUploadRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (smsNeedsAttention(row)) return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'naver-cancel-queued') return 'done';
  if (row.status === 'submitted') return 'done';
  if (row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForNaverBlockRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (smsNeedsAttention(row)) return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'blocked' || row.status === 'already-blocked') return 'done';
  if (row.status === 'spacecloud-cancel-queued') return 'done';
  if (row.status === 'naver-conflict' || row.status === 'later-reservation-conflict' || row.status === 'needs-review') return 'needs_review';
  if (isLoginProblem(row.error)) return 'pending';
  if (isRetryablePlatformProblem(row.error)) return 'pending';
  return 'failed';
}

function dbStatusForSpacecloudCancelRow(row) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (smsNeedsAttention(row)) return 'needs_review';
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
  if (smsNeedsAttention(row)) return 'needs_review';
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
  const summary = {
    ...adminTaskFields(task),
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
  if (task.recoveredFromStaleRunning) {
    summary.recoveredFromStaleRunning = true;
    summary.stalePreviousStatus = task.stalePreviousStatus || 'running';
    summary.stalePreviousResultStatus = task.stalePreviousResultStatus || '';
    summary.staleLockedAt = task.staleLockedAt || task.lockedAt || '';
    summary.staleAttempts = task.staleAttempts ?? task.attempts ?? null;
  }
  return summary;
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
  // 관리자 입력은 이메일 이벤트가 아니라 DB 트랜잭션에서 원장 앵커와 작업을
  // 함께 만든다. 원장 상태는 검증하되 존재할 수 없는 이메일 ID를 요구하지 않는다.
  if (isAdminPanelTask(task)) return null;
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

function adminTaskFields(task) {
  const payload = payloadForTask(task);
  const adminPanelTask = payload.source === 'admin-panel' || payload.source_mode === 'admin-panel';
  return {
    adminPanelTask,
    adminReservationId: payload.admin_reservation_id || payload.adminReservationId || null,
    adminSeriesId: payload.admin_series_id || payload.adminSeriesId || null,
  };
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
from datetime import datetime, timedelta
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

def slot_datetimes(date_text, start_text, end_text):
    try:
        day = datetime.strptime(str(date_text or ''), '%Y-%m-%d')
        start_hour, start_minute = [int(part) for part in str(start_text or '').split(':')[:2]]
        end_hour, end_minute = [int(part) for part in str(end_text or '').split(':')[:2]]
    except (TypeError, ValueError):
        return None, None
    start_total = start_hour * 60 + start_minute
    end_total = end_hour * 60 + end_minute
    if end_total <= start_total:
        end_total += 24 * 60
    start_at = day + timedelta(minutes=start_total)
    end_at = day + timedelta(minutes=end_total)
    return start_at.strftime('%Y-%m-%d %H:%M:%S'), end_at.strftime('%Y-%m-%d %H:%M:%S')

def is_real_booking(item):
    return item.get('sourcePlatform') in {'naver', 'spacecloud'}

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
payload = json.loads(base64.b64decode(os.environ['CONFLICT_PAYLOAD_B64']).decode('utf-8'))
target_start_at, target_end_at = slot_datetimes(payload.get('date'), payload.get('startTime'), payload.get('endTime'))
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
              AND COALESCE(source_mode, '') <> 'admin-task-anchor'
              AND DATE_ADD(TIMESTAMP(reservation_date, '00:00:00'), INTERVAL TIME_TO_SEC(start_time) SECOND) < %s
              AND DATE_ADD(
                    TIMESTAMP(reservation_date, '00:00:00'),
                    INTERVAL (TIME_TO_SEC(end_time) + IF(end_time <= start_time, 86400, 0)) SECOND
                  ) > %s
            ORDER BY
              COALESCE(last_event_at, created_at, '9999-12-31 23:59:59') ASC,
              id ASC
            """,
            (
                payload.get('roomKey') or '',
                target_end_at,
                target_start_at,
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
  return (result?.failed || []).length > 0;
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
      date: args.smsTestDate,
      roomKey: args.smsTestRoom,
      startTime: args.smsTestStart,
      endTime: args.smsTestEnd,
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

async function runUploadTasks(args, context = null, claimedTasks = null) {
  if (args.dryRun) {
    return {
      status: 'upload-task-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = claimedTasks || await fetchRemoteUploadTasks(args);
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
      let row = null;
      try {
        if (task.status === 'running') {
          row = staleRunningNeedsReviewRow(task, 'upload');
        } else {
          const ledgerIssue = ledgerIssueForTask(task, 'upload');
          if (ledgerIssue) {
            row = ledgerIssueRow(task, 'upload', ledgerIssue);
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
              }
            }
          }
        }

        if (row.status === 'submitted') {
          try {
            row.sms = await sendNaverOriginConfirmationSms(args, activeContext, task);
          } catch (smsError) {
            row.sms = {
              status: 'failed',
              reason: 'sms-send-exception',
              error: String(smsError?.message || smsError),
            };
          }
          row.finishedAt = new Date().toISOString();
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
        row.status = 'failed';
        row.error = String(error?.message || error);
        row.finishedAt = new Date().toISOString();
      }

      Object.assign(row, adminTaskFields(task));
      rows.push(row);
      const status = dbStatusForUploadRow(row);
      row.dbStatus = status;
      await updateRemoteTask(args, task, status, JSON.stringify(row, null, 2));
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
    'submitted',
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

async function runDeleteTasks(args, context = null, claimedTasks = null) {
  if (args.dryRun) {
    return {
      status: 'delete-dry-run',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  const tasks = claimedTasks || await fetchRemoteDeleteTasks(args);
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
      let row;
      if (task.status === 'running') {
        row = staleRunningNeedsReviewRow(task, 'delete');
      } else {
        const ledgerIssue = ledgerIssueForTask(task, 'delete');
        if (ledgerIssue) {
          row = ledgerIssueRow(task, 'delete', ledgerIssue);
        } else {
          row = await deleteSpacecloudDirectReservation(activeContext, task);
        }
      }

      if (['deleted', 'already-gone'].includes(row.status)) {
        row.finishedAt = new Date().toISOString();
      }

      Object.assign(row, adminTaskFields(task));
      rows.push(row);
      const status = dbStatusForDeleteRow(row);
      row.dbStatus = status;
      await updateRemoteTask(args, task, status, JSON.stringify(row, null, 2));
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
      let row;
      if (task.status === 'running') {
        row = staleRunningNeedsReviewRow(task, 'naver_block');
      } else {
        const ledgerIssue = ledgerIssueForTask(task, 'naver_block');
        if (ledgerIssue) {
          row = ledgerIssueRow(task, 'naver_block', ledgerIssue);
        } else {
          row = await setNaverAvailability(activeContext, task, {
            businessId: args.naverBusinessId,
            targetStatus: 'unavailable',
          });
        }
      }
      Object.assign(row, adminTaskFields(task));
      rows.push(row);
      const status = dbStatusForNaverBlockRow(row);
      row.dbStatus = status;
      await updateRemoteTask(args, task, status, JSON.stringify(row, null, 2));
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
      const row = {
        ...basicTaskSummary(task),
        status: 'needs-review',
        error: '고객 예약 자동 취소는 영구 차단되어 있습니다.',
        safetyPolicy: 'manual-review-no-cancellation',
        dbStatus: 'needs_review',
      };
      rows.push(row);
      await updateRemoteTask(args, task, 'needs_review', JSON.stringify(row, null, 2));
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
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
          if (shouldSendPriorBookingCancellationSms(task, row)) {
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
      await updateRemoteTask(args, task, status, JSON.stringify(row, null, 2));
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
      const row = {
        ...basicTaskSummary(task),
        status: 'needs-review',
        error: '고객 예약 자동 취소는 영구 차단되어 있습니다.',
        safetyPolicy: 'manual-review-no-cancellation',
        dbStatus: 'needs_review',
      };
      rows.push(row);
      await updateRemoteTask(args, task, 'needs_review', JSON.stringify(row, null, 2));
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
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
          if (shouldSendPriorBookingCancellationSms(task, row)) {
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
      await updateRemoteTask(args, task, status, JSON.stringify(row, null, 2));
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

function taskResultWithStatus(result, kind) {
  const failed = result.failed || [];
  const retrying = result.retrying || [];
  const prefix = kind === 'upload' ? 'upload-task' : 'delete';
  return {
    ...result,
    status: failed.length
      ? `${prefix}-needs-review`
      : (retrying.length ? `${prefix}-retry-pending` : `${prefix}-processed`),
  };
}

function bookingSyncFetchArgs(args) {
  // Upload/delete must follow the source email timestamp. NOW-mode urgency is
  // useful for availability work, but reordering these two task types can make
  // a rebooking run before its earlier cancellation.
  return { ...args, nowMode: false };
}

async function runOrderedBookingSyncTasks(args, context = null) {
  if (args.dryRun) {
    return {
      order: [],
      uploadTasks: taskResultWithStatus(mergeTaskResults(), 'upload'),
      deleteTasks: taskResultWithStatus(mergeTaskResults(), 'delete'),
    };
  }

  const uploadRuns = [];
  const deleteRuns = [];
  const order = [];
  const limit = Math.max(1, Number(args.limitPerCycle || 0) + Number(args.deleteLimitPerCycle || 0));
  const orderedFetchArgs = bookingSyncFetchArgs(args);

  for (let index = 0; index < limit; index += 1) {
    const tasks = await fetchRemoteTaskTypes(orderedFetchArgs, {
      taskTypes: ['upload', 'delete'],
      limit: 1,
    });
    if (tasks.length === 0) break;

    const task = tasks[0];
    const taskType = task.taskType || task.task_type || '';
    let result;
    if (taskType === 'delete') {
      result = await runDeleteTasks(args, context, [task]);
      deleteRuns.push(result);
    } else {
      result = await runUploadTasks(args, context, [task]);
      uploadRuns.push(result);
    }
    order.push({
      id: task.id,
      taskType,
      sourceReceivedAt: task.sourceReceivedAt || task.createdAt || task.created_at || '',
    });

    // A transient retry remains the oldest task, so leave it for the next cycle
    // instead of immediately claiming the same task again. Terminal review rows
    // are excluded from the next fetch, allowing the following received task to run.
    if ((result.retrying || []).length > 0) break;
  }

  return {
    order,
    uploadTasks: taskResultWithStatus(mergeTaskResults(...uploadRuns), 'upload'),
    deleteTasks: taskResultWithStatus(mergeTaskResults(...deleteRuns), 'delete'),
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
    for (const claimedTask of tasks) {
      const task = normalizeClaimedTaskForRecovery(claimedTask);
      const taskType = task.taskType || 'naver_block';
      let row;
      if (task.status === 'running') {
        row = staleRunningNeedsReviewRow(task, taskType);
      } else {
        const ledgerIssue = ledgerIssueForTask(task, taskType);
        if (ledgerIssue) {
          row = ledgerIssueRow(task, taskType, ledgerIssue);
        } else if (taskType === 'naver_restore') {
          if (args.nowMode) {
            const ageSeconds = taskAgeSeconds(task);
            if (ageSeconds !== null && ageSeconds < args.restoreGraceSeconds) {
              row = restoreGraceWaitRow(task, args.restoreGraceSeconds);
            }
          }

          if (!row && task.priorNaverBlockChanged !== true && task.restoreSafeWithoutPriorBlock !== true) {
            row = restoreSkippedNotOwnedRow(task);
          } else if (!row) {
            row = await setNaverAvailability(activeContext, task, {
              businessId: args.naverBusinessId,
              targetStatus: 'available',
            });
            row.taskType = taskType;
          }

          if (['restored', 'already-available', 'restore-skipped-not-owned'].includes(row.status)) {
            row.finishedAt = new Date().toISOString();
          }
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
        }
      }

      if (taskType !== 'naver_restore' && ['blocked', 'already-blocked'].includes(row.status)) {
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

      Object.assign(row, adminTaskFields(task));
      rows.push(row);
      const status = taskType === 'naver_restore'
        ? dbStatusForNaverRestoreRow(row)
        : dbStatusForNaverBlockRow(row);
      row.dbStatus = status;
      await updateRemoteTask(args, task, status, JSON.stringify(row, null, 2));
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
        'stale-ledger-skip',
      ]
      : [
        'blocked',
        'already-blocked',
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
  const bookingFetchArgs = bookingSyncFetchArgs(parsed);
  assert.equal(bookingFetchArgs.nowMode, false);
  assert.equal(parsed.nowMode, true, 'disabling booking-task urgency must not mutate the watcher args');
  const adminConfirmedTask = {
    ledgerStatus: 'confirmed',
    emailEventId: null,
    payloadJson: JSON.stringify({ source: 'admin-panel', admin_reservation_id: 41 }),
  };
  const adminCanceledTask = {
    ledgerStatus: 'canceled',
    emailEventId: null,
    payloadJson: JSON.stringify({ source: 'admin-panel', admin_reservation_id: 41 }),
  };
  assert.equal(ledgerIssueForTask(adminConfirmedTask, 'upload'), null);
  assert.equal(ledgerIssueForTask(adminConfirmedTask, 'naver_block'), null);
  assert.equal(ledgerIssueForTask(adminCanceledTask, 'delete'), null);
  assert.equal(ledgerIssueForTask(adminCanceledTask, 'naver_restore'), null);
  assert.equal(ledgerIssueForTask({ ...adminConfirmedTask, payloadJson: '{}' }, 'upload'), 'missing-event');
  assert.deepEqual(adminTaskFields({
    payloadJson: JSON.stringify({ source: 'admin-panel', admin_reservation_id: 41, admin_series_id: 9 }),
  }), {
    adminPanelTask: true,
    adminReservationId: 41,
    adminSeriesId: 9,
  });
  assert.equal(syncSuccessRowsFromCycle({
    uploadTasks: { rows: [{
      taskId: 501,
      taskType: 'upload',
      status: 'submitted',
      adminPanelTask: true,
      adminSeriesId: 9,
    }] },
  }).length, 0, 'bulk admin success rows must not create one Telegram message per occurrence');

  const confirmationTask = {
    date: '2026-08-01',
    roomKey: 'a',
    startTime: '17:00',
    endTime: '21:00',
  };
  assert.equal(confirmationSmsDateText(confirmationTask), '8/1토');
  assert.equal(confirmationSmsTimeText(confirmationTask), '오후17-21시');
  assert.equal(confirmationSmsTimeText({ startTime: '00:00', endTime: '06:00' }), '새벽00-06시');
  assert.equal(confirmationSmsTimeText({ startTime: '06:00', endTime: '12:00' }), '오전06-12시');
  assert.equal(confirmationSmsTimeText({ startTime: '12:00', endTime: '17:00' }), '오후12-17시');
  assert.equal(confirmationSmsTimeText({ startTime: '05:30', endTime: '06:30' }), '새벽05:30-오전06:30시');
  assert.equal(confirmationSmsTimeText({ startTime: '11:30', endTime: '12:30' }), '오전11:30-오후12:30시');
  assert.equal(confirmationSmsTimeText({ startTime: '23:00', endTime: '00:00' }), '오후23-24시');
  assert.equal(confirmationSmsTimeText({ startTime: '23:30', endTime: '00:30' }), '오후23:30-익일새벽00:30시');
  const confirmationMessage = confirmationSmsMessage(confirmationTask, 'naver');
  assert.equal(
    confirmationMessage,
    '리듬앤조이 확정문자\n8/1토 A홀 오후17-21\n비번 정보\nhttps://리듬앤조이일정표.com/n',
  );
  const longestConfirmationMessage = confirmationSmsMessage({
    date: '2026-12-31',
    roomKey: 'b',
    startTime: '23:00',
    endTime: '03:00',
  }, 'spacecloud');
  assert.equal(legacySmsByteLength(longestConfirmationMessage), 90);
  assert.match(longestConfirmationMessage, /12\/31목 B홀 오후23-익일새벽03/);
  let maximumConfirmationBytes = 0;
  for (let startHour = 0; startHour < 24; startHour += 1) {
    for (let endHour = 0; endHour <= 24; endHour += 1) {
      if (startHour === endHour) continue;
      const message = confirmationSmsMessage({
        date: '2026-12-31',
        roomKey: 'b',
        startTime: `${String(startHour).padStart(2, '0')}:00`,
        endTime: `${String(endHour).padStart(2, '0')}:00`,
      }, 'naver');
      const byteLength = legacySmsByteLength(message);
      maximumConfirmationBytes = Math.max(maximumConfirmationBytes, byteLength);
      assert.ok(byteLength <= 90);
    }
  }
  assert.equal(maximumConfirmationBytes, 90);

  assert.equal(reservationSlotsOverlap(
    { date: '2026-08-03', startTime: '19:00', endTime: '20:00' },
    { date: '2026-08-03', startTime: '20:00', endTime: '21:00' },
  ), false);
  assert.equal(reservationSlotsOverlap(
    { date: '2026-08-03', startTime: '19:00', endTime: '21:00' },
    { date: '2026-08-03', startTime: '20:00', endTime: '22:00' },
  ), true);
  assert.equal(reservationSlotsOverlap(
    { date: '2026-08-03', startTime: '23:00', endTime: '00:00' },
    { date: '2026-08-04', startTime: '00:00', endTime: '01:00' },
  ), false);
  assert.equal(reservationSlotsOverlap(
    { date: '2026-08-03', startTime: '23:00', endTime: '01:00' },
    { date: '2026-08-04', startTime: '00:00', endTime: '01:00' },
  ), true);
  assert.equal(reservationSlotsOverlap(
    { date: '2026-08-03', startTime: '23:00', endTime: '24:00' },
    { date: '2026-08-04', startTime: '00:00', endTime: '01:00' },
  ), false);

  const staleClaim = {
    id: 99,
    taskType: 'upload',
    status: 'running',
    roomKey: 'a',
    date: '2026-08-03',
    startTime: '20:00',
    endTime: '21:00',
    attempts: 2,
    lockedAt: '2026-08-03 10:00:00',
    resultText: JSON.stringify({ status: 'submitted' }),
  };
  const recoveredClaim = normalizeClaimedTaskForRecovery(staleClaim);
  assert.equal(recoveredClaim.status, 'pending');
  assert.equal(recoveredClaim.recoveredFromStaleRunning, true);
  assert.equal(recoveredClaim.stalePreviousResultStatus, 'submitted');
  assert.equal(spacecloudUploadEventFromTask(recoveredClaim).attempts, 2);
  assert.equal(basicTaskSummary(recoveredClaim).recoveredFromStaleRunning, true);
  assert.equal(shouldSendPriorBookingCancellationSms({}, { status: 'canceled' }), true);
  assert.equal(shouldSendPriorBookingCancellationSms(recoveredClaim, { status: 'already-canceled' }), true);
  assert.equal(shouldSendPriorBookingCancellationSms({}, { status: 'already-canceled' }), false);

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

  assert.equal(hasBlockingFailures({ failed: [{ status: 'needs-review' }] }), true);
  assert.equal(hasBlockingFailures({ failed: [], retrying: [retryRow] }), false);
  const smsFailedRow = { status: 'submitted', sms: { status: 'failed' } };
  const smsUncertainRow = { status: 'submitted', sms: { status: 'needs_review' } };
  const smsSentRow = { status: 'submitted', sms: { status: 'sent' } };
  assert.equal(dbStatusForUploadRow(smsFailedRow), 'needs_review');
  assert.equal(dbStatusForNaverBlockRow(smsFailedRow), 'needs_review');
  assert.equal(dbStatusForNaverCancelRow({ status: 'canceled', sms: { status: 'failed' } }), 'needs_review');
  assert.equal(dbStatusForSpacecloudCancelRow({ status: 'canceled', sms: { status: 'needs_review' } }), 'needs_review');
  assert.equal(dbStatusForUploadRow(smsUncertainRow), 'needs_review');
  assert.equal(dbStatusForUploadRow(smsSentRow), 'done');
  assert.equal(smsSendOk('already_sent'), true);
  assert.equal(smsSendOk('delivery_in_progress'), false);
  assert.equal(redactPhoneText('recipient 010-4801-7180 failed'), 'recipient 010-****-7180 failed');
  assert.equal(redactPhoneText('01048017180'), '010-****-7180');
  const compactedLongResult = taskResultTextForDb(JSON.stringify({
    status: 'needs-review',
    taskId: 777,
    reservationNo: '1311471051',
    error: 'x'.repeat(20_000),
    candidates: Array.from({ length: 100 }, (_, index) => ({ index, text: '후보'.repeat(1000) })),
  }));
  const parsedLongResult = JSON.parse(compactedLongResult);
  assert.ok(compactedLongResult.length <= 4000);
  assert.equal(parsedLongResult.status, 'needs-review');
  assert.equal(parsedLongResult.reservationNo, '1311471051');
  const alertNow = Date.parse('2026-08-03T12:00:00Z');
  const priorAlert = { lastSentAt: '2026-08-03T11:59:00Z', textPreview: 'same issue' };
  assert.equal(notificationSuppressedByCooldown(priorAlert, 'same issue', alertNow, 3600), true);
  assert.equal(notificationSuppressedByCooldown(priorAlert, 'different issue', alertNow, 3600), false);
  assert.equal(notificationSuppressedByState({ stateSignature: 'complete:done', lastSentAt: '2026-08-03T12:00:00Z' }, 'complete:done'), true);
  assert.equal(notificationSuppressedByState({ stateSignature: 'attention:failed', lastSentAt: '2026-08-03T12:00:00Z' }, 'complete:done'), false);
  const telegramSuccess = syncSuccessMessage({
    id: 513,
    taskType: 'naver_block',
    status: 'blocked',
    date: '2026-08-12',
    roomKey: 'c',
    startTime: '19:00',
    endTime: '20:00',
    reserverName: '서연',
    sms: { status: 'sent', maskedPhone: '010-****-7180' },
  });
  assert.match(telegramSuccess, /^✅ 예약 반영 완료/m);
  assert.match(telegramSuccess, /DB 원장: 정상/);
  assert.match(telegramSuccess, /네이버: 예약불가 완료/);
  assert.doesNotMatch(telegramSuccess, /흐름:/);
  assert.equal(CUSTOMER_RESERVATION_CANCELLATION_DISABLED, true);
  assert.match(createRemoteSpacecloudCancelTask.toString(), /CUSTOMER_RESERVATION_CANCELLATION_DISABLED/);
  assert.match(createRemoteNaverCancelTask.toString(), /CUSTOMER_RESERVATION_CANCELLATION_DISABLED/);
  assert.match(fetchRemoteTasks.toString(), /FOR UPDATE/);
  assert.match(fetchRemoteTasks.toString(), /claim_token/);
  assert.match(fetchRemoteTaskTypes.toString(), /FOR UPDATE/);
  assert.match(fetchRemoteTaskTypes.toString(), /claim_token/);
  assert.match(fetchRemoteTaskTypes.toString(), /WHEN status='pending' THEN 1/);
  assert.doesNotMatch(fetchRemoteTaskTypes.toString(), /google_pending/);
  assert.match(updateRemoteTask.toString(), /WHERE id=%s AND status='running' AND claim_token=%s/);
  assert.match(updateRemoteTask.toString(), /releaseClaim/);
  assert.equal(safeTaskClaimLimit(1), 1);
  assert.equal(safeTaskClaimLimit(50), 1);
  assert.match(dailyReconcileMessage({}), /spacecloud-watch\/launchd\.log/);

  return {
    ok: true,
    checks: [
      'now-mode argument parsing',
      'booking upload/delete preserve source-received order even in now-mode',
      'stale running tasks resume through idempotent platform verification and cancellation SMS ledger',
      'adjacent and midnight-crossing booking intervals use full datetimes',
      'restore grace keeps task pending',
      'same-cycle cancellation result merge',
      'platform page timeout becomes next-cycle retry',
      'closed browser context retries every task type',
      'ambiguous SpaceCloud submit is verified on retry',
      'task runners depend only on the DB queue and opposite booking platform',
      'sms send is task-visible on failure/uncertainty and duplicate states are not treated as success',
      'SMS errors redact full recipient phone numbers',
      'oversized task results remain valid JSON with status and reservation identity',
      'notification cooldown suppresses only identical issue text',
      'customer reservation cancellation is hard-disabled',
      'task claims use transactional row locks and unique claim tokens',
      'only the current claim owner can checkpoint or finish a task',
      'task rows are claimed one at a time so untouched rows never remain running',
      'new platform work is processed in source-received order',
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
    processed: 'naver-availability-processed',
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

  row.bookingSyncTasks = await runOrderedBookingSyncTasks(args, activeContext);
  row.uploadTasks = row.bookingSyncTasks.uploadTasks;
  row.deleteTasks = row.bookingSyncTasks.deleteTasks;
  setCycleStatusFromResult(row, row.uploadTasks, {
    processed: 'upload-task-processed',
    needsReview: 'upload-task-needs-review',
    retrying: 'upload-task-retry-pending',
  });
  if (!hasBlockingFailures(row.uploadTasks)) {
    setCycleStatusFromResult(row, row.deleteTasks, {
      processed: 'delete-processed',
      needsReview: 'delete-needs-review',
      retrying: 'delete-retry-pending',
    });
  }
  if (hasBlockingFailures(row.uploadTasks) || hasBlockingFailures(row.deleteTasks)) return;

  const secondNaverCancel = await runNaverCancelTasks(args, activeContext);
  row.naverCancelTasks = mergeTaskResults(row.naverCancelTasks, secondNaverCancel);
  setCycleStatusFromResult(row, row.naverCancelTasks, {
    processed: 'naver-cancel-processed',
    needsReview: 'naver-cancel-needs-review',
    retrying: 'naver-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.naverCancelTasks)) return;

}

async function runCycle(args, context = null) {
  const workDir = args.workDir;
  const runLogPath = path.join(workDir, 'runs.jsonl');
  const cycle = {
    at: new Date().toISOString(),
    mode: 'db-queue',
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
      marked: 0,
      failed: [],
    };

    row.sessionStatus = await maybeCheckAutomationSessionStatuses(args, await getContext(), workDir);

    if (args.nowMode) {
      await runNowModeCycleTasks(args, row, activeContext);
    } else {
      row.bookingSyncTasks = await runOrderedBookingSyncTasks(args, activeContext);
      row.uploadTasks = row.bookingSyncTasks.uploadTasks;
      row.deleteTasks = row.bookingSyncTasks.deleteTasks;
      if (['planned', 'dry-run'].includes(row.status) && row.uploadTasks.attempted > 0) {
        setCycleStatusFromResult(row, row.uploadTasks, {
          processed: 'upload-task-processed',
          needsReview: 'upload-task-needs-review',
          retrying: 'upload-task-retry-pending',
        });
      }
      if (['planned', 'dry-run', 'upload-task-processed'].includes(row.status) && row.deleteTasks.attempted > 0) {
        setCycleStatusFromResult(row, row.deleteTasks, {
          processed: 'delete-processed',
          needsReview: 'delete-needs-review',
          retrying: 'delete-retry-pending',
        });
      }

      if (!hasBlockingFailures(row.uploadTasks) && !hasBlockingFailures(row.deleteTasks)) {
        row.naverCancelTasks = await runNaverCancelTasks(args, activeContext);
        if (['planned', 'dry-run', 'idle', 'upload-task-processed'].includes(row.status) && row.naverCancelTasks.attempted > 0) {
          setCycleStatusFromResult(row, row.naverCancelTasks, {
            processed: 'naver-cancel-processed',
            needsReview: 'naver-cancel-needs-review',
            retrying: 'naver-cancel-retry-pending',
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
            processed: 'naver-availability-processed',
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

    if (row.status === 'planned') {
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
  const watcherParentPid = process.ppid;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
  let urgentUntil = 0;

  logLine(`watch started; interval=${args.intervalSeconds}s urgent=${args.nowMode ? `${args.urgentIntervalSeconds}s/${args.urgentCooldownSeconds}s` : 'off'} profile=${args.profileDir} mode=db-queue`);
  try {
    while (!stopping) {
      let watcherProblemThisCycle = false;
      const reportWatcherProblem = async (stateSignature, text) => {
        watcherProblemThisCycle = true;
        return notifyWatcherProblem(args, stateSignature, text);
      };
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
          for (const successRow of successRows) {
            const result = await notifyOnStateChange(
              args,
              reservationNotificationKey(successRow),
              reservationCompletionSignature(successRow),
              syncSuccessMessage(successRow),
            );
            if (!result.sent) logLine(`telegram sync success skipped: ${result.reason}`);
          }
        }
        const smsRows = smsRowsFromCycle(row);
        const smsFailureRows = smsRows.filter((taskRow) => (
          smsNeedsAttention(taskRow)
          && !successKeys.has(taskIdentityKey(taskRow))
        ));
        if (smsFailureRows.length) {
          for (const smsFailureRow of smsFailureRows) {
            const result = await notifyReservationAttention(
              args,
              smsFailureRow,
              'sms',
              smsFailureRow.taskType || '',
              smsFailureMessage([smsFailureRow]),
            );
            if (!result.sent) logLine(`telegram confirmation sms failure skipped: ${result.reason}`);
          }
        }
        if (row.failed?.length) {
          const errorText = row.failed.map((failedRow) => failedRow.error).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row));
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
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.uploadTasks));
            logLine(`login needed during db upload; waiting for manual login: ${JSON.stringify(row.uploadTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.uploadTasks, 'platform', 'upload', uploadTaskFailureMessage(row.uploadTasks));
            logLine(`stopping after db upload failure: ${JSON.stringify(row.uploadTasks.failed)}`);
            break;
          }
        }
        if (row.deleteTasks?.failed?.length) {
          const errorText = row.deleteTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.deleteTasks));
            logLine(`login needed during delete; waiting for manual login: ${JSON.stringify(row.deleteTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.deleteTasks, 'platform', 'delete', deleteFailureMessage(row.deleteTasks));
            logLine(`stopping after delete failure: ${JSON.stringify(row.deleteTasks.failed)}`);
            break;
          }
        }
        if (row.naverBlockTasks?.failed?.length) {
          const errorText = row.naverBlockTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.naverBlockTasks));
            logLine(`login needed during naver block; waiting for manual login: ${JSON.stringify(row.naverBlockTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.naverBlockTasks, 'platform', 'naver_block', naverBlockFailureMessage(row.naverBlockTasks));
            logLine(`stopping after naver block failure: ${JSON.stringify(row.naverBlockTasks.failed)}`);
            break;
          }
        }
        if (row.naverRestoreTasks?.failed?.length) {
          const errorText = row.naverRestoreTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.naverRestoreTasks));
            logLine(`login needed during naver restore; waiting for manual login: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.naverRestoreTasks, 'platform', 'naver_restore', naverRestoreFailureMessage(row.naverRestoreTasks));
            logLine(`stopping after naver restore failure: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
            break;
          }
        }
        if (row.naverCancelTasks?.failed?.length) {
          const errorText = row.naverCancelTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.naverCancelTasks));
            logLine(`login needed during naver cancel; waiting for manual login: ${JSON.stringify(row.naverCancelTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.naverCancelTasks, 'platform', 'naver_cancel', naverCancelFailureMessage(row.naverCancelTasks));
            logLine(`stopping after naver cancel failure: ${JSON.stringify(row.naverCancelTasks.failed)}`);
            break;
          }
        }
        if (row.spacecloudCancelTasks?.failed?.length) {
          const errorText = row.spacecloudCancelTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.spacecloudCancelTasks));
            logLine(`login needed during spacecloud cancel; waiting for manual login: ${JSON.stringify(row.spacecloudCancelTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.spacecloudCancelTasks, 'platform', 'spacecloud_cancel', spacecloudCancelFailureMessage(row.spacecloudCancelTasks));
            logLine(`stopping after spacecloud cancel failure: ${JSON.stringify(row.spacecloudCancelTasks.failed)}`);
            break;
          }
        }
      } catch (error) {
        const errorText = String(error?.message || error);
        if (/ssh exited (?:null|255)/i.test(errorText)) await sleep(250);
        if (stopping || process.ppid !== watcherParentPid) {
          logLine('cycle interrupted by service shutdown; notification skipped');
          break;
        }
        const errorRow = {
          at: new Date().toISOString(),
          status: 'error',
          error: errorText,
        };
        await appendJsonl(path.join(args.workDir, 'runs.jsonl'), errorRow);
        logLine(`cycle error: ${errorRow.error}`);
        if (isBrowserContextClosedProblem(errorRow.error)) {
          await reopenBrowserContext();
          logLine('closed browser context recovered; will retry next cycle');
        } else if (isLoginProblem(errorRow.error)) {
          await reportWatcherProblem('problem:login-needed', loginNeededMessage(errorRow.error));
          logLine('login needed; waiting for manual login');
        } else if (isTransientRemoteProblem(errorRow.error)) {
          await reportWatcherProblem('problem:connection', cycleErrorMessage(errorRow.error, { transient: true }));
          logLine('transient remote problem; will retry next cycle');
        } else {
          await reportWatcherProblem('problem:stopped', cycleErrorMessage(errorRow.error));
          break;
        }
      }

      if (!watcherProblemThisCycle) await notifyWatcherRecoveredIfNeeded(args);
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
    const result = await withAutomationProcessLock(args, () => runCycle(args));
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`cycle ${result.status}; candidates=${result.uploadCandidates}; attempted=${result.attempted || 0}; remaining=${result.remainingInPlan ?? 0}; uploadTasks=${result.uploadTasks?.attempted || 0}; naverCancelTasks=${result.naverCancelTasks?.attempted || 0}; deleteTasks=${result.deleteTasks?.attempted || 0}; naverBlockTasks=${result.naverBlockTasks?.attempted || 0}; naverRestoreTasks=${result.naverRestoreTasks?.attempted || 0}; spacecloudCancelTasks=${result.spacecloudCancelTasks?.attempted || 0}`);
    return;
  }

  if (args.command === 'watch') {
    await withAutomationProcessLock(args, () => runWatch(args));
    return;
  }

  throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
