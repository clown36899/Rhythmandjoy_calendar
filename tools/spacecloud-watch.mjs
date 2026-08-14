#!/usr/bin/env node

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  cancelSpacecloudConfirmedReservation,
  checkSpacecloudLogin,
  deleteSpacecloudDirectReservation,
  fetchSpacecloudReservationPhone,
  inspectSpacecloudConfirmedReservation,
  inspectSpacecloudDirectReservation,
  inspectSpacecloudReservationStatus,
  openSpacecloudContext,
  spacecloudUploadEventFromTask,
  uploadSpacecloudDirectReservation,
} from './spacecloud-playwright-uploader.mjs';
import {
  cancelNaverConfirmedReservation,
  checkNaverSmartplaceLogin,
  fetchNaverReservationPhone,
  inspectNaverReservationStatus,
  inspectNaverAvailability,
  setNaverAvailability,
} from './naver-playwright-availability.mjs';
import {
  assessCancellationGuard,
  assessLaterReservationConflict,
  cancellationPairForConflict,
  conflictGuardSummary,
} from './booking-conflict-policy.mjs';

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
const DEFAULT_ADMIN_PLATFORM_AUDIT_STATE_PATH = path.join(DEFAULT_WORK_DIR, 'admin-platform-audit-state.json');
const DEFAULT_ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES = 30;
const DEFAULT_ADMIN_PLATFORM_AUDIT_RECHECK_MINUTES = 3;
const DEFAULT_ADMIN_PLATFORM_AUDIT_LIMIT = 2;
const DEFAULT_CUSTOMER_PLATFORM_AUDIT_STATE_PATH = path.join(DEFAULT_WORK_DIR, 'customer-platform-audit-state.json');
const DEFAULT_CUSTOMER_PLATFORM_AUDIT_INTERVAL_MINUTES = 240;
const DEFAULT_CUSTOMER_PLATFORM_AUDIT_RECHECK_MINUTES = 3;
const DEFAULT_CUSTOMER_PLATFORM_AUDIT_LIMIT = 1;
const DEFAULT_CUSTOMER_CANCELLATION_AUDIT_LOOKBACK_DAYS = 10;
const CONFIRMATION_SMS_TEMPLATE_NAME = 'reservation-confirmed-v1';
const CONFIRMATION_SMS_TITLE = '리듬앤조이 연습실 예약 확정 안내문자';
const PRIOR_BOOKING_CANCEL_SMS_TEMPLATE_NAME = 'spacecloud-prior-booking-canceled-v1';
const PRIOR_BOOKING_CANCEL_SMS_TITLE = '리듬앤조이 연습실 예약취소 안내';
const DEFAULT_CONFIRMATION_INFO_URL = 'https://리듬앤조이일정표.com/info';
const CONFIRMATION_INFO_URLS = {
  n: 'https://리듬앤조이일정표.com/n',
  s: 'https://리듬앤조이일정표.com/s',
};
const TELEGRAM_LOG_HINT = '로그: 자동화 관리패널 또는 journalctl --user -u rhythmjoy-spacecloud-watch.service';
const RUN_LOG_MAX_BYTES = 16 * 1024 * 1024;
const RUN_LOG_ARCHIVES = 4;
const CUSTOMER_RESERVATION_CANCELLATION_DEFAULT_ENABLED = true;
const CANCELLATION_PRIORITY_RULE = 'first-email-confirmed-real-platform-wins-strict';
const CANCELLATION_GUARD_MAX_ATTEMPTS = 6;
const PLATFORM_TRANSIENT_MAX_ATTEMPTS = 6;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DIAGNOSTIC_LOG_NAME = 'session-diagnostics.jsonl';
const SESSION_DIAGNOSTIC_SALT_NAME = '.session-diagnostic-salt';
const SESSION_DIAGNOSTIC_HEARTBEAT_MS = DAY_MS;
// rhythmjoy_spacecloud_tasks.result_text is MySQL TEXT (65,535 bytes). Keep a
// conservative margin for utf8mb4 and future schema changes, but do not throw
// away verification evidence behind the old arbitrary 4,000-character limit.
const TASK_RESULT_TEXT_MAX_BYTES = 48 * 1024;
const PROCESS_STARTED_AT = new Date().toISOString();

function customerReservationCancellationEnabled() {
  const configured = String(process.env.RHYTHMJOY_CUSTOMER_RESERVATION_CANCELLATION_ENABLED || '').trim();
  if (!configured) return CUSTOMER_RESERVATION_CANCELLATION_DEFAULT_ENABLED;
  return !['0', 'false', 'off', 'disabled'].includes(configured.toLowerCase());
}

function usage() {
  return `Usage:
  node tools/spacecloud-watch.mjs login [options]
  node tools/spacecloud-watch.mjs check-sessions [options]
  node tools/spacecloud-watch.mjs check-login [options]
  node tools/spacecloud-watch.mjs check-naver-login [options]
  node tools/spacecloud-watch.mjs notify-test [options]
  node tools/spacecloud-watch.mjs sms-test --to <phone> [options]
  node tools/spacecloud-watch.mjs now-mode-self-test
  node tools/spacecloud-watch.mjs reflection-audit [options]
  node tools/spacecloud-watch.mjs admin-platform-audit [options]
  node tools/spacecloud-watch.mjs customer-platform-audit [options]
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
  --admin-platform-audit-interval-minutes <n>
                            Defaults to ${DEFAULT_ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES}. Re-reads actual platforms for DB admin reservations.
  --admin-platform-audit-limit <n>
                            Defaults to ${DEFAULT_ADMIN_PLATFORM_AUDIT_LIMIT} reservations per run (two platform checks each).
  --admin-platform-audit-state <path>
                            Defaults to ${DEFAULT_ADMIN_PLATFORM_AUDIT_STATE_PATH}.
  --no-admin-platform-audit Disable actual-platform audit for admin reservations.
  --customer-platform-audit-interval-minutes <n>
                            Defaults to ${DEFAULT_CUSTOMER_PLATFORM_AUDIT_INTERVAL_MINUTES}. Re-reads source and mirrored platform state for customer reservations.
  --customer-platform-audit-limit <n>
                            Defaults to ${DEFAULT_CUSTOMER_PLATFORM_AUDIT_LIMIT} reservation per run (source plus a completed mirror when present).
  --customer-platform-audit-state <path>
                            Defaults to ${DEFAULT_CUSTOMER_PLATFORM_AUDIT_STATE_PATH}.
  --customer-platform-audit-ledger-id <n>
                            Command-only targeted recheck of one DB ledger row.
  --no-customer-platform-audit
                            Disable actual-platform audit for customer reservations.
  --customer-platform-audit Enable the low-frequency customer actual-platform audit.
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
  node tools/spacecloud-watch.mjs login       # saves both SpaceCloud and Naver sessions
  node tools/spacecloud-watch.mjs check-sessions
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
    adminPlatformAudit: true,
    adminPlatformAuditIntervalMinutes: DEFAULT_ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES,
    adminPlatformAuditLimit: DEFAULT_ADMIN_PLATFORM_AUDIT_LIMIT,
    adminPlatformAuditState: DEFAULT_ADMIN_PLATFORM_AUDIT_STATE_PATH,
    customerPlatformAudit: false,
    customerPlatformAuditIntervalMinutes: DEFAULT_CUSTOMER_PLATFORM_AUDIT_INTERVAL_MINUTES,
    customerPlatformAuditLimit: DEFAULT_CUSTOMER_PLATFORM_AUDIT_LIMIT,
    customerPlatformAuditState: DEFAULT_CUSTOMER_PLATFORM_AUDIT_STATE_PATH,
    customerPlatformAuditLedgerId: 0,
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
    if (arg === '--no-admin-platform-audit') {
      args.adminPlatformAudit = false;
      continue;
    }
    if (arg === '--no-customer-platform-audit') {
      args.customerPlatformAudit = false;
      continue;
    }
    if (arg === '--customer-platform-audit') {
      args.customerPlatformAudit = true;
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
      'admin-platform-audit-interval-minutes',
      'admin-platform-audit-limit',
      'customer-platform-audit-interval-minutes',
      'customer-platform-audit-limit',
      'customer-platform-audit-ledger-id',
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
    } else if (key === 'admin-platform-audit-state') {
      args.adminPlatformAuditState = next;
    } else if (key === 'customer-platform-audit-state') {
      args.customerPlatformAuditState = next;
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
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

async function appendJsonl(filePath, row) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await rotateJsonlIfNeeded(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`);
}

async function rotateJsonlIfNeeded(filePath, maxBytes = RUN_LOG_MAX_BYTES, archives = RUN_LOG_ARCHIVES) {
  let size = 0;
  try {
    size = (await fs.stat(filePath)).size;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return false;
  }
  if (size < maxBytes) return false;
  await fs.unlink(`${filePath}.${archives}`).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  for (let index = archives - 1; index >= 1; index -= 1) {
    try {
      await fs.rename(`${filePath}.${index}`, `${filePath}.${index + 1}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  await fs.rename(filePath, `${filePath}.1`);
  return true;
}

async function readJsonObject(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function sessionDiagnosticSalt(workDir) {
  const saltPath = path.join(workDir, SESSION_DIAGNOSTIC_SALT_NAME);
  try {
    const existing = (await fs.readFile(saltPath, 'utf8')).trim();
    if (existing) return existing;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await fs.mkdir(workDir, { recursive: true });
  const created = randomBytes(32).toString('hex');
  try {
    await fs.writeFile(saltPath, `${created}\n`, { mode: 0o600, flag: 'wx' });
    return created;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = (await fs.readFile(saltPath, 'utf8')).trim();
    if (!existing) throw new Error('session diagnostic salt is empty');
    return existing;
  }
}

function privateFingerprint(salt, value) {
  if (!value) return '';
  return createHmac('sha256', salt).update(String(value)).digest('hex');
}

function stableDiagnosticSignature(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cookieExpiryIso(expires) {
  const seconds = Number(expires || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function sessionCookiePolicy(platform) {
  if (platform === 'naver') {
    return {
      urls: [
        'https://www.naver.com/',
        'https://nid.naver.com/',
        'https://partner.booking.naver.com/',
      ],
      domain: /(?:^|\.)naver\.com$/i,
      trackedNames: new Set(['NID_AUT', 'NID_SES', 'NID_SAUTO', 'NID_JST', 'nid_slevel']),
      primaryName: 'NID_AUT',
    };
  }
  return {
    urls: [
      'https://spacecloud.kr/',
      'https://partner.spacecloud.kr/',
    ],
    domain: /(?:^|\.)spacecloud\.kr$/i,
    trackedNames: new Set(['refresh_token']),
    primaryName: 'refresh_token',
  };
}

function cookieLooksOperational(cookie) {
  return !/^(_ga|_gid|_gat|AMP_|NAC|NNB|BUC|SRT)/i.test(String(cookie?.name || ''));
}

async function collectSessionCookieSnapshot(context, platform, salt) {
  const policy = sessionCookiePolicy(platform);
  const capturedAt = new Date().toISOString();
  try {
    const cookies = (await context.cookies(policy.urls))
      .filter((cookie) => policy.domain.test(String(cookie.domain || '').replace(/^\./, '')))
      .filter((cookie) => !policy.trackedNames || policy.trackedNames.has(cookie.name))
      .map((cookie) => ({
        name: String(cookie.name || '').slice(0, 80),
        domain: String(cookie.domain || '').slice(0, 120),
        expiresAt: cookieExpiryIso(cookie.expires),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: String(cookie.sameSite || '').slice(0, 20),
        fingerprint: privateFingerprint(salt, cookie.value),
      }))
      .sort((left, right) => `${left.domain}|${left.name}`.localeCompare(`${right.domain}|${right.name}`));

    let primary = policy.primaryName
      ? cookies.find((cookie) => cookie.name === policy.primaryName)
      : null;
    if (!primary) {
      primary = cookies.find((cookie) => cookie.httpOnly && cookieLooksOperational(cookie))
        || cookies.find(cookieLooksOperational)
        || null;
    }
    return {
      capturedAt,
      cookieCount: cookies.length,
      primaryName: primary?.name || policy.primaryName || '',
      primaryPresent: Boolean(primary),
      primaryExpiresAt: primary?.expiresAt || '',
      primaryFingerprint: primary?.fingerprint || '',
      aggregateFingerprint: stableDiagnosticSignature(cookies.map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        expiresAt: cookie.expiresAt,
        fingerprint: cookie.fingerprint,
      }))),
      cookies,
      captureError: '',
    };
  } catch (error) {
    return {
      capturedAt,
      cookieCount: 0,
      primaryName: policy.primaryName || '',
      primaryPresent: false,
      primaryExpiresAt: '',
      primaryFingerprint: '',
      aggregateFingerprint: '',
      cookies: [],
      captureError: String(error?.message || error).slice(0, 240),
    };
  }
}

async function readTextIfPresent(filePath) {
  try {
    return (await fs.readFile(filePath, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function statIfPresent(filePath) {
  try {
    const value = await fs.stat(filePath);
    return {
      device: Number(value.dev || 0),
      inode: Number(value.ino || 0),
      size: Number(value.size || 0),
      modifiedAt: value.mtime?.toISOString?.() || '',
    };
  } catch {
    return { device: 0, inode: 0, size: 0, modifiedAt: '' };
  }
}

async function sessionRuntimeSnapshot(args, context, salt) {
  const bootId = await readTextIfPresent('/proc/sys/kernel/random/boot_id');
  const profileStat = await statIfPresent(args.profileDir);
  const cookieStoreStat = await statIfPresent(path.join(args.profileDir, 'Default', 'Cookies'));
  const networkRows = Object.entries(os.networkInterfaces())
    .flatMap(([name, rows]) => (rows || [])
      .filter((row) => row && !row.internal)
      .map((row) => `${name}|${row.family}|${row.address}`))
    .sort();
  let ntpSynchronized = false;
  try {
    await fs.access('/run/systemd/timesync/synchronized');
    ntpSynchronized = true;
  } catch {}
  return {
    observedAt: new Date().toISOString(),
    observedEpochMs: Date.now(),
    processStartedAt: PROCESS_STARTED_AT,
    uptimeSeconds: Math.round(os.uptime()),
    bootId: bootId.slice(0, 64),
    browserVersion: String(context.browser()?.version?.() || '').slice(0, 80),
    profileFingerprint: privateFingerprint(
      salt,
      `${args.profileDir}|${profileStat.device}|${profileStat.inode}`,
    ),
    profileStore: profileStat,
    cookieStoreFingerprint: privateFingerprint(
      salt,
      `${args.profileDir}|${cookieStoreStat.device}|${cookieStoreStat.inode}`,
    ),
    cookieStore: cookieStoreStat,
    networkFingerprint: privateFingerprint(salt, networkRows.join('\n')),
    ntpSynchronized,
  };
}

function safeUrlLocation(value) {
  try {
    const url = new URL(String(value || ''));
    return {
      host: url.hostname.slice(0, 128),
      path: url.pathname.slice(0, 255),
    };
  } catch {
    return { host: '', path: '' };
  }
}

function sanitizeSessionDiagnosticNote(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
      const location = safeUrlLocation(candidate);
      return location.host ? `https://${location.host}${location.path}` : '[URL 숨김]';
    })
    .replace(/\b(token|code|state|session|password|authorization)=([^\s&]+)/gi, '$1=[숨김]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function previousDiagnosticForPlatform(previousStatuses, platform) {
  return (Array.isArray(previousStatuses) ? previousStatuses : [])
    .find((row) => row?.platform === platform)?.diagnostic || null;
}

function sessionCookieIsExpired(snapshot, now = Date.now()) {
  const expiresAt = snapshot?.primaryExpiresAt ? new Date(snapshot.primaryExpiresAt).getTime() : 0;
  return Boolean(expiresAt && expiresAt <= now);
}

function classifySessionDiagnostic({ platform, status, before, after, previous, result, error }) {
  if (status === 'check_failed' || error) return 'browser_check_failed';
  if (before?.captureError || after?.captureError) return 'cookie_observation_failed';
  const beforePrimary = Boolean(before?.primaryPresent);
  const afterPrimary = Boolean(after?.primaryPresent);
  const rotatedDuringCheck = Boolean(
    before?.primaryFingerprint
    && after?.primaryFingerprint
    && before.primaryFingerprint !== after.primaryFingerprint
  );
  const rotatedSincePrevious = Boolean(
    previous?.cookieFingerprint
    && after?.primaryFingerprint
    && previous.cookieFingerprint !== after.primaryFingerprint
  );

  if (status === 'ready') {
    if (rotatedDuringCheck || rotatedSincePrevious) return 'authenticated_cookie_rotated';
    if (!afterPrimary) return 'authenticated_without_primary_cookie';
    return 'authenticated';
  }

  if (!beforePrimary) {
    const priorExpiry = previous?.cookieExpiresAt ? new Date(previous.cookieExpiresAt).getTime() : 0;
    if (priorExpiry && priorExpiry <= Date.now()) return 'cookie_expired_on_schedule';
    if (previous?.cookieFingerprint && priorExpiry > Date.now()) return 'cookie_removed_before_expiry';
    if (previous?.cookieFingerprint) return 'cookie_removed_expiry_unknown';
    return 'cookie_missing_before_check';
  }
  if (sessionCookieIsExpired(before)) return 'cookie_expired_before_check';
  if (!afterPrimary) return 'server_cleared_cookie';
  const finalLocation = safeUrlLocation(result?.url);
  if (platform === 'naver' && finalLocation.host === 'nid.naver.com') {
    return before?.primaryExpiresAt
      ? 'server_rejected_unexpired_cookie'
      : 'server_rejected_cookie_validity_unknown';
  }
  return 'login_required_unknown';
}

function buildSessionDiagnostic({ platform, status, before, after, previous, result, error, runtime }) {
  const finalLocation = safeUrlLocation(result?.url);
  let failureCategory = classifySessionDiagnostic({
    platform,
    status,
    before,
    after,
    previous,
    result,
    error,
  });
  const runtimeChanges = {
    rebooted: Boolean(previous?.runtime?.bootId && previous.runtime.bootId !== runtime.bootId),
    profileChanged: Boolean(
      previous?.runtime?.profileFingerprint
      && previous.runtime.profileFingerprint !== runtime.profileFingerprint
    ),
    cookieStoreChanged: Boolean(
      previous?.runtime?.cookieStoreFingerprint
      && previous.runtime.cookieStoreFingerprint !== runtime.cookieStoreFingerprint
    ),
    networkChanged: Boolean(
      previous?.runtime?.networkFingerprint
      && previous.runtime.networkFingerprint !== runtime.networkFingerprint
    ),
  };
  if (status !== 'ready' && runtimeChanges.profileChanged) {
    failureCategory = 'profile_store_changed';
  } else if (
    status !== 'ready'
    && runtimeChanges.rebooted
    && previous?.cookieFingerprint
    && !before?.primaryPresent
  ) {
    failureCategory = 'cookie_missing_after_reboot';
  }
  let clockAdjustmentMs = null;
  if (
    previous?.runtime?.bootId
    && previous.runtime.bootId === runtime.bootId
    && Number.isFinite(Number(previous.runtime.observedEpochMs))
    && Number.isFinite(Number(previous.runtime.uptimeSeconds))
  ) {
    const wallDelta = runtime.observedEpochMs - Number(previous.runtime.observedEpochMs);
    const uptimeDelta = (runtime.uptimeSeconds - Number(previous.runtime.uptimeSeconds)) * 1000;
    clockAdjustmentMs = Math.round(wallDelta - uptimeDelta);
  }
  const diagnostic = {
    capturedAt: new Date().toISOString(),
    failureCategory,
    cookieName: after?.primaryName || before?.primaryName || '',
    cookiePresentBefore: Boolean(before?.primaryPresent),
    cookiePresentAfter: Boolean(after?.primaryPresent),
    cookieExpiresAt: after?.primaryExpiresAt || before?.primaryExpiresAt || previous?.cookieExpiresAt || '',
    cookieFingerprint: after?.primaryFingerprint || before?.primaryFingerprint || '',
    finalHost: finalLocation.host,
    finalPath: finalLocation.path,
    clockAdjustmentMs,
    runtimeChanges,
    before,
    after,
    runtime,
  };
  diagnostic.signature = stableDiagnosticSignature({
    platform,
    status,
    failureCategory,
    cookieFingerprint: diagnostic.cookieFingerprint,
    cookieExpiresAt: diagnostic.cookieExpiresAt,
    finalHost: diagnostic.finalHost,
    finalPath: diagnostic.finalPath,
    bootId: runtime.bootId,
    profileFingerprint: runtime.profileFingerprint,
    networkFingerprint: runtime.networkFingerprint,
    runtimeChanges,
    clockAdjustmentBucket: clockAdjustmentMs !== null && Math.abs(clockAdjustmentMs) >= 5000
      ? Math.round(clockAdjustmentMs / 1000)
      : 0,
  });
  return diagnostic;
}

function sessionDiagnosticLabel(category) {
  return {
    authenticated: '로그인 확인 · 인증 쿠키 유지',
    authenticated_cookie_rotated: '로그인 확인 · 인증 쿠키 자동 교체 감지',
    authenticated_without_primary_cookie: '로그인 확인 · 대표 인증 쿠키 판별 불가',
    cookie_expired_on_schedule: '직전 기록의 표시 만료시각 도달 후 쿠키 소실',
    cookie_expired_before_check: '표시 만료시각이 지난 인증 쿠키로 로그인 해제',
    cookie_removed_before_expiry: '표시 만료 전 인증 쿠키가 로컬에서 소실',
    cookie_removed_expiry_unknown: '인증 쿠키 소실 · 표시 만료시각 기록 없음',
    cookie_missing_after_reboot: '재부팅 전후 사이 인증 쿠키 소실',
    profile_store_changed: '자동화 프로필 저장소 변경 감지',
    cookie_missing_before_check: '검사 시작 전에 인증 쿠키가 없음',
    server_cleared_cookie: '플랫폼 응답 과정에서 인증 쿠키 삭제 감지',
    server_rejected_unexpired_cookie: '표시 만료 전 쿠키를 네이버 서버가 거부',
    server_rejected_cookie_validity_unknown: '네이버 서버가 쿠키를 거부 · 표시 만료시각 기록 없음',
    cookie_observation_failed: '인증 쿠키 상태를 읽지 못함',
    browser_check_failed: '브라우저 화면 검사 실패',
    login_required_unknown: '로그인 해제 · 기록만으로 원인 미분류',
  }[category] || '원인 분류 대기';
}

async function persistLocalSessionDiagnostics(args, statuses, previousStatuses = []) {
  const statePath = path.join(args.workDir, 'session-diagnostic-log-state.json');
  const historyPath = path.join(args.workDir, SESSION_DIAGNOSTIC_LOG_NAME);
  const state = await readJsonObject(statePath);
  const platforms = state.platforms && typeof state.platforms === 'object' ? state.platforms : {};
  const now = Date.now();
  for (const row of statuses) {
    const diagnostic = row?.diagnostic;
    if (!diagnostic?.signature) continue;
    const platform = String(row.platform || '');
    const prior = platforms[platform] || {};
    const previousStatus = (Array.isArray(previousStatuses) ? previousStatuses : [])
      .find((candidate) => candidate?.platform === platform)?.status || '';
    const lastLoggedAt = prior.loggedAt ? new Date(prior.loggedAt).getTime() : 0;
    const changed = (
      prior.signature !== diagnostic.signature
      || prior.status !== row.status
      || previousStatus !== row.status
      || prior.failureCategory !== diagnostic.failureCategory
    );
    const heartbeatDue = !lastLoggedAt || now - lastLoggedAt >= SESSION_DIAGNOSTIC_HEARTBEAT_MS;
    if (changed || heartbeatDue) {
      await appendJsonl(historyPath, {
        at: diagnostic.capturedAt,
        platform,
        status: row.status,
        note: row.note,
        diagnostic,
      });
      platforms[platform] = {
        signature: diagnostic.signature,
        status: row.status,
        failureCategory: diagnostic.failureCategory,
        loggedAt: diagnostic.capturedAt,
      };
    }
  }
  await writeJson(statePath, { updatedAt: new Date().toISOString(), platforms });
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
  const required = ['SSH_TARGET', 'SSH_KEY', 'PYTHON_BIN', 'SERVER_ENV_FILE', 'OPS_ROOT'];
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
    attemptCount: Number.parseInt(result?.attemptCount || '0', 10) || 0,
    nextRetryAt: result?.nextRetryAt || '',
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
            attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
            first_failed_at DATETIME NULL,
            last_attempt_at DATETIME NULL,
            next_retry_at DATETIME NULL,
            sent_at DATETIME NULL,
            created_at DATETIME NULL,
            updated_at DATETIME NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_idempotency_key (idempotency_key),
            KEY idx_status (status),
            KEY idx_task (source_task_type, source_task_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    for column, definition in (
        ('attempt_count', 'INT UNSIGNED NOT NULL DEFAULT 0'),
        ('first_failed_at', 'DATETIME NULL'),
        ('last_attempt_at', 'DATETIME NULL'),
        ('next_retry_at', 'DATETIME NULL'),
    ):
        cur.execute('SHOW COLUMNS FROM rhythmjoy_sms_deliveries LIKE %s', (column,))
        if cur.fetchone() is None:
            cur.execute(f'ALTER TABLE rhythmjoy_sms_deliveries ADD COLUMN {column} {definition}')

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
                attempt_count, last_attempt_at, created_at, updated_at
            )
            VALUES (%s,%s,%s,%s,%s,%s,'sending',1,NOW(),NOW(),NOW())
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
                    'attemptCount': existing.get('attempt_count') or 0,
                    'nextRetryAt': existing.get('next_retry_at'),
                }, ensure_ascii=False, default=str))
                raise SystemExit(0)
            if existing_status in ('pending', 'failed', 'phone_lookup_failed'):
                cur.execute(
                    """
                    UPDATE rhythmjoy_sms_deliveries
                    SET status='sending', error_text=NULL,
                        attempt_count=attempt_count+1,
                        last_attempt_at=NOW(), next_retry_at=NULL, updated_at=NOW()
                    WHERE idempotency_key=%s AND status IN ('pending','failed','phone_lookup_failed')
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
                    'attemptCount': existing.get('attempt_count') or 0,
                    'nextRetryAt': existing.get('next_retry_at'),
                }, ensure_ascii=False, default=str))
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
                    first_failed_at=IF(%s='failed' AND first_failed_at IS NULL,NOW(),first_failed_at),
                    next_retry_at=CASE
                      WHEN %s<>'failed' THEN NULL
                      WHEN attempt_count < 2 THEN DATE_ADD(NOW(),INTERVAL 5 MINUTE)
                      WHEN attempt_count < 3 THEN DATE_ADD(NOW(),INTERVAL 15 MINUTE)
                      WHEN attempt_count < 5 THEN DATE_ADD(NOW(),INTERVAL 60 MINUTE)
                      ELSE DATE_ADD(NOW(),INTERVAL 360 MINUTE)
                    END,
                    sent_at=IF(%s='sent', NOW(), sent_at),
                    updated_at=NOW()
                WHERE idempotency_key=%s AND status='sending'
                """,
                (
                    status, result.get('code') or '', result.get('remaining'),
                    str(result.get('raw') or '')[:255], error_text,
                    status, status, status, idempotency_key,
                ),
            )
            cur.execute('SELECT id,attempt_count,next_retry_at FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
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
                'attemptCount': saved.get('attempt_count') or 0,
                'nextRetryAt': saved.get('next_retry_at'),
            }, ensure_ascii=False, default=str))
        except Exception as error:
            cur.execute(
                """
                UPDATE rhythmjoy_sms_deliveries
                SET status='uncertain', error_text=%s,
                    first_failed_at=IF(first_failed_at IS NULL,NOW(),first_failed_at),
                    next_retry_at=NULL, updated_at=NOW()
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
            }, ensure_ascii=False, default=str))
finally:
    conn.close()
PY
`;
  const result = JSON.parse(runSshScript(target, script).trim() || '{}');
  return safeSmsResult(result);
}

async function recordRemoteSmsPhoneLookupFailure(args, {
  task,
  reason,
  source,
  templateName = CONFIRMATION_SMS_TEMPLATE_NAME,
} = {}) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({
    taskId: task.id || task.taskId,
    taskType: task.taskType || task.task_type || '',
    templateName,
    reason: cleanTelegramText(reason || 'recipient-phone-lookup-failed', 300),
    source: source || '',
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export SMS_FOLLOWUP_B64=${shellQuote(payload)}
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
payload = json.loads(base64.b64decode(os.environ['SMS_FOLLOWUP_B64']).decode('utf-8'))
task_id = int(payload.get('taskId') or 0)
task_type = payload.get('taskType') or ''
template_name = payload.get('templateName') or 'reservation-confirmed-v1'
reason = payload.get('reason') or 'recipient-phone-lookup-failed'
source = payload.get('source') or ''
idempotency_key = f'{template_name}|{task_type}|{task_id}'

conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'], port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'], password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'], charset='utf8mb4', autocommit=True,
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
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
            attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
            first_failed_at DATETIME NULL,
            last_attempt_at DATETIME NULL,
            next_retry_at DATETIME NULL,
            sent_at DATETIME NULL,
                created_at DATETIME NULL,
                updated_at DATETIME NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_idempotency_key (idempotency_key),
                KEY idx_status (status),
                KEY idx_task (source_task_type, source_task_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
        for column, definition in (
            ('attempt_count', 'INT UNSIGNED NOT NULL DEFAULT 0'),
            ('first_failed_at', 'DATETIME NULL'),
            ('last_attempt_at', 'DATETIME NULL'),
            ('next_retry_at', 'DATETIME NULL'),
        ):
            cur.execute('SHOW COLUMNS FROM rhythmjoy_sms_deliveries LIKE %s', (column,))
            if cur.fetchone() is None:
                cur.execute(f'ALTER TABLE rhythmjoy_sms_deliveries ADD COLUMN {column} {definition}')
        detail = f'{source}: {reason}' if source else reason
        cur.execute('SELECT id,status,attempt_count FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
        existing = cur.fetchone()
        if existing and existing.get('status') in ('sent', 'uncertain', 'needs_review'):
            pass
        else:
            attempt_count = int((existing or {}).get('attempt_count') or 0) + 1
            retry_minutes = 5 if attempt_count < 2 else (15 if attempt_count < 3 else (60 if attempt_count < 5 else 360))
            if existing:
                cur.execute("""
                    UPDATE rhythmjoy_sms_deliveries
                    SET status='phone_lookup_failed', error_text=%s,
                        attempt_count=%s,
                        first_failed_at=IF(first_failed_at IS NULL,NOW(),first_failed_at),
                        last_attempt_at=NOW(),
                        next_retry_at=DATE_ADD(NOW(),INTERVAL %s MINUTE),
                        updated_at=NOW()
                    WHERE idempotency_key=%s AND status IN ('pending','failed','phone_lookup_failed')
                """, (detail, attempt_count, retry_minutes, idempotency_key))
            else:
                cur.execute("""
                    INSERT INTO rhythmjoy_sms_deliveries (
                        idempotency_key, source_task_type, source_task_id, template_name,
                        recipient_phone_hash, recipient_phone_last4, status,
                        provider_code, provider_raw, error_text,
                        attempt_count, first_failed_at, last_attempt_at, next_retry_at,
                        created_at, updated_at
                    ) VALUES (%s,%s,%s,%s,'','','phone_lookup_failed','','',%s,%s,NOW(),NOW(),DATE_ADD(NOW(),INTERVAL %s MINUTE),NOW(),NOW())
                """, (idempotency_key, task_type, task_id or None, template_name, detail, attempt_count, retry_minutes))
        cur.execute('SELECT id,status,error_text,attempt_count,next_retry_at FROM rhythmjoy_sms_deliveries WHERE idempotency_key=%s LIMIT 1', (idempotency_key,))
        saved = cur.fetchone() or {}
        print(json.dumps({
            'status': saved.get('status') or 'phone_lookup_failed',
            'deliveryId': saved.get('id'),
            'templateName': template_name,
            'reason': reason,
            'source': source,
            'maskedPhone': '',
            'attemptCount': saved.get('attempt_count') or 0,
            'nextRetryAt': saved.get('next_retry_at'),
        }, ensure_ascii=False, default=str))
finally:
    conn.close()
PY
`;
  return safeSmsResult(JSON.parse(runSshScript(target, script).trim() || '{}'));
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
    || (row?.status === 'already-canceled' && taskPriorCancellationAttempted(task));
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
        ledger_key = payload.get('ledger_key') or payload.get('ledgerKey') or importer.booking_ledger_key(source_platform, payload, calendar_key)
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
        # Older admin tasks did not carry their canonical PHP-created ledger
        # key. PHP normalizes Latin letters with mb_strtolower while the email
        # importer intentionally preserves name case, so retry the admin-only
        # compatibility key without changing customer email identities.
        if not ledger and (payload.get('source') == 'admin-panel' or payload.get('source_mode') == 'admin-panel'):
            compatibility_payload = dict(payload)
            compatibility_payload['name'] = importer.normalize_reserver_name_for_match(payload.get('name')).lower()
            compatibility_key = importer.booking_ledger_key(source_platform, compatibility_payload, calendar_key)
            if compatibility_key != ledger_key:
                cur.execute(
                    """
                    SELECT id, current_status,
                           confirmed_email_event_id, canceled_email_event_id,
                           CAST(last_event_at AS CHAR) AS last_event_at
                    FROM rhythmjoy_booking_ledger
                    WHERE ledger_key=%s
                    LIMIT 1
                    """,
                    (compatibility_key,),
                )
                ledger = cur.fetchone()
                if ledger:
                    ledger_key = compatibility_key
                    row['ledgerKey'] = compatibility_key
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
  const target = await loadCafe24Target(args);
  const sourcePayload = payloadForTask(sourceTask);
  const losing = conflictRow.losingBooking || {};
  const winning = conflictRow.winningBooking || {};
  const reservationId = String(
    sourcePayload.spacecloud_reservation_id
    || sourcePayload.spacecloudReservationId
    || conflictRow.reservationId
    || losing.spacecloudReservationId
    || losing.spacecloud_reservation_id
    || ''
  ).trim();
  const sourceTaskId = Number(sourceTask.id || sourceTask.taskId || 0);
  const winningLedgerId = Number(winning.id || 0);
  const losingLedgerId = Number(losing.id || 0);
  if (!Number.isSafeInteger(sourceTaskId) || sourceTaskId <= 0) throw new Error('source task id missing for SpaceCloud cancellation');
  if (!Number.isSafeInteger(winningLedgerId) || winningLedgerId <= 0) throw new Error('winning ledger id missing for SpaceCloud cancellation');
  if (!Number.isSafeInteger(losingLedgerId) || losingLedgerId <= 0) throw new Error('losing ledger id missing for SpaceCloud cancellation');
  if (!reservationId) throw new Error('SpaceCloud reservation id missing for cancellation queue');
  const payload = {
    ...sourcePayload,
    sourceTaskId,
    sourceTaskType: sourceTask.taskType || sourceTask.task_type || 'naver_block',
    source: 'spacecloud-later-reservation-conflict',
    action: 'cancel-spacecloud-confirmed-reservation',
    priorityRule: CANCELLATION_PRIORITY_RULE,
    winningBooking: winning,
    losingBooking: losing,
    spacecloud_reservation_id: reservationId,
    originalPayload: sourcePayload,
  };
  const insertPayload = Buffer.from(JSON.stringify({
    dedupeKey: `spacecloud_cancel|${sourceTaskId}|${losingLedgerId}|${reservationId}`.slice(0, 96),
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
                payload_json=IF(status='pending', VALUES(payload_json), payload_json),
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
  const saved = JSON.parse(runSshScript(target, script).trim() || '{}');
  if (!Number(saved.id) || !['pending', 'running'].includes(saved.status)) {
    throw new Error(`SpaceCloud cancellation task is not safely queued: ${JSON.stringify(saved)}`);
  }
  return saved;
}

async function createRemoteNaverCancelTask(args, sourceTask, conflictRow) {
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
  const sourceTaskId = Number(sourceTask.id || sourceTask.taskId || 0);
  const winningLedgerId = Number(winning.id || 0);
  const losingLedgerId = Number(losing.id || 0);
  if (!Number.isSafeInteger(sourceTaskId) || sourceTaskId <= 0) throw new Error('source task id missing for Naver cancellation');
  if (!Number.isSafeInteger(winningLedgerId) || winningLedgerId <= 0) throw new Error('winning ledger id missing for Naver cancellation');
  if (!Number.isSafeInteger(losingLedgerId) || losingLedgerId <= 0) throw new Error('losing ledger id missing for Naver cancellation');
  if (!reservationNo) throw new Error('Naver reservation number missing for cancellation queue');
  const payload = {
    ...sourcePayload,
    sourceTaskId,
    sourceTaskType: sourceTask.taskType || sourceTask.task_type || 'upload',
    source: 'naver-later-reservation-conflict',
    action: 'cancel-naver-confirmed-reservation',
    priorityRule: CANCELLATION_PRIORITY_RULE,
    winningBooking: winning,
    losingBooking: losing,
    originalPayload: sourcePayload,
  };
  const insertPayload = Buffer.from(JSON.stringify({
    dedupeKey: `naver_cancel|${sourceTaskId}|${losingLedgerId}|${reservationNo}`.slice(0, 96),
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
                payload_json=IF(status='pending', VALUES(payload_json), payload_json),
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
  const saved = JSON.parse(runSshScript(target, script).trim() || '{}');
  if (!Number(saved.id) || !['pending', 'running'].includes(saved.status)) {
    throw new Error(`Naver cancellation task is not safely queued: ${JSON.stringify(saved)}`);
  }
  return saved;
}

async function fetchRemoteCancellationGuardSnapshot(args, task) {
  const target = await loadCafe24Target(args);
  const request = Buffer.from(JSON.stringify({
    taskId: Number(task.id || task.taskId || 0),
    claimToken: String(task.claimToken || task.claim_token || ''),
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export CANCELLATION_GUARD_B64=${shellQuote(request)}
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

def parse_json(value):
    try:
        parsed = json.loads(value or '{}')
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}

def time_text(value):
    text = str(value or '')
    return text[:5] if len(text) >= 5 else text

def date_text(value):
    return str(value or '')[:10]

def slot_datetimes(date_value, start_value, end_value):
    try:
        day = datetime.strptime(date_text(date_value), '%Y-%m-%d')
        start_hour, start_minute = [int(part) for part in time_text(start_value).split(':')[:2]]
        end_hour, end_minute = [int(part) for part in time_text(end_value).split(':')[:2]]
    except (TypeError, ValueError):
        return None, None
    start_total = start_hour * 60 + start_minute
    end_total = end_hour * 60 + end_minute
    if end_total <= start_total:
        end_total += 24 * 60
    return (
        (day + timedelta(minutes=start_total)).strftime('%Y-%m-%d %H:%M:%S'),
        (day + timedelta(minutes=end_total)).strftime('%Y-%m-%d %H:%M:%S'),
    )

def task_row(row, include_payload=False):
    if not row:
        return None
    result = {
        'id': row.get('id'),
        'status': row.get('status') or '',
        'claimToken': row.get('claim_token') or '',
        'taskType': row.get('task_type') or '',
        'ledgerId': row.get('ledger_id'),
        'emailEventId': row.get('email_event_id'),
        'roomKey': row.get('room_key') or '',
        'reservationNo': row.get('reservation_number') or '',
        'date': date_text(row.get('reservation_date')),
        'startTime': time_text(row.get('start_time')),
        'endTime': time_text(row.get('end_time')),
        'reserverName': row.get('reserver_name') or '',
        'product': row.get('product') or '',
    }
    if include_payload:
        payload = parse_json(row.get('payload_json'))
        result['payload'] = {
            'source': payload.get('source') or '',
            'action': payload.get('action') or '',
            'sourceTaskId': payload.get('sourceTaskId'),
            'sourceTaskType': payload.get('sourceTaskType') or '',
            'priorityRule': payload.get('priorityRule') or '',
            'winningBooking': {'id': (payload.get('winningBooking') or {}).get('id')},
            'losingBooking': {'id': (payload.get('losingBooking') or {}).get('id')},
            'spacecloud_reservation_id': payload.get('spacecloud_reservation_id') or payload.get('spacecloudReservationId') or '',
        }
    return result

def ledger_row(row):
    if not row:
        return None
    payload = parse_json(row.get('payload_json'))
    return {
        'id': row.get('id'),
        'sourcePlatform': row.get('source_platform') or '',
        'sourceMode': row.get('source_mode') or '',
        'currentStatus': row.get('current_status') or '',
        'roomKey': row.get('room_key') or '',
        'date': date_text(row.get('reservation_date')),
        'startTime': time_text(row.get('start_time')),
        'endTime': time_text(row.get('end_time')),
        'reservationNumber': row.get('reservation_number') or '',
        'reserverName': row.get('reserver_name') or '',
        'product': row.get('product') or '',
        'confirmedEmailEventId': row.get('confirmed_email_event_id'),
        'confirmedAt': str(row.get('confirmed_email_received_at') or ''),
        'spacecloudReservationId': payload.get('spacecloud_reservation_id') or payload.get('spacecloudReservationId') or '',
    }

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
request = json.loads(base64.b64decode(os.environ['CANCELLATION_GUARD_B64']).decode('utf-8'))
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
            SELECT t.*, l.id AS ledger_id
            FROM rhythmjoy_spacecloud_tasks t
            LEFT JOIN rhythmjoy_booking_ledger l
              ON l.confirmed_email_event_id=t.email_event_id
             AND l.source_platform=IF(t.task_type='naver_cancel', 'naver', 'spacecloud')
            WHERE t.id=%s AND t.status='running' AND t.claim_token=%s
            LIMIT 1
            """,
            (request.get('taskId'), request.get('claimToken') or ''),
        )
        child_db = cur.fetchone()
        child = task_row(child_db, include_payload=True)
        if not child:
            print(json.dumps({'child': None, 'sourceTask': None, 'loser': None, 'winner': None, 'overlaps': []}, ensure_ascii=False))
            raise SystemExit(0)
        payload = child.get('payload') or {}
        losing_id = int((payload.get('losingBooking') or {}).get('id') or 0)
        winning_id = int((payload.get('winningBooking') or {}).get('id') or 0)
        cur.execute('SELECT * FROM rhythmjoy_spacecloud_tasks WHERE id=%s LIMIT 1', (payload.get('sourceTaskId'),))
        source_task = task_row(cur.fetchone())
        cur.execute('SELECT * FROM rhythmjoy_booking_ledger WHERE id=%s LIMIT 1', (losing_id,))
        loser = ledger_row(cur.fetchone())
        cur.execute('SELECT * FROM rhythmjoy_booking_ledger WHERE id=%s LIMIT 1', (winning_id,))
        winner = ledger_row(cur.fetchone())
        target_start, target_end = slot_datetimes(child.get('date'), child.get('startTime'), child.get('endTime'))
        overlaps = []
        if target_start and target_end:
            cur.execute(
                """
                SELECT *
                FROM rhythmjoy_booking_ledger
                WHERE current_status='confirmed'
                  AND room_key=%s
                  AND source_platform IN ('naver','spacecloud')
                  AND DATE_ADD(TIMESTAMP(reservation_date, '00:00:00'), INTERVAL TIME_TO_SEC(start_time) SECOND) < %s
                  AND DATE_ADD(
                        TIMESTAMP(reservation_date, '00:00:00'),
                        INTERVAL (TIME_TO_SEC(end_time) + IF(end_time <= start_time, 86400, 0)) SECOND
                      ) > %s
                ORDER BY COALESCE(confirmed_email_received_at, '9999-12-31 23:59:59'), id
                """,
                (child.get('roomKey') or '', target_end, target_start),
            )
            overlaps = [ledger_row(row) for row in cur.fetchall()]
    print(json.dumps({
        'child': child,
        'sourceTask': source_task,
        'loser': loser,
        'winner': winner,
        'overlaps': overlaps,
    }, ensure_ascii=False))
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '{}');
}

async function verifyRemoteCancellationGuard(args, task) {
  const snapshot = await fetchRemoteCancellationGuardSnapshot(args, task);
  const guard = assessCancellationGuard(snapshot);
  return { ...guard, snapshot };
}

function taskPriorCancellationAttempted(task) {
  if (task?.recoveredFromStaleRunning === true && task?.stalePreviousResultStatus === 'cancel-submit-checkpoint') return true;
  try {
    const result = JSON.parse(task?.resultText || task?.result_text || '{}');
    return result?.submissionAttempted === true || result?.status === 'cancel-submit-checkpoint';
  } catch {
    return false;
  }
}

async function verifyWinningBookingLive(context, guard, args) {
  const winner = guard?.winner || null;
  if (!winner) return { confirmed: false, status: 'needs-review', reason: 'winning-booking-missing' };
  if (winner.sourcePlatform === 'naver') {
    const result = await inspectNaverReservationStatus(context, {
      roomKey: winner.roomKey,
      date: winner.date,
      startTime: winner.startTime,
      endTime: winner.endTime,
      reservationNo: winner.reservationNumber,
      reserverName: winner.reserverName,
      product: winner.product,
    }, { businessId: args.naverBusinessId });
    return {
      confirmed: result.status === '확정',
      platform: 'naver',
      status: result.status,
      reservationNo: result.reservationNo || '',
      reason: result.status === '확정' ? '' : (result.reason || `naver-winner-status-${result.status || 'unknown'}`),
    };
  }
  if (winner.sourcePlatform === 'spacecloud') {
    const result = await inspectSpacecloudConfirmedReservation(context, {
      roomKey: winner.roomKey,
      date: winner.date,
      startTime: winner.startTime,
      endTime: winner.endTime,
      reserverName: winner.reserverName,
      product: winner.product,
      payload: { spacecloud_reservation_id: winner.spacecloudReservationId },
    });
    return {
      confirmed: result.confirmed === true,
      platform: 'spacecloud',
      status: result.status,
      statusCode: result.statusCode || '',
      reservationId: result.reservationId || '',
      verification: result.verification || null,
      reason: result.reason || '',
    };
  }
  return { confirmed: false, status: 'needs-review', reason: 'winning-platform-invalid' };
}

function shortenResultString(value, maxLength = 220) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function compactCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  if (candidate.source === 'spacecloud-calendar-api' || candidate.scheduleId) {
    return {
      source: 'spacecloud-calendar-api',
      scheduleId: String(candidate.scheduleId || ''),
      name: shortenResultString(candidate.name, 80),
      date: candidate.date || '',
      endDate: candidate.endDate || '',
      startTime: candidate.startTime || '',
      endTime: candidate.endTime || '',
      taskId: String(candidate.taskId || ''),
      reservationNo: String(candidate.reservationNo || ''),
    };
  }
  return {
    index: candidate.index,
    cellIndex: candidate.cellIndex,
    dateScopeMethod: candidate.dateScopeMethod,
    text: shortenResultString(candidate.text || candidate.visibleText || '', 120),
    className: candidate.className,
    directHint: Boolean(candidate.directHint),
  };
}

function compactConflictResultBooking(booking) {
  if (!booking || typeof booking !== 'object') return booking;
  return {
    id: Number(booking.id || 0) || null,
    sourcePlatform: booking.sourcePlatform || booking.source_platform || '',
    sourceMode: booking.sourceMode || booking.source_mode || '',
    currentStatus: booking.currentStatus || booking.current_status || '',
    roomKey: booking.roomKey || booking.room_key || '',
    date: booking.date || booking.reservationDate || booking.reservation_date || '',
    startTime: booking.startTime || booking.start_time || '',
    endTime: booking.endTime || booking.end_time || '',
    reservationNumber: booking.reservationNumber || booking.reservation_number || '',
    reserverName: booking.reserverName || booking.reserver_name || '',
    product: booking.product || '',
    confirmedEmailEventId: booking.confirmedEmailEventId || booking.confirmed_email_event_id || null,
    confirmedAt: booking.confirmedAt || booking.confirmed_email_received_at || booking.lastEventAt || booking.last_event_at || '',
    spacecloudReservationId: booking.spacecloudReservationId || booking.spacecloud_reservation_id || '',
    sourceTaskId: booking.sourceTaskId || null,
    sourceTaskType: booking.sourceTaskType || '',
  };
}

function compactDirectVerification(value) {
  if (!value || typeof value !== 'object') return value;
  return {
    ok: Boolean(value.ok),
    reason: value.reason || '',
    source: value.source || '',
    apiStatus: value.apiStatus,
    apiError: shortenResultString(value.apiError, 180),
    productId: String(value.productId || ''),
    waitedMs: value.waitedMs,
    refreshCount: value.refreshCount,
    candidateReadCount: value.candidateReadCount,
    verificationPasses: value.verificationPasses,
    candidateCount: value.candidateCount,
    identityCandidateCount: value.identityCandidateCount,
    nameMatched: Boolean(value.nameMatched),
    identityMatched: Boolean(value.identityMatched),
    identityVerification: value.identityVerification || null,
    reservationNo: value.reservationNo || '',
    candidates: (value.candidates || []).slice(0, 5).map(compactCandidate),
    dayCellText: shortenResultString(value.dayCellText, 180),
    identityAttempts: (value.identityAttempts || []).slice(-6).map((attempt) => ({
      candidate: compactCandidate(attempt.candidate),
      status: attempt.status || '',
      error: shortenResultString(attempt.error, 180),
      popupTextPreview: shortenResultString(attempt.popupTextPreview, 220),
      verification: attempt.verification || null,
    })),
  };
}

function compactNaverPlannedSlot(value) {
  if (!value || typeof value !== 'object') return value;
  return {
    date: value.date || '',
    startTime: value.startTime || '',
    endTime: value.endTime || '',
    slotIndex: value.slotIndex,
  };
}

function compactNaverBeforeSlot(value) {
  if (!value || typeof value !== 'object') return value;
  const slot = value.slot || value.beforeSlot || {};
  return {
    ...compactNaverPlannedSlot(value),
    status: slot.status || value.status || 'unknown',
    reason: shortenResultString(slot.reason || value.reason, 160),
  };
}

function compactNaverAppliedSlot(value, expectedStatus) {
  if (!value || typeof value !== 'object') return value;
  const beforeStatus = value.beforeSlot?.status || value.slot?.status || value.beforeStatus || 'unknown';
  const afterStatus = value.afterSlot?.status || value.afterStatus || (
    ['already-blocked', 'already-available'].includes(value.status) ? beforeStatus : 'unknown'
  );
  const changed = ['blocked', 'restored'].includes(value.status);
  const panelChecked = Boolean(value.panelVerification);
  const saveRequired = changed;
  return {
    ...compactNaverPlannedSlot(value),
    status: value.status || '',
    beforeStatus,
    afterStatus,
    expectedStatus,
    verified: Boolean(expectedStatus && afterStatus === expectedStatus),
    panelChecked,
    panelVerified: panelChecked ? value.panelVerification?.ok === true : !changed,
    saveRequired,
    saveCompleted: saveRequired ? Boolean(value.save) : true,
    error: shortenResultString(value.error, 240),
  };
}

function compactNaverAvailabilityResult(row) {
  const taskType = String(row.taskType || row.task_type || '');
  const looksLikeNaverAvailability = ['naver_block', 'naver_restore'].includes(taskType)
    || ['available', 'unavailable'].includes(row.targetStatus)
    || Array.isArray(row.appliedSlots)
    || Array.isArray(row.beforeSlots);
  if (!looksLikeNaverAvailability) return row;

  const expectedStatus = row.targetStatus === 'available' || taskType === 'naver_restore'
    ? 'available'
    : 'suspended';
  const plannedSlots = (row.slotRows || []).map(compactNaverPlannedSlot);
  const beforeSlots = (row.beforeSlots || []).map(compactNaverBeforeSlot);
  const appliedSlots = (row.appliedSlots || []).map((slot) => compactNaverAppliedSlot(slot, expectedStatus));
  const evidenceByKey = new Map();
  const slotKey = (slot) => [slot.date, slot.startTime, slot.endTime].join('|');
  for (const slot of beforeSlots) {
    evidenceByKey.set(slotKey(slot), {
      ...slot,
      beforeStatus: slot.status,
      afterStatus: slot.status,
      expectedStatus,
      verified: slot.status === expectedStatus,
      panelChecked: false,
      panelVerified: false,
      saveRequired: false,
      saveCompleted: false,
    });
  }
  for (const slot of appliedSlots) evidenceByKey.set(slotKey(slot), slot);
  const slots = [...evidenceByKey.values()].sort((left, right) => (
    Number(left.slotIndex || 0) - Number(right.slotIndex || 0)
  ));
  const slotCount = Number(row.slotCount || plannedSlots.length || slots.length || 0);
  const verifiedSlotCount = slots.filter((slot) => slot.verified === true).length;

  row.slotRows = plannedSlots;
  row.beforeSlots = beforeSlots;
  row.appliedSlots = appliedSlots;
  row.verificationEvidence = {
    version: 1,
    kind: 'naver-availability-slots',
    expectedStatus,
    slotCount,
    observedSlotCount: slots.length,
    verifiedSlotCount,
    allSlotsVerified: slotCount > 0 && slots.length === slotCount && verifiedSlotCount === slotCount,
    slots,
  };
  return row;
}

function compactTaskResultObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const row = compactNaverAvailabilityResult({ ...value });

  for (const key of [
    'preflightVerification',
    'postSubmitVerification',
    'fastVerification',
    'confirmationVerification',
    'verification',
  ]) {
    if (row[key] && typeof row[key] === 'object') {
      row[key] = compactDirectVerification(row[key]);
    }
  }

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
  if (row.winningBooking) row.winningBooking = compactConflictResultBooking(row.winningBooking);
  if (row.losingBooking) row.losingBooking = compactConflictResultBooking(row.losingBooking);
  if (Array.isArray(row.overlapBookings)) row.overlapBookings = row.overlapBookings.slice(0, 4).map(compactConflictResultBooking);
  if (Array.isArray(row.actionableOverlapBookings)) row.actionableOverlapBookings = row.actionableOverlapBookings.slice(0, 4).map(compactConflictResultBooking);
  if (Array.isArray(row.ignoredRecordOnlyOverlapBookings)) row.ignoredRecordOnlyOverlapBookings = row.ignoredRecordOnlyOverlapBookings.slice(0, 4).map(compactConflictResultBooking);

  return row;
}

function resultTextFits(value, maxBytes) {
  return Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function taskResultTextForDb(resultText, maxBytes = TASK_RESULT_TEXT_MAX_BYTES) {
  const raw = String(resultText || '');
  if (!raw) return '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const fallback = JSON.stringify({
      status: '',
      resultSummary: 'non-json result compacted to keep valid JSON in DB',
      rawPreview: shortenResultString(raw, 1000),
    }, null, 2);
    return resultTextFits(fallback, maxBytes)
      ? fallback
      : JSON.stringify({ status: '', resultSummary: 'non-json result omitted: DB byte limit' });
  }

  const compacted = compactTaskResultObject(parsed);
  const compactText = JSON.stringify(compacted, null, 2);
  if (resultTextFits(compactText, maxBytes)) return compactText;
  const summary = {
    status: compacted.status || '',
    taskId: compacted.taskId || null,
    taskType: compacted.taskType || '',
    roomKey: compacted.roomKey || '',
    date: compacted.date || '',
    startTime: compacted.startTime || '',
    endTime: compacted.endTime || '',
    reservationNo: compacted.reservationNo || compacted.reservationId || '',
    submissionAttempted: compacted.submissionAttempted === true,
    submissionConfirmed: compacted.submissionConfirmed === true,
    resubmitBlocked: compacted.resubmitBlocked === true,
    retryMode: compacted.retryMode || '',
    error: shortenResultString(compacted.error, 500),
    winningBooking: compacted.winningBooking,
    losingBooking: compacted.losingBooking,
    cancellationTask: compacted.cancellationTask,
    cancellationGuard: compacted.cancellationGuard || compacted.preflightCancellationGuard,
    liveWinner: compacted.liveWinner,
    resultSummary: 'result compacted to keep valid JSON in DB',
    preflightVerification: compacted.preflightVerification,
    postSubmitVerification: compacted.postSubmitVerification,
    deleteVerification: compacted.deleteVerification,
    selectedCandidate: compacted.selectedCandidate,
    candidateSearch: compacted.candidateSearch,
    slotCount: compacted.slotCount,
    changedSlotCount: compacted.changedSlotCount,
    alreadySlotCount: compacted.alreadySlotCount,
    verificationEvidence: compacted.verificationEvidence,
    appliedSlots: compacted.appliedSlots,
  };
  const summaryText = JSON.stringify(summary, null, 2);
  if (resultTextFits(summaryText, maxBytes)) return summaryText;
  const essentialText = JSON.stringify({
    status: summary.status,
    taskId: summary.taskId,
    taskType: summary.taskType,
    roomKey: summary.roomKey,
    date: summary.date,
    startTime: summary.startTime,
    endTime: summary.endTime,
    reservationNo: summary.reservationNo,
    submissionAttempted: summary.submissionAttempted,
    submissionConfirmed: summary.submissionConfirmed,
    resubmitBlocked: summary.resubmitBlocked,
    retryMode: summary.retryMode,
    error: summary.error,
    slotCount: summary.slotCount,
    changedSlotCount: summary.changedSlotCount,
    alreadySlotCount: summary.alreadySlotCount,
    verificationEvidence: summary.verificationEvidence,
    appliedSlots: summary.appliedSlots,
    resultSummary: summary.resultSummary,
  });
  if (resultTextFits(essentialText, maxBytes)) return essentialText;
  // A task must never become done while its essential platform proof vanished.
  // Let the update fail and remain retryable instead of silently storing a
  // misleading success-only summary.
  throw new Error(`essential task verification evidence exceeds ${maxBytes} bytes`);
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

async function requeueRemoteConflictSource(args, task, guard) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({
    taskId: Number(task.id || task.taskId || 0),
    claimToken: String(task.claimToken || task.claim_token || ''),
    sourceTaskId: Number(guard?.sourceTaskId || 0),
    loserLedgerId: Number(guard?.loser?.id || guard?.conflict?.current?.id || 0),
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export CONFLICT_REQUEUE_B64=${shellQuote(payload)}
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

def parse_json(value):
    try:
        parsed = json.loads(value or '{}')
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
request = json.loads(base64.b64decode(os.environ['CONFLICT_REQUEUE_B64']).decode('utf-8'))
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
            "SELECT * FROM rhythmjoy_spacecloud_tasks WHERE id=%s AND status='running' AND claim_token=%s FOR UPDATE",
            (request.get('taskId'), request.get('claimToken') or ''),
        )
        child = cur.fetchone()
        if not child:
            raise RuntimeError('cancel task claim lost before conflict requeue')
        payload = parse_json(child.get('payload_json'))
        source_task_id = int(payload.get('sourceTaskId') or 0)
        loser_id = int((payload.get('losingBooking') or {}).get('id') or 0)
        if source_task_id != int(request.get('sourceTaskId') or 0) or loser_id != int(request.get('loserLedgerId') or 0):
            raise RuntimeError('conflict requeue identity changed')
        cur.execute('SELECT * FROM rhythmjoy_booking_ledger WHERE id=%s FOR UPDATE', (loser_id,))
        loser = cur.fetchone()
        if not loser:
            raise RuntimeError('losing ledger missing during conflict requeue')
        if loser.get('current_status') == 'confirmed':
            cur.execute(
                """
                UPDATE rhythmjoy_spacecloud_tasks
                SET status='pending', locked_at=NULL, claim_token='', processed_at=NULL,
                    result_text=%s, updated_at=NOW()
                WHERE id=%s
                  AND email_event_id=%s
                  AND status IN ('done','needs_review','failed','pending')
                """,
                (
                    json.dumps({
                        'status': 'conflict-cleared-requeued',
                        'reason': 'previous winning booking is no longer confirmed',
                        'cancellationTaskId': child.get('id'),
                        'loserLedgerId': loser_id,
                    }, ensure_ascii=False, separators=(',', ':')),
                    source_task_id,
                    loser.get('confirmed_email_event_id'),
                ),
            )
            source_updated = cur.rowcount
        else:
            source_updated = 0
    conn.commit()
    print(json.dumps({'sourceUpdated': source_updated, 'loserStatus': loser.get('current_status')}, ensure_ascii=False))
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '{}');
}

async function finalizeRemoteCancellationSuccess(args, task, guard, platformResult) {
  const target = await loadCafe24Target(args);
  const payload = Buffer.from(JSON.stringify({
    taskId: Number(task.id || task.taskId || 0),
    claimToken: String(task.claimToken || task.claim_token || ''),
    sourceTaskId: Number(guard?.sourceTaskId || 0),
    winnerLedgerId: Number(guard?.winner?.id || 0),
    loserLedgerId: Number(guard?.loser?.id || 0),
    loserPlatform: String(guard?.loser?.sourcePlatform || ''),
    platformStatus: String(platformResult?.status || ''),
  }), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export CANCELLATION_FINALIZE_B64=${shellQuote(payload)}
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

def parse_json(value):
    try:
        parsed = json.loads(value or '{}')
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
request = json.loads(base64.b64decode(os.environ['CANCELLATION_FINALIZE_B64']).decode('utf-8'))
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
            "SELECT * FROM rhythmjoy_spacecloud_tasks WHERE id=%s AND status='running' AND claim_token=%s FOR UPDATE",
            (request.get('taskId'), request.get('claimToken') or ''),
        )
        child = cur.fetchone()
        if not child:
            raise RuntimeError('cancel task claim lost before finalization')
        payload = parse_json(child.get('payload_json'))
        source_task_id = int(payload.get('sourceTaskId') or 0)
        winner_id = int((payload.get('winningBooking') or {}).get('id') or 0)
        loser_id = int((payload.get('losingBooking') or {}).get('id') or 0)
        if (
            source_task_id != int(request.get('sourceTaskId') or 0)
            or winner_id != int(request.get('winnerLedgerId') or 0)
            or loser_id != int(request.get('loserLedgerId') or 0)
        ):
            raise RuntimeError('cancellation finalization identity changed')
        cur.execute('SELECT * FROM rhythmjoy_booking_ledger WHERE id=%s FOR UPDATE', (loser_id,))
        loser = cur.fetchone()
        if not loser:
            raise RuntimeError('losing ledger missing during cancellation finalization')
        if child.get('email_event_id') != loser.get('confirmed_email_event_id'):
            raise RuntimeError('cancellation finalization email identity mismatch')
        if loser.get('source_platform') != request.get('loserPlatform'):
            raise RuntimeError('cancellation finalization platform mismatch')
        ledger_updated = 0
        if loser.get('current_status') == 'confirmed':
            cancel_audit = {
                'source': 'automatic-later-booking-cancellation',
                'cancelTaskId': child.get('id'),
                'sourceTaskId': source_task_id,
                'winnerLedgerId': winner_id,
                'loserLedgerId': loser_id,
                'platformStatus': request.get('platformStatus') or '',
            }
            cur.execute(
                """
                UPDATE rhythmjoy_booking_ledger
                SET current_status='canceled',
                    automation_canceled_at=NOW(),
                    automation_cancel_task_id=%s,
                    automation_cancel_platform=%s,
                    cancel_payload_json=%s,
                    updated_at=NOW()
                WHERE id=%s AND current_status='confirmed' AND confirmed_email_event_id=%s
                """,
                (
                    child.get('id'),
                    request.get('loserPlatform') or '',
                    json.dumps(cancel_audit, ensure_ascii=False, separators=(',', ':')),
                    loser_id,
                    child.get('email_event_id'),
                ),
            )
            ledger_updated = cur.rowcount
        elif loser.get('current_status') == 'canceled':
            cur.execute(
                """
                UPDATE rhythmjoy_booking_ledger
                SET automation_canceled_at=COALESCE(automation_canceled_at, NOW()),
                    automation_cancel_task_id=COALESCE(automation_cancel_task_id, %s),
                    automation_cancel_platform=COALESCE(NULLIF(automation_cancel_platform, ''), %s),
                    updated_at=NOW()
                WHERE id=%s AND current_status='canceled' AND confirmed_email_event_id=%s
                """,
                (
                    child.get('id'),
                    request.get('loserPlatform') or '',
                    loser_id,
                    child.get('email_event_id'),
                ),
            )
            ledger_updated = cur.rowcount
        else:
            raise RuntimeError('losing ledger is neither confirmed nor canceled during finalization')

        cur.execute('SELECT * FROM rhythmjoy_spacecloud_tasks WHERE id=%s FOR UPDATE', (source_task_id,))
        source = cur.fetchone()
        if not source or source.get('email_event_id') != child.get('email_event_id'):
            raise RuntimeError('source task missing or email identity changed during finalization')
        previous = parse_json(source.get('result_text'))
        resolved = {
            'status': 'conflict-resolved',
            'originalStatus': previous.get('status') or source.get('status') or '',
            'resolutionTaskId': child.get('id'),
            'winnerLedgerId': winner_id,
            'loserLedgerId': loser_id,
            'canceledPlatform': request.get('loserPlatform') or '',
            'platformStatus': request.get('platformStatus') or '',
            'priorityRule': payload.get('priorityRule') or '',
        }
        cur.execute(
            """
            UPDATE rhythmjoy_spacecloud_tasks
            SET status='done', processed_at=COALESCE(processed_at, NOW()),
                locked_at=NULL, claim_token='', result_text=%s, updated_at=NOW()
            WHERE id=%s AND email_event_id=%s
            """,
            (json.dumps(resolved, ensure_ascii=False, separators=(',', ':')), source_task_id, child.get('email_event_id')),
        )
        source_updated = cur.rowcount
    conn.commit()
    print(json.dumps({
        'ledgerUpdated': ledger_updated,
        'ledgerStatus': 'canceled',
        'sourceUpdated': source_updated,
        'sourceTaskId': source_task_id,
    }, ensure_ascii=False))
except Exception:
    conn.rollback()
    raise
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
    diagnostic: session.diagnostic || null,
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
                diagnostic_json MEDIUMTEXT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (platform)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        cur.execute("SHOW COLUMNS FROM rhythmjoy_admin_sessions LIKE 'diagnostic_json'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE rhythmjoy_admin_sessions ADD COLUMN diagnostic_json MEDIUMTEXT NULL AFTER note")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rhythmjoy_session_diagnostic_events (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                platform VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL,
                failure_category VARCHAR(64) NOT NULL DEFAULT '',
                event_signature CHAR(64) NOT NULL,
                cookie_fingerprint CHAR(64) NOT NULL DEFAULT '',
                cookie_expires_at DATETIME NULL,
                boot_id VARCHAR(64) NOT NULL DEFAULT '',
                profile_fingerprint CHAR(64) NOT NULL DEFAULT '',
                network_fingerprint CHAR(64) NOT NULL DEFAULT '',
                final_host VARCHAR(128) NOT NULL DEFAULT '',
                final_path VARCHAR(255) NOT NULL DEFAULT '',
                clock_adjustment_ms BIGINT NULL,
                diagnostic_json MEDIUMTEXT NOT NULL,
                observed_at DATETIME NOT NULL,
                created_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                KEY idx_platform_observed (platform, observed_at),
                KEY idx_signature_observed (event_signature, observed_at)
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
            diagnostic = row.get('diagnostic') if isinstance(row.get('diagnostic'), dict) else {}
            diagnostic_json = json.dumps(diagnostic, ensure_ascii=False, separators=(',', ':'))
            cur.execute(
                """
                INSERT INTO rhythmjoy_admin_sessions (
                    platform, status, ready_at, last_checked_at, note, diagnostic_json, updated_at
                )
                VALUES (%s, %s, IF(%s='ready', NOW(), NULL), NOW(), %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                    status=VALUES(status),
                    ready_at=IF(VALUES(status)='ready', NOW(), ready_at),
                    last_checked_at=NOW(),
                    note=VALUES(note),
                    diagnostic_json=VALUES(diagnostic_json),
                    updated_at=NOW()
                """,
                (platform, status, status, note, diagnostic_json),
            )
            updated += cur.rowcount
            signature = str(diagnostic.get('signature') or '')[:64]
            if not signature:
                continue
            cur.execute(
                """
                SELECT event_signature, status, failure_category, observed_at,
                       TIMESTAMPDIFF(SECOND, observed_at, NOW()) AS age_seconds
                FROM rhythmjoy_session_diagnostic_events
                WHERE platform=%s
                ORDER BY id DESC
                LIMIT 1
                """,
                (platform,),
            )
            previous = cur.fetchone()
            heartbeat_due = (
                not previous
                or previous.get('age_seconds') is None
                or int(previous.get('age_seconds') or 0) >= 86400
            )
            changed = (
                not previous
                or previous.get('event_signature') != signature
                or previous.get('status') != status
                or previous.get('failure_category') != str(diagnostic.get('failureCategory') or '')[:64]
            )
            if not changed and not heartbeat_due:
                continue
            expires = str(diagnostic.get('cookieExpiresAt') or '').replace('T', ' ')[:19] or None
            runtime = diagnostic.get('runtime') if isinstance(diagnostic.get('runtime'), dict) else {}
            cur.execute(
                """
                INSERT INTO rhythmjoy_session_diagnostic_events (
                    platform, status, failure_category, event_signature,
                    cookie_fingerprint, cookie_expires_at, boot_id,
                    profile_fingerprint, network_fingerprint, final_host, final_path,
                    clock_adjustment_ms, diagnostic_json, observed_at, created_at
                ) VALUES (%s,%s,%s,%s,%s,CONVERT_TZ(%s,'+00:00','+09:00'),%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                """,
                (
                    platform,
                    status,
                    str(diagnostic.get('failureCategory') or '')[:64],
                    signature,
                    str(diagnostic.get('cookieFingerprint') or '')[:64],
                    expires,
                    str(runtime.get('bootId') or '')[:64],
                    str(runtime.get('profileFingerprint') or '')[:64],
                    str(runtime.get('networkFingerprint') or '')[:64],
                    str(diagnostic.get('finalHost') or '')[:128],
                    str(diagnostic.get('finalPath') or '')[:255],
                    diagnostic.get('clockAdjustmentMs'),
                    diagnostic_json,
                ),
            )
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
  const ingestionLookbackDays = Number.parseInt(
    process.env.RHYTHMJOY_REFLECTION_INGESTION_LOOKBACK_DAYS || '10',
    10,
  );
  const auditScript = `${target.OPS_ROOT}/rhythmjoy_reflection_audit.py`;
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
export RHYTHMJOY_REFLECTION_INGESTION_LOOKBACK_DAYS=${shellQuote(
    Number.isFinite(ingestionLookbackDays) && ingestionLookbackDays > 0 ? ingestionLookbackDays : 10
  )}
${shellQuote(target.PYTHON_BIN)} ${shellQuote(auditScript)} --env-file ${shellQuote(target.SERVER_ENV_FILE)} --grace-minutes ${shellQuote(Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : 10)} --past-days ${shellQuote(Number.isFinite(pastDays) && pastDays >= 0 ? pastDays : 3650)} --future-days ${shellQuote(Number.isFinite(futureDays) && futureDays > 0 ? futureDays : 730)} --json
`;
  const stdout = runSshScript(target, script);
  const jsonStart = stdout.search(/^\s*\{/m);
  if (jsonStart < 0) throw new Error(`reflection audit returned no JSON: ${stdout.trim().slice(0, 300)}`);
  return JSON.parse(stdout.slice(jsonStart).trim());
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

async function fetchRemoteAdminPlatformAuditCandidates(args) {
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
              r.id AS adminReservationId,
              r.series_id AS adminSeriesId,
              r.status AS reservationStatus,
              CAST(r.reservation_date AS CHAR) AS date,
              r.room_key AS roomKey,
              CONCAT(LPAD(r.start_hour, 2, '0'), ':00') AS startTime,
              CONCAT(LPAD(r.end_hour, 2, '0'), ':00') AS endTime,
              r.reserver_name AS reserverName,
              t.id AS taskId,
              t.task_type AS taskType,
              t.status AS taskStatus,
              t.reservation_number AS reservationNo,
              t.product,
              t.payload_json AS payloadJson,
              t.result_text AS resultText,
              CAST(t.updated_at AS CHAR) AS taskUpdatedAt
            FROM rhythmjoy_admin_reservations r
            LEFT JOIN rhythmjoy_admin_sync_tasks a ON a.reservation_id=r.id
            LEFT JOIN rhythmjoy_spacecloud_tasks t ON t.id=a.live_task_id
            WHERE r.reservation_date >= CURDATE()
              AND DATE_ADD(CAST(r.reservation_date AS DATETIME), INTERVAL r.end_hour HOUR) > NOW()
              AND r.status IN ('confirmed', 'canceled')
              AND (t.id IS NULL OR t.task_type IN ('upload','naver_block','delete','naver_restore'))
            ORDER BY r.reservation_date ASC, r.id ASC, t.id DESC
        """)
        raw = cur.fetchall()
finally:
    conn.close()

reservations = {}
for row in raw:
    rid = str(row['adminReservationId'])
    item = reservations.setdefault(rid, {
        'adminReservationId': row['adminReservationId'],
        'adminSeriesId': row.get('adminSeriesId'),
        'reservationStatus': row['reservationStatus'],
        'date': row['date'],
        'roomKey': row['roomKey'],
        'startTime': row['startTime'],
        'endTime': row['endTime'],
        'reserverName': row['reserverName'],
        'tasks': {},
    })
    task_type = row.get('taskType')
    if task_type and task_type not in item['tasks']:
        item['tasks'][task_type] = {
            'id': row['taskId'],
            'taskId': row['taskId'],
            'taskType': task_type,
            'status': row['taskStatus'],
            'roomKey': (row.get('roomKey') or '').lower(),
            'date': row['date'],
            'startTime': row['startTime'],
            'endTime': row['endTime'],
            'reserverName': row['reserverName'],
            'reservationNo': row.get('reservationNo') or '',
            'product': row.get('product') or '',
            'payloadJson': row.get('payloadJson') or '{}',
            'resultText': row.get('resultText') or '',
            'adminReservationId': row['adminReservationId'],
            'adminSeriesId': row.get('adminSeriesId'),
            'taskUpdatedAt': row.get('taskUpdatedAt'),
        }
print(json.dumps(list(reservations.values()), ensure_ascii=False, default=str))
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '[]');
}

async function persistRemoteAdminPlatformAudits(args, reservations) {
  const target = await loadCafe24Target(args);
  const rows = Object.entries(reservations || {}).map(([reservationId, row]) => ({
    reservationId: Number(reservationId),
    auditStatus: String(row?.auditStatus || 'check_failed'),
    reservationStatus: String(row?.reservationStatus || ''),
    date: String(row?.date || ''),
    roomKey: String(row?.roomKey || '').toLowerCase(),
    checkedAt: String(row?.checkedAt || ''),
    reason: (row?.rows || [])
      .filter((item) => item?.status !== 'ok')
      .map((item) => `${item?.taskType || 'platform'}: ${item?.reason || item?.status || '확인 필요'}`)
      .join(' | ')
      .slice(0, 500),
    detail: row?.rows || [],
  })).filter((row) => Number.isInteger(row.reservationId) && row.reservationId > 0);
  const encoded = Buffer.from(JSON.stringify(rows), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import base64
import json
import os
from datetime import datetime, timedelta, timezone
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
rows = json.loads(base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8'))

def mysql_datetime(value):
    text = str(value or '').strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone(timedelta(hours=9))).replace(tzinfo=None)
        return parsed
    except ValueError:
        return None

conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'],
    port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'],
    password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'],
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=False,
)
try:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rhythmjoy_admin_platform_audits (
                reservation_id BIGINT UNSIGNED NOT NULL,
                audit_status VARCHAR(32) NOT NULL DEFAULT 'check_failed',
                reservation_status VARCHAR(32) NOT NULL DEFAULT '',
                reservation_date DATE NULL,
                room_key VARCHAR(8) NOT NULL DEFAULT '',
                reason VARCHAR(500) NOT NULL DEFAULT '',
                detail_json MEDIUMTEXT NULL,
                checked_at DATETIME NOT NULL,
                resolved_at DATETIME NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (reservation_id),
                KEY idx_platform_audit_status (audit_status, checked_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        ids = []
        for row in rows:
            reservation_id = int(row['reservationId'])
            ids.append(reservation_id)
            cur.execute("""
                INSERT INTO rhythmjoy_admin_platform_audits (
                    reservation_id, audit_status, reservation_status, reservation_date,
                    room_key, reason, detail_json, checked_at, resolved_at, updated_at
                ) VALUES (%s,%s,%s,NULLIF(%s,''),%s,%s,%s,COALESCE(%s,NOW()),IF(%s='ok',COALESCE(%s,NOW()),NULL),NOW())
                ON DUPLICATE KEY UPDATE
                    audit_status=VALUES(audit_status),
                    reservation_status=VALUES(reservation_status),
                    reservation_date=VALUES(reservation_date),
                    room_key=VALUES(room_key),
                    reason=VALUES(reason),
                    detail_json=VALUES(detail_json),
                    checked_at=VALUES(checked_at),
                    resolved_at=IF(VALUES(audit_status)='ok',VALUES(checked_at),NULL),
                    updated_at=NOW()
            """, (
                reservation_id,
                row.get('auditStatus') or 'check_failed',
                row.get('reservationStatus') or '',
                row.get('date') or '',
                row.get('roomKey') or '',
                (row.get('reason') or '')[:500],
                json.dumps(row.get('detail') or [], ensure_ascii=False, separators=(',', ':')),
                mysql_datetime(row.get('checkedAt')),
                row.get('auditStatus') or 'check_failed',
                mysql_datetime(row.get('checkedAt')),
            ))
        if ids:
            placeholders = ','.join(['%s'] * len(ids))
            cur.execute(f"""
                UPDATE rhythmjoy_admin_platform_audits
                SET audit_status='resolved', resolved_at=NOW(), updated_at=NOW()
                WHERE audit_status IN ('mismatch','check_failed')
                  AND reservation_id NOT IN ({placeholders})
            """, ids)
        else:
            cur.execute("""
                UPDATE rhythmjoy_admin_platform_audits
                SET audit_status='resolved', resolved_at=NOW(), updated_at=NOW()
                WHERE audit_status IN ('mismatch','check_failed')
            """)
    conn.commit()
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
PY
`;
  runSshScript(target, script);
}

async function persistRemoteAdminPlatformAuditFailure(args, error) {
  const target = await loadCafe24Target(args);
  const reason = cleanTelegramText(redactPhoneText(String(error?.message || error)), 500);
  const encodedReason = Buffer.from(reason, 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
${shellQuote(target.PYTHON_BIN)} <<'PY'
import base64
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
reason = base64.b64decode(${JSON.stringify(encodedReason)}).decode('utf-8')
conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'],
    port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'],
    password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'],
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
)
try:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rhythmjoy_admin_platform_audits (
                reservation_id BIGINT UNSIGNED NOT NULL,
                audit_status VARCHAR(32) NOT NULL DEFAULT 'check_failed',
                reservation_status VARCHAR(32) NOT NULL DEFAULT '',
                reservation_date DATE NULL,
                room_key VARCHAR(8) NOT NULL DEFAULT '',
                reason VARCHAR(500) NOT NULL DEFAULT '',
                detail_json MEDIUMTEXT NULL,
                checked_at DATETIME NOT NULL,
                resolved_at DATETIME NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (reservation_id),
                KEY idx_platform_audit_status (audit_status, checked_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        cur.execute("""
            INSERT INTO rhythmjoy_admin_platform_audits (
                reservation_id, audit_status, reservation_status, reservation_date,
                room_key, reason, detail_json, checked_at, resolved_at, updated_at
            ) VALUES (0, 'check_failed', 'system', NULL, '', %s, NULL, NOW(), NULL, NOW())
            ON DUPLICATE KEY UPDATE
                audit_status='check_failed',
                reservation_status='system',
                reason=VALUES(reason),
                checked_at=NOW(),
                resolved_at=NULL,
                updated_at=NOW()
        """, (reason,))
finally:
    conn.close()
PY
`;
  runSshScript(target, script);
}

function classifyAdminPlatformInspection(task, inspection) {
  const taskType = task.taskType || task.task_type || '';
  if (!taskType) return { ok: false, status: 'check_failed', reason: 'DB 동기화 작업 기록 없음' };
  if (inspection?.status === 'failed') {
    return { ok: false, status: 'check_failed', reason: inspection.error || '플랫폼 조회 실패' };
  }
  if (taskType === 'upload') {
    if (inspection?.status === 'identity-matched') return { ok: true, status: 'ok', reason: '스페이스클라우드 예약 일치' };
    if (inspection?.status === 'candidate-only') return { ok: false, status: 'check_failed', reason: '스페이스클라우드 후보는 있으나 예약자 식별 불충분' };
    return { ok: false, status: 'mismatch', reason: '스페이스클라우드 예약이 실제 화면에 없음' };
  }
  if (taskType === 'delete') {
    return inspection?.status === 'absent'
      ? { ok: true, status: 'ok', reason: '스페이스클라우드 삭제 확인' }
      : { ok: false, status: 'mismatch', reason: '취소한 스페이스클라우드 예약이 아직 보임' };
  }
  if (taskType === 'naver_block' || taskType === 'naver_restore') {
    const statuses = (inspection?.slots || []).map((slot) => slot.status);
    if (!statuses.length) return { ok: false, status: 'check_failed', reason: '네이버 시간칸을 읽지 못함' };
    const expected = taskType === 'naver_block' ? 'suspended' : 'available';
    if (statuses.every((status) => status === expected)) {
      return {
        ok: true,
        status: 'ok',
        reason: taskType === 'naver_block' ? '네이버 예약 차단 확인' : '네이버 예약 가능 복원 확인',
      };
    }
    return {
      ok: false,
      status: 'mismatch',
      reason: taskType === 'naver_block' ? '네이버 예약 차단이 실제 화면과 다름' : '네이버 예약 가능 복원이 실제 화면과 다름',
    };
  }
  return { ok: false, status: 'check_failed', reason: `지원하지 않는 작업: ${taskType}` };
}

function expectedAdminAuditTaskTypes(reservationStatus) {
  return reservationStatus === 'canceled'
    ? ['delete', 'naver_restore']
    : ['upload', 'naver_block'];
}

function platformAuditStatusForRows(rows, previousStatus = '') {
  const issueRows = rows.filter((row) => !row.classification.ok);
  const rawAuditStatus = issueRows.some((row) => row.classification.status === 'mismatch')
    ? 'mismatch' : issueRows.length ? 'check_failed' : 'ok';
  const auditStatus = rawAuditStatus === 'check_failed'
    && !['recheck_pending', 'check_failed'].includes(previousStatus || '')
    ? 'recheck_pending'
    : rawAuditStatus;
  return { auditStatus, rawAuditStatus, issueRows };
}

function adminAuditTargetLine(reservation) {
  const room = `${String(reservation.roomKey || '').toUpperCase()}홀`;
  return `${reservation.date || '-'} ${reservation.startTime || '-'}-${displayEndTime(reservation.startTime || '', reservation.endTime || '')} · ${room}`;
}

function adminPlatformAuditIssueMessage(reservation, rows) {
  const mismatches = rows.filter((row) => row.classification.status === 'mismatch');
  const title = mismatches.length ? '⚠️ 관리자 일정 실제 반영 불일치' : '🟡 관리자 일정 재검사 필요';
  return compactNotice(title, [
    `대상: ${adminAuditTargetLine(reservation)}`,
    `DB 원장: ${reservation.reservationStatus === 'canceled' ? '취소' : '예약 확정'}`,
    ...rows.filter((row) => !row.classification.ok).map((row) => `${row.platformLabel}: ${row.classification.reason}`),
    mismatches.length ? '판정: DB와 실제 플랫폼 상태가 다름' : '판정: 누락 확정 아님 · 실제 화면 2회 연속 조회 실패',
  ]);
}

function adminPlatformAuditRecoveryMessage(reservation) {
  return compactNotice('✅ 관리자 일정 실제 반영 정상 복구', [
    `대상: ${adminAuditTargetLine(reservation)}`,
    `DB 원장: ${reservation.reservationStatus === 'canceled' ? '취소' : '예약 확정'}`,
    '네이버: 실제 화면 일치',
    '스페이스클라우드: 실제 화면 일치',
  ]);
}

function selectAdminPlatformAuditReservations(candidates, state, limit) {
  const checked = state.reservations || {};
  return [...candidates]
    .sort((left, right) => {
      const leftPriority = checked[String(left.adminReservationId)]?.auditStatus === 'recheck_pending' ? 0 : 1;
      const rightPriority = checked[String(right.adminReservationId)]?.auditStatus === 'recheck_pending' ? 0 : 1;
      const leftAt = Date.parse(checked[String(left.adminReservationId)]?.checkedAt || '') || 0;
      const rightAt = Date.parse(checked[String(right.adminReservationId)]?.checkedAt || '') || 0;
      return leftPriority - rightPriority
        || leftAt - rightAt
        || String(left.date || '').localeCompare(String(right.date || ''))
        || Number(left.adminReservationId) - Number(right.adminReservationId);
    })
    .slice(0, Math.max(1, limit || DEFAULT_ADMIN_PLATFORM_AUDIT_LIMIT));
}

function adminPlatformAuditIntervalMs(args, state) {
  const regularMinutes = Math.max(
    1,
    args.adminPlatformAuditIntervalMinutes || DEFAULT_ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES,
  );
  const hasPendingRecheck = Object.values(state.reservations || {})
    .some((row) => row?.auditStatus === 'recheck_pending');
  return (hasPendingRecheck ? DEFAULT_ADMIN_PLATFORM_AUDIT_RECHECK_MINUTES : regularMinutes) * 60 * 1000;
}

async function runAdminPlatformAudit(args, context, { force = false } = {}) {
  if (!args.adminPlatformAudit && !force) return { skipped: true, reason: 'disabled' };
  const state = await readJsonObject(args.adminPlatformAuditState);
  const intervalMs = adminPlatformAuditIntervalMs(args, state);
  const lastRunAt = Date.parse(state.checkedAt || '') || 0;
  if (!force && lastRunAt && Date.now() - lastRunAt < intervalMs) return { skipped: true, reason: 'interval' };

  const candidates = await fetchRemoteAdminPlatformAuditCandidates(args);
  const selected = selectAdminPlatformAuditReservations(candidates, state, args.adminPlatformAuditLimit);
  const rows = [];
  const nextReservations = { ...(state.reservations || {}) };
  for (const reservation of selected) {
    const reservationRows = [];
    for (const taskType of expectedAdminAuditTaskTypes(reservation.reservationStatus)) {
      const task = reservation.tasks?.[taskType];
      let inspection = { status: 'failed', error: 'DB 동기화 작업 기록 없음' };
      if (task) {
        try {
          inspection = taskType === 'upload' || taskType === 'delete'
            ? await inspectSpacecloudDirectReservation(context, task)
            : await inspectNaverAvailability(context, task);
        } catch (error) {
          inspection = { status: 'failed', error: String(error?.message || error) };
        }
        ensureBrowserInspectionUsable(inspection, `${taskType} admin audit`);
      }
      const classification = classifyAdminPlatformInspection(task || { taskType }, inspection);
      reservationRows.push({
        taskId: task?.taskId || null,
        taskType,
        platformLabel: taskType === 'upload' || taskType === 'delete' ? '스페이스클라우드' : '네이버',
        classification,
        inspection,
      });
    }
    const reservationId = String(reservation.adminReservationId);
    const previous = nextReservations[reservationId] || {};
    const { auditStatus, issueRows } = platformAuditStatusForRows(reservationRows, previous.auditStatus || '');
    if (args.telegram && ['mismatch', 'check_failed'].includes(auditStatus)) {
      const signature = `${auditStatus}:${issueRows.map((row) => `${row.taskType}:${row.classification.reason}`).join('|')}`;
      await notifyOnStateChange(args, `admin-platform-audit:${reservationId}`, signature, adminPlatformAuditIssueMessage(reservation, reservationRows));
    } else if (args.telegram && auditStatus === 'ok' && previous.auditStatus === 'mismatch') {
      await notifyOnStateChange(args, `admin-platform-audit:${reservationId}`, 'ok', adminPlatformAuditRecoveryMessage(reservation));
    }
    nextReservations[reservationId] = {
      checkedAt: new Date().toISOString(),
      auditStatus,
      reservationStatus: reservation.reservationStatus,
      date: reservation.date,
      roomKey: reservation.roomKey,
      rows: reservationRows.map((row) => ({
        taskId: row.taskId,
        taskType: row.taskType,
        status: row.classification.status,
        reason: row.classification.reason,
      })),
    };
    rows.push({ reservationId: Number(reservationId), auditStatus, reservation, rows: reservationRows });
  }
  const candidateIds = new Set(candidates.map((row) => String(row.adminReservationId)));
  for (const reservationId of Object.keys(nextReservations)) {
    if (!candidateIds.has(reservationId)) delete nextReservations[reservationId];
  }
  const result = {
    checkedAt: new Date().toISOString(),
    candidates: candidates.length,
    checked: selected.length,
    ok: rows.filter((row) => row.auditStatus === 'ok').length,
    mismatches: rows.filter((row) => row.auditStatus === 'mismatch').length,
    checkFailed: rows.filter((row) => row.auditStatus === 'check_failed').length,
    recheckPending: rows.filter((row) => row.auditStatus === 'recheck_pending').length,
    rows,
  };
  await persistRemoteAdminPlatformAudits(args, nextReservations);
  await writeJson(args.adminPlatformAuditState, { ...result, reservations: nextReservations });
  logLine(`admin platform audit: candidates=${result.candidates} checked=${result.checked} ok=${result.ok} mismatches=${result.mismatches} recheckPending=${result.recheckPending} checkFailed=${result.checkFailed}`);
  return result;
}

async function maybeRunAdminPlatformAudit(args, context, sessionStatuses = [], options = {}) {
  const blocked = blockedSessionPlatforms(sessionStatuses);
  if (blocked.length) {
    logLine(`admin platform audit skipped by session circuit breaker: ${blocked.join(',')}`);
    return { skipped: true, reason: 'platform-session-unavailable', platforms: blocked };
  }
  try {
    return await runAdminPlatformAudit(args, context, options);
  } catch (error) {
    const errorText = String(error?.message || error);
    logLine(`admin platform audit failed: ${errorText}`);
    if (options.deferBrowserFailure && isBrowserContextClosedProblem(errorText)) {
      logLine('admin platform audit browser failure deferred until immediate recovery check');
      return { error: errorText, recoveryRequired: true };
    }
    try {
      await persistRemoteAdminPlatformAuditFailure(args, error);
    } catch (persistError) {
      logLine(`admin platform audit failure persistence failed: ${String(persistError?.message || persistError)}`);
    }
    if (args.telegram) {
      await notifyOnStateChange(args, 'system:admin-platform-audit', 'check-failed', compactNotice('🟡 관리자 일정 정기검사 실패', [
        '판정: 예약 누락 확정 아님',
        `원인: ${cleanTelegramText(String(error?.message || error), 140)}`,
        '조치: 다음 순환에서 자동 재검사',
      ]));
    }
    return { error: String(error?.message || error) };
  }
}

function customerCancellationAuditLookbackDays() {
  return Math.max(
    1,
    Number.parseInt(
      process.env.RHYTHMJOY_CUSTOMER_CANCELLATION_AUDIT_LOOKBACK_DAYS || '',
      10,
    ) || DEFAULT_CUSTOMER_CANCELLATION_AUDIT_LOOKBACK_DAYS,
  );
}

async function fetchRemoteCustomerPlatformAuditCandidates(args) {
  const target = await loadCafe24Target(args);
  const cancellationLookbackDays = customerCancellationAuditLookbackDays();
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
            CREATE TABLE IF NOT EXISTS rhythmjoy_customer_platform_audits (
                ledger_id BIGINT UNSIGNED NOT NULL,
                audit_status VARCHAR(32) NOT NULL DEFAULT 'check_failed',
                source_platform VARCHAR(32) NOT NULL DEFAULT '',
                source_mode VARCHAR(64) NOT NULL DEFAULT '',
                current_status VARCHAR(32) NOT NULL DEFAULT '',
                reservation_date DATE NULL,
                room_key VARCHAR(8) NOT NULL DEFAULT '',
                reason VARCHAR(500) NOT NULL DEFAULT '',
                detail_json MEDIUMTEXT NULL,
                checked_at DATETIME NOT NULL,
                resolved_at DATETIME NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (ledger_id),
                KEY idx_customer_platform_audit_status (audit_status, checked_at),
                KEY idx_customer_platform_audit_date (reservation_date, checked_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        cur.execute("""
            SELECT
              l.id AS ledgerId,
              l.source_platform AS sourcePlatform,
              l.source_mode AS sourceMode,
              l.current_status AS currentStatus,
              CAST(l.reservation_date AS CHAR) AS date,
              l.room_key AS roomKey,
              TIME_FORMAT(l.start_time, '%H:%i') AS startTime,
              TIME_FORMAT(l.end_time, '%H:%i') AS endTime,
              l.reserver_name AS reserverName,
              l.reservation_number AS reservationNo,
              l.product,
              l.payload_json AS payloadJson,
              l.confirmed_email_event_id AS confirmedEmailEventId,
              CAST(a.checked_at AS CHAR) AS auditCheckedAt,
              a.audit_status AS previousAuditStatus,
              IF(
                l.current_status='canceled',
                IF(l.source_platform='naver','delete','naver_restore'),
                IF(l.source_platform='naver','upload','naver_block')
              ) AS mirrorTaskType,
              (
                SELECT t.id FROM rhythmjoy_spacecloud_tasks t
                WHERE t.task_type=IF(
                        l.current_status='canceled',
                        IF(l.source_platform='naver','delete','naver_restore'),
                        IF(l.source_platform='naver','upload','naver_block')
                      )
                  AND (
                       t.email_event_id=IF(l.current_status='canceled',l.canceled_email_event_id,l.confirmed_email_event_id)
                       OR (
                            t.room_key=l.room_key AND t.reservation_date=l.reservation_date
                            AND t.start_time=l.start_time AND t.end_time=l.end_time
                            AND (
                                 (COALESCE(l.reservation_number,'') <> '' AND t.reservation_number=l.reservation_number)
                                 OR (COALESCE(l.reservation_number,'') = '' AND COALESCE(l.reserver_name,'') <> '' AND t.reserver_name=l.reserver_name)
                                )
                          )
                      )
                ORDER BY CASE WHEN t.status IN ('done','google_pending') THEN 0 ELSE 1 END, t.id DESC LIMIT 1
              ) AS mirrorTaskId,
              (
                SELECT t.status FROM rhythmjoy_spacecloud_tasks t
                WHERE t.task_type=IF(
                        l.current_status='canceled',
                        IF(l.source_platform='naver','delete','naver_restore'),
                        IF(l.source_platform='naver','upload','naver_block')
                      )
                  AND (
                       t.email_event_id=IF(l.current_status='canceled',l.canceled_email_event_id,l.confirmed_email_event_id)
                       OR (
                            t.room_key=l.room_key AND t.reservation_date=l.reservation_date
                            AND t.start_time=l.start_time AND t.end_time=l.end_time
                            AND (
                                 (COALESCE(l.reservation_number,'') <> '' AND t.reservation_number=l.reservation_number)
                                 OR (COALESCE(l.reservation_number,'') = '' AND COALESCE(l.reserver_name,'') <> '' AND t.reserver_name=l.reserver_name)
                                )
                          )
                      )
                ORDER BY CASE WHEN t.status IN ('done','google_pending') THEN 0 ELSE 1 END, t.id DESC LIMIT 1
              ) AS mirrorTaskStatus,
              (
                SELECT t.payload_json FROM rhythmjoy_spacecloud_tasks t
                WHERE t.task_type=IF(
                        l.current_status='canceled',
                        IF(l.source_platform='naver','delete','naver_restore'),
                        IF(l.source_platform='naver','upload','naver_block')
                      )
                  AND (
                       t.email_event_id=IF(l.current_status='canceled',l.canceled_email_event_id,l.confirmed_email_event_id)
                       OR (
                            t.room_key=l.room_key AND t.reservation_date=l.reservation_date
                            AND t.start_time=l.start_time AND t.end_time=l.end_time
                            AND (
                                 (COALESCE(l.reservation_number,'') <> '' AND t.reservation_number=l.reservation_number)
                                 OR (COALESCE(l.reservation_number,'') = '' AND COALESCE(l.reserver_name,'') <> '' AND t.reserver_name=l.reserver_name)
                                )
                          )
                      )
                ORDER BY CASE WHEN t.status IN ('done','google_pending') THEN 0 ELSE 1 END, t.id DESC LIMIT 1
              ) AS mirrorPayloadJson
            FROM rhythmjoy_booking_ledger l
            LEFT JOIN rhythmjoy_customer_platform_audits a ON a.ledger_id=l.id
            WHERE (
                    l.current_status='confirmed'
                 OR (
                      l.current_status='canceled'
                      AND l.canceled_email_received_at >= DATE_SUB(NOW(), INTERVAL ${cancellationLookbackDays} DAY)
                    )
                  )
              AND l.source_platform IN ('naver','spacecloud')
              AND DATE_ADD(
                    TIMESTAMP(l.reservation_date, '00:00:00'),
                    INTERVAL (TIME_TO_SEC(l.end_time) + IF(l.end_time <= l.start_time, 86400, 0)) SECOND
                  ) > NOW()
            ORDER BY IF(a.audit_status='recheck_pending', 0, 1) ASC,
                     IF(l.current_status='canceled', 0, 1) ASC,
                     IF(mirrorTaskStatus IN ('done','google_pending'), 0, 1) ASC,
                     COALESCE(a.checked_at, '1000-01-01 00:00:00') ASC,
                     l.reservation_date ASC, l.start_time ASC, l.id ASC
        """)
        rows = cur.fetchall()
finally:
    conn.close()
print(json.dumps(rows, ensure_ascii=False, default=str))
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '[]');
}

function customerAuditTask(candidate) {
  let payload = {};
  // Keep mirror-only identifiers, but let the current DB-ledger payload win
  // when a later source email changed identity fields after the mirror task.
  for (const raw of [candidate.mirrorPayloadJson, candidate.payloadJson]) {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object') payload = { ...payload, ...parsed };
    } catch {
      // The task still carries normalized DB identity fields below.
    }
  }
  if (candidate.sourcePlatform === 'spacecloud' && !payload.spacecloud_reservation_id) {
    payload.spacecloud_reservation_id = candidate.reservationNo || '';
  }
  return {
    id: candidate.mirrorTaskId || candidate.ledgerId,
    taskId: candidate.mirrorTaskId || candidate.ledgerId,
    roomKey: String(candidate.roomKey || '').toLowerCase(),
    date: candidate.date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    reserverName: candidate.reserverName || '',
    reservationNo: candidate.reservationNo || '',
    product: candidate.product || '',
    payload,
    payloadJson: JSON.stringify(payload),
    ledgerId: candidate.ledgerId,
    cancellationOverlapBookings: candidate.cancellationOverlapBookings || [],
  };
}

function compactCustomerAuditOverlapBooking(booking) {
  return {
    ledgerId: Number(booking.ledgerId || 0) || null,
    sourcePlatform: booking.sourcePlatform || '',
    sourceMode: booking.sourceMode || '',
    currentStatus: booking.currentStatus || '',
    date: booking.date || '',
    roomKey: String(booking.roomKey || '').toLowerCase(),
    startTime: booking.startTime || '',
    endTime: booking.endTime || '',
    mirrorTaskType: booking.mirrorTaskType || '',
    mirrorTaskId: Number(booking.mirrorTaskId || 0) || null,
    mirrorTaskStatus: booking.mirrorTaskStatus || '',
  };
}

function customerCancellationOverlapBookings(candidate, allRows) {
  if (candidate.currentStatus !== 'canceled' || candidate.sourcePlatform !== 'spacecloud') return [];
  return (Array.isArray(allRows) ? allRows : [])
    .filter((booking) => Number(booking.ledgerId) !== Number(candidate.ledgerId))
    .filter((booking) => booking.currentStatus === 'confirmed')
    .filter((booking) => String(booking.roomKey || '').toLowerCase() === String(candidate.roomKey || '').toLowerCase())
    .filter((booking) => reservationSlotsOverlap(candidate, booking))
    .map(compactCustomerAuditOverlapBooking);
}

function naverCancellationSlotExpectation(slot, overlapBookings) {
  const overlaps = (Array.isArray(overlapBookings) ? overlapBookings : [])
    .filter((booking) => reservationSlotsOverlap(slot, booking));
  const activeNaverSources = overlaps.filter((booking) => (
    booking.sourceMode !== 'admin-task-anchor'
    && booking.sourcePlatform === 'naver'
  ));
  const activeOwnedBlocks = overlaps.filter((booking) => (
    (booking.sourceMode === 'admin-task-anchor' || booking.sourcePlatform === 'spacecloud')
    && booking.mirrorTaskType === 'naver_block'
    && ['done', 'google_pending'].includes(String(booking.mirrorTaskStatus || ''))
  ));
  const allowedStatuses = new Set(['available']);
  if (activeNaverSources.length) {
    allowedStatuses.add('confirmed');
    allowedStatuses.add('soldout');
  }
  if (activeOwnedBlocks.length) allowedStatuses.add('suspended');
  return {
    date: slot.date || '',
    startTime: slot.startTime || '',
    endTime: slot.endTime || '',
    actualStatus: slot.status || 'unknown',
    allowedStatuses: [...allowedStatuses],
    justifiedBy: [
      ...activeNaverSources.map((booking) => ({
        ledgerId: booking.ledgerId,
        kind: 'active-naver-source',
      })),
      ...activeOwnedBlocks.map((booking) => ({
        ledgerId: booking.ledgerId,
        kind: booking.sourceMode === 'admin-task-anchor' ? 'active-admin-block' : 'active-spacecloud-block',
        taskId: booking.mirrorTaskId,
      })),
    ],
    ok: allowedStatuses.has(slot.status),
  };
}

function classifyCustomerPlatformInspection(checkType, inspection, task) {
  if (inspection?.status === 'failed') {
    return { ok: false, status: 'check_failed', reason: inspection.error || '플랫폼 조회 실패' };
  }
  if (checkType === 'naver_source') {
    if (!task.reservationNo) return { ok: false, status: 'check_failed', reason: '네이버 예약번호가 DB에 없음' };
    if (inspection?.status === '확정') return { ok: true, status: 'ok', reason: '네이버 원본 예약 확정 확인' };
    if (inspection?.status === '취소') {
      return { ok: false, status: 'mismatch', reason: 'DB는 확정이나 네이버 상세 상태는 취소' };
    }
    if (inspection?.status === 'not_found') {
      return { ok: false, status: 'check_failed', reason: '네이버 목록 검색에서 찾지 못함 · 취소나 누락 확정 아님' };
    }
    return { ok: false, status: 'check_failed', reason: `네이버 원본 상태 판정 불가: ${inspection?.status || '응답 없음'}` };
  }
  if (checkType === 'spacecloud_source') {
    if (!task.payload?.spacecloud_reservation_id) {
      return { ok: false, status: 'check_failed', reason: '스페이스클라우드 예약 ID가 DB에 없음' };
    }
    if (inspection?.status === 'confirmed' && inspection?.confirmed === true) {
      return { ok: true, status: 'ok', reason: '스페이스클라우드 원본 예약 확정 확인' };
    }
    if (inspection?.status === 'canceled') {
      return { ok: false, status: 'mismatch', reason: 'DB는 확정이나 스페이스클라우드 원본은 취소' };
    }
    return { ok: false, status: 'check_failed', reason: `스페이스클라우드 원본 확인 불충분: ${inspection?.reason || inspection?.status || '응답 없음'}` };
  }
  if (checkType === 'spacecloud_mirror') {
    if (inspection?.status === 'found') return { ok: true, status: 'ok', reason: '스페이스클라우드 복제 예약 확인' };
    if (inspection?.status === 'not_found') return { ok: false, status: 'mismatch', reason: '스페이스클라우드 복제 예약이 실제 화면에 없음' };
    return { ok: false, status: 'check_failed', reason: `스페이스클라우드 복제 예약 식별 불충분: ${inspection?.reason || inspection?.status || '응답 없음'}` };
  }
  if (checkType === 'spacecloud_mirror_absent') {
    if (inspection?.status === 'not_found') return { ok: true, status: 'ok', reason: '스페이스클라우드 복제 예약 삭제 확인' };
    if (inspection?.status === 'found') return { ok: false, status: 'mismatch', reason: '취소한 스페이스클라우드 복제 예약이 아직 보임' };
    return { ok: false, status: 'check_failed', reason: `스페이스클라우드 삭제 확인 불충분: ${inspection?.reason || inspection?.status || '응답 없음'}` };
  }
  if (checkType === 'naver_mirror') {
    const statuses = (inspection?.slots || []).map((slot) => slot.status);
    if (!statuses.length) return { ok: false, status: 'check_failed', reason: '네이버 복제 시간칸을 읽지 못함' };
    if (statuses.every((status) => status === 'suspended')) {
      return { ok: true, status: 'ok', reason: '네이버 복제 시간 전체 예약불가 확인' };
    }
    return { ok: false, status: 'mismatch', reason: `네이버 복제 차단 불일치: ${statuses.join(',')}` };
  }
  if (checkType === 'naver_mirror_available') {
    const slots = inspection?.slots || [];
    if (!slots.length) return { ok: false, status: 'check_failed', reason: '네이버 복구 시간칸을 읽지 못함' };
    const expectations = slots.map((slot) => naverCancellationSlotExpectation(
      slot,
      task.cancellationOverlapBookings,
    ));
    inspection.slotExpectations = expectations;
    const problems = expectations.filter((row) => !row.ok);
    if (!problems.length) {
      const protectedCount = expectations.filter((row) => row.actualStatus !== 'available').length;
      return {
        ok: true,
        status: 'ok',
        reason: protectedCount
          ? `네이버 복원 확인 · 다른 활성 예약 보호 ${protectedCount}칸`
          : '네이버 예약 가능 복원 확인',
      };
    }
    return {
      ok: false,
      status: 'mismatch',
      reason: `네이버 복원 불일치: ${problems.map((row) => (
        `${row.date} ${row.startTime}-${row.endTime} ${row.actualStatus} (허용 ${row.allowedStatuses.join('/')})`
      )).join(', ')}`,
    };
  }
  return { ok: false, status: 'check_failed', reason: `지원하지 않는 검사: ${checkType}` };
}

function customerAuditTargetLine(candidate) {
  const room = `${String(candidate.roomKey || '').toUpperCase()}홀`;
  return `${candidate.date || '-'} ${candidate.startTime || '-'}-${displayEndTime(candidate.startTime || '', candidate.endTime || '')} · ${room}`;
}

function customerAuditChecks(candidate) {
  if (candidate.currentStatus === 'canceled') {
    return candidate.sourcePlatform === 'naver'
      ? [{ checkType: 'spacecloud_mirror_absent', platformLabel: '스페이스클라우드 복제본' }]
      : [{ checkType: 'naver_mirror_available', platformLabel: '네이버 복제 시간' }];
  }
  const hasCompletedMirror = Boolean(candidate.mirrorTaskId)
    && ['done', 'google_pending'].includes(String(candidate.mirrorTaskStatus || ''));
  if (candidate.sourcePlatform === 'naver') {
    return [
      { checkType: 'naver_source', platformLabel: '네이버 원본' },
      ...(hasCompletedMirror ? [{ checkType: 'spacecloud_mirror', platformLabel: '스페이스클라우드 복제' }] : []),
    ];
  }
  return [
    { checkType: 'spacecloud_source', platformLabel: '스페이스클라우드 원본' },
    ...(hasCompletedMirror ? [{ checkType: 'naver_mirror', platformLabel: '네이버 복제' }] : []),
  ];
}

function customerAuditScopeLine(candidate, rows) {
  if (candidate.currentStatus === 'canceled') {
    return candidate.sourcePlatform === 'naver'
      ? '검사 범위: 취소 후 스페이스클라우드 복제본 삭제'
      : '검사 범위: 취소 후 네이버 예약 가능 복원';
  }
  return rows.length > 1
    ? '검사 범위: 원본 + 완료 기록이 있는 복제본'
    : `검사 범위: ${candidate.sourcePlatform === 'naver' ? '네이버' : '스페이스클라우드'} 원본만 · 복제 작업 완료 기록 없음`;
}

function customerPlatformAuditIssueMessage(candidate, rows) {
  const mismatches = rows.filter((row) => row.classification.status === 'mismatch');
  return compactNotice(mismatches.length ? '⚠️ 고객 예약 실제 반영 불일치' : '🟡 고객 예약 재검사 필요', [
    `대상: ${customerAuditTargetLine(candidate)}`,
    `DB 원장: ${candidate.currentStatus === 'canceled' ? '취소' : '확정'} · 원본 ${candidate.sourcePlatform === 'naver' ? '네이버' : '스페이스클라우드'}`,
    customerAuditScopeLine(candidate, rows),
    ...rows.filter((row) => !row.classification.ok).map((row) => `${row.platformLabel}: ${row.classification.reason}`),
    mismatches.length ? '판정: DB와 실제 플랫폼 상태가 다름' : '판정: 누락 확정 아님 · 실제 화면 2회 연속 조회 실패',
  ]);
}

function customerPlatformAuditRecoveryMessage(candidate, rows) {
  return compactNotice('✅ 고객 예약 실제 반영 정상 복구', [
    `대상: ${customerAuditTargetLine(candidate)}`,
    customerAuditScopeLine(candidate, rows),
    candidate.currentStatus === 'canceled'
      ? '판정: DB 취소 원장과 반대 플랫폼의 취소 반영 일치'
      : (rows.length > 1 ? '판정: DB 원장·원본·복제본 일치' : '판정: DB 원장·원본 플랫폼 일치'),
  ]);
}

async function persistRemoteCustomerPlatformAudits(args, rows) {
  const target = await loadCafe24Target(args);
  const cancellationLookbackDays = customerCancellationAuditLookbackDays();
  const payload = rows.map((row) => ({
    ledgerId: Number(row.candidate.ledgerId),
    auditStatus: row.auditStatus,
    sourcePlatform: row.candidate.sourcePlatform || '',
    sourceMode: row.candidate.sourceMode || '',
    currentStatus: row.candidate.currentStatus || '',
    date: row.candidate.date || '',
    roomKey: String(row.candidate.roomKey || '').toLowerCase(),
    reason: row.rows.filter((item) => !item.classification.ok)
      .map((item) => `${item.platformLabel}: ${item.classification.reason}`).join(' | ').slice(0, 500),
    detail: row.rows.map((item) => ({
      checkType: item.checkType,
      platformLabel: item.platformLabel,
      status: item.classification.status,
      reason: item.classification.reason,
      inspection: item.inspection,
    })),
  }));
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const script = `
set -e
export RHYTHMJOY_ENV_FILE=${shellQuote(target.SERVER_ENV_FILE)}
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
rows = json.loads(base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8'))
conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'], port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'], password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'], charset='utf8mb4', autocommit=False,
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rhythmjoy_customer_platform_audits (
                ledger_id BIGINT UNSIGNED NOT NULL,
                audit_status VARCHAR(32) NOT NULL DEFAULT 'check_failed',
                source_platform VARCHAR(32) NOT NULL DEFAULT '',
                source_mode VARCHAR(64) NOT NULL DEFAULT '',
                current_status VARCHAR(32) NOT NULL DEFAULT '',
                reservation_date DATE NULL,
                room_key VARCHAR(8) NOT NULL DEFAULT '',
                reason VARCHAR(500) NOT NULL DEFAULT '',
                detail_json MEDIUMTEXT NULL,
                checked_at DATETIME NOT NULL,
                resolved_at DATETIME NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (ledger_id),
                KEY idx_customer_platform_audit_status (audit_status, checked_at),
                KEY idx_customer_platform_audit_date (reservation_date, checked_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        for row in rows:
            cur.execute("""
                INSERT INTO rhythmjoy_customer_platform_audits (
                    ledger_id, audit_status, source_platform, source_mode, current_status,
                    reservation_date, room_key, reason, detail_json, checked_at, resolved_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,NULLIF(%s,''),%s,%s,%s,NOW(),IF(%s='ok',NOW(),NULL),NOW())
                ON DUPLICATE KEY UPDATE
                    audit_status=VALUES(audit_status), source_platform=VALUES(source_platform),
                    source_mode=VALUES(source_mode), current_status=VALUES(current_status),
                    reservation_date=VALUES(reservation_date), room_key=VALUES(room_key),
                    reason=VALUES(reason), detail_json=VALUES(detail_json), checked_at=NOW(),
                    resolved_at=IF(VALUES(audit_status)='ok',NOW(),NULL), updated_at=NOW()
            """, (
                int(row['ledgerId']), row['auditStatus'], row['sourcePlatform'], row['sourceMode'],
                row['currentStatus'], row['date'], row['roomKey'], row['reason'],
                json.dumps(row['detail'], ensure_ascii=False, separators=(',', ':')),
                row['auditStatus'],
            ))
        if all(int(row['ledgerId']) != 0 for row in rows):
            cur.execute("""
                UPDATE rhythmjoy_customer_platform_audits
                SET audit_status='resolved', reason='정기검사 실행 복구', resolved_at=NOW(), updated_at=NOW()
                WHERE ledger_id=0 AND audit_status='check_failed'
            """)
        cur.execute("""
            UPDATE rhythmjoy_customer_platform_audits a
            LEFT JOIN rhythmjoy_booking_ledger l ON l.id=a.ledger_id
            SET a.audit_status='resolved', a.resolved_at=NOW(), a.updated_at=NOW()
            WHERE a.ledger_id <> 0
              AND a.audit_status IN ('mismatch','check_failed')
              AND (
                    l.id IS NULL
                 OR l.current_status NOT IN ('confirmed','canceled')
                 OR (
                      l.current_status='canceled'
                      AND (
                           l.canceled_email_received_at IS NULL
                           OR l.canceled_email_received_at < DATE_SUB(NOW(), INTERVAL ${cancellationLookbackDays} DAY)
                          )
                    )
                 OR DATE_ADD(
                      TIMESTAMP(l.reservation_date, '00:00:00'),
                      INTERVAL (TIME_TO_SEC(l.end_time) + IF(l.end_time <= l.start_time, 86400, 0)) SECOND
                    ) <= NOW()
                  )
        """)
    conn.commit()
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
PY
`;
  runSshScript(target, script);
}

async function persistRemoteCustomerPlatformAuditFailure(args, error) {
  const failure = [{
    candidate: { ledgerId: 0, sourcePlatform: 'system', sourceMode: '', currentStatus: 'system', date: '', roomKey: '' },
    auditStatus: 'check_failed',
    rows: [{
      checkType: 'system', platformLabel: '정기검사',
      classification: { ok: false, status: 'check_failed', reason: cleanTelegramText(String(error?.message || error), 500) },
      inspection: {},
    }],
  }];
  await persistRemoteCustomerPlatformAudits(args, failure);
}

function customerAuditStatusForRows(rows, previousStatus = '') {
  return platformAuditStatusForRows(rows, previousStatus);
}

async function inspectCustomerAuditCandidate(args, context, candidate) {
  const task = customerAuditTask(candidate);
  const checks = customerAuditChecks(candidate);
  const rows = [];
  for (const check of checks) {
    let inspection;
    try {
      if (check.checkType === 'naver_source') {
        inspection = await inspectNaverReservationStatus(context, task, { businessId: args.naverBusinessId });
      } else if (check.checkType === 'spacecloud_source') {
        inspection = await inspectSpacecloudConfirmedReservation(context, task);
      } else if (['spacecloud_mirror', 'spacecloud_mirror_absent'].includes(check.checkType)) {
        inspection = await inspectSpacecloudReservationStatus(context, task);
      } else {
        inspection = await inspectNaverAvailability(context, task, { businessId: args.naverBusinessId });
      }
    } catch (error) {
      inspection = { status: 'failed', error: String(error?.message || error) };
    }
    ensureBrowserInspectionUsable(inspection, `${check.checkType} customer audit`);
    rows.push({
      ...check,
      classification: classifyCustomerPlatformInspection(check.checkType, inspection, task),
      inspection,
    });
  }
  const { auditStatus, rawAuditStatus } = customerAuditStatusForRows(rows, candidate.previousAuditStatus || '');
  return { candidate, auditStatus, rawAuditStatus, rows };
}

function customerPlatformAuditIntervalMs(args, state) {
  const regularMinutes = Math.max(
    1,
    args.customerPlatformAuditIntervalMinutes || DEFAULT_CUSTOMER_PLATFORM_AUDIT_INTERVAL_MINUTES,
  );
  const recheckMinutes = Math.max(
    1,
    Number.parseInt(process.env.RHYTHMJOY_CUSTOMER_PLATFORM_AUDIT_RECHECK_MINUTES || '', 10)
      || DEFAULT_CUSTOMER_PLATFORM_AUDIT_RECHECK_MINUTES,
  );
  return (Number(state.recheckPending || 0) > 0 ? recheckMinutes : regularMinutes) * 60 * 1000;
}

async function runCustomerPlatformAudit(args, context, { force = false } = {}) {
  if (!args.customerPlatformAudit && !force) return { skipped: true, reason: 'disabled' };
  const state = await readJsonObject(args.customerPlatformAuditState);
  const intervalMs = customerPlatformAuditIntervalMs(args, state);
  const lastRunAt = Date.parse(state.checkedAt || '') || 0;
  if (!force && lastRunAt && Date.now() - lastRunAt < intervalMs) return { skipped: true, reason: 'interval' };

  const fetchedRows = await fetchRemoteCustomerPlatformAuditCandidates(args);
  const allCandidates = fetchedRows
    .filter((row) => row.sourceMode !== 'admin-task-anchor')
    .map((candidate) => ({
      ...candidate,
      cancellationOverlapBookings: customerCancellationOverlapBookings(candidate, fetchedRows),
    }));
  const candidates = args.customerPlatformAuditLedgerId
    ? allCandidates.filter((row) => Number(row.ledgerId) === Number(args.customerPlatformAuditLedgerId))
    : allCandidates;
  const selected = candidates.slice(0, Math.max(1, args.customerPlatformAuditLimit || DEFAULT_CUSTOMER_PLATFORM_AUDIT_LIMIT));
  const rows = [];
  for (const candidate of selected) rows.push(await inspectCustomerAuditCandidate(args, context, candidate));

  await persistRemoteCustomerPlatformAudits(args, rows);
  for (const row of rows) {
    const previousStatus = row.candidate.previousAuditStatus || '';
    if (args.telegram && ['mismatch', 'check_failed'].includes(row.auditStatus)) {
      const issueRows = row.rows.filter((item) => !item.classification.ok);
      const signature = `${row.auditStatus}:${issueRows.map((item) => `${item.checkType}:${item.classification.reason}`).join('|')}`;
      await notifyOnStateChange(args, `customer-platform-audit:${row.candidate.ledgerId}`, signature, customerPlatformAuditIssueMessage(row.candidate, row.rows));
    } else if (args.telegram && row.auditStatus === 'ok' && previousStatus === 'mismatch') {
      await notifyOnStateChange(args, `customer-platform-audit:${row.candidate.ledgerId}`, 'ok', customerPlatformAuditRecoveryMessage(row.candidate, row.rows));
    }
  }
  const result = {
    checkedAt: new Date().toISOString(), candidates: candidates.length, checked: rows.length,
    ok: rows.filter((row) => row.auditStatus === 'ok').length,
    mismatches: rows.filter((row) => row.auditStatus === 'mismatch').length,
    checkFailed: rows.filter((row) => row.auditStatus === 'check_failed').length,
    recheckPending: rows.filter((row) => row.auditStatus === 'recheck_pending').length,
    rows,
  };
  await writeJson(args.customerPlatformAuditState, {
    checkedAt: result.checkedAt, candidates: result.candidates, checked: result.checked,
    ok: result.ok, mismatches: result.mismatches, checkFailed: result.checkFailed,
    recheckPending: result.recheckPending,
  });
  logLine(`customer platform audit: candidates=${result.candidates} checked=${result.checked} ok=${result.ok} mismatches=${result.mismatches} recheckPending=${result.recheckPending} checkFailed=${result.checkFailed}`);
  return result;
}

async function maybeRunCustomerPlatformAudit(args, context, sessionStatuses = [], options = {}) {
  const blocked = blockedSessionPlatforms(sessionStatuses);
  if (blocked.length) {
    logLine(`customer platform audit skipped by session circuit breaker: ${blocked.join(',')}`);
    return { skipped: true, reason: 'platform-session-unavailable', platforms: blocked };
  }
  try {
    return await runCustomerPlatformAudit(args, context, options);
  } catch (error) {
    const errorText = String(error?.message || error);
    logLine(`customer platform audit failed: ${errorText}`);
    if (options.deferBrowserFailure && isBrowserContextClosedProblem(errorText)) {
      logLine('customer platform audit browser failure deferred until immediate recovery check');
      return { error: errorText, recoveryRequired: true };
    }
    try {
      await persistRemoteCustomerPlatformAuditFailure(args, error);
    } catch (persistError) {
      logLine(`customer platform audit failure persistence failed: ${String(persistError?.message || persistError)}`);
    }
    if (args.telegram) {
      await notifyOnStateChange(args, 'system:customer-platform-audit', 'check-failed', compactNotice('🟡 고객 예약 정기검사 실패', [
        '판정: 예약 누락 확정 아님',
        `원인: ${cleanTelegramText(String(error?.message || error), 140)}`,
        '조치: 다음 순환에서 자동 재검사',
      ]));
    }
    return { error: String(error?.message || error) };
  }
}

function isLoginProblem(message) {
  return /login|logged out|add button not visible|로그인|세션|인증/i.test(String(message || ''));
}

function isTransientRemoteProblem(message) {
  return /ssh failed|timed out|ETIMEDOUT|SIGKILL|Connection timed out|Connection reset|Connection closed by|Broken pipe/i.test(String(message || ''));
}

function isBrowserContextClosedProblem(message) {
  return /Target (?:page, context or browser|page|context|browser) has been closed|Page crashed|browser (?:has )?disconnected|browser process (?:closed|crashed)/i.test(String(message || ''));
}

function ensureBrowserInspectionUsable(inspection, label = 'platform inspection') {
  const inspectionText = typeof inspection === 'string' ? inspection : JSON.stringify(inspection || {});
  if (!isBrowserContextClosedProblem(inspectionText)) return inspection;
  const reason = String(inspection?.error || inspection?.reason || inspectionText);
  throw new Error(`${label}: ${reason}`);
}

function isRetryablePlatformProblem(message) {
  return isBrowserContextClosedProblem(message)
    || /page\.goto|Timeout \d+ms exceeded|domcontentloaded|net::|ERR_|ECONNRESET|ETIMEDOUT|Connection reset|Connection closed|page load|navigation|modal still visible after submit|calendar title month not found|calendar DOM not ready/i.test(String(message || ''));
}

function platformTransientMaxAttempts() {
  const configured = Number.parseInt(process.env.RHYTHMJOY_PLATFORM_TRANSIENT_MAX_ATTEMPTS || '', 10);
  if (!Number.isFinite(configured) || configured < 1 || configured > 50) {
    return PLATFORM_TRANSIENT_MAX_ATTEMPTS;
  }
  return configured;
}

function currentPlatformTaskAttempt(row, task = null) {
  const explicit = Number(row?.currentAttempt);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const previous = Number(task?.attempts);
  if (Number.isFinite(previous) && previous >= 0) return Math.floor(previous) + 1;
  return 1;
}

function retryablePlatformDbStatus(row, task = null) {
  const loginProblem = isLoginProblem(row?.error);
  const transientProblem = isRetryablePlatformProblem(row?.error);
  if (!loginProblem && !transientProblem) return '';

  const currentAttempt = currentPlatformTaskAttempt(row, task);
  const maxAutomaticAttempts = platformTransientMaxAttempts();
  const exhausted = currentAttempt >= maxAutomaticAttempts;
  row.automaticRetry = {
    kind: loginProblem ? 'login-or-session' : 'transient-platform',
    currentAttempt,
    maxAutomaticAttempts,
    exhausted,
  };
  if (!exhausted) return 'pending';

  const suffix = `자동 재시도 한도 도달 (${currentAttempt}/${maxAutomaticAttempts}); 관리자 확인 필요`;
  if (!String(row.error || '').includes('자동 재시도 한도 도달')) {
    row.error = `${String(row.error || 'platform operation failed')} | ${suffix}`;
  }
  row.retryExhausted = true;
  return 'needs_review';
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
    'elapsed-no-action': '지난 시간 자동 생략',
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
    phone_lookup_failed: '전화번호 확인 대기',
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
    ...(row.smsFollowUpTasks?.rows || []),
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
    if (['blocked', 'already-blocked'].includes(status)) {
      const skipped = Number(row.skippedStartedSlotCount || 0);
      return skipped > 0
        ? `네이버 예약불가 완료 (지난 ${skipped}칸 생략)`
        : '네이버 예약불가 완료';
    }
    if (status === 'elapsed-no-action') return '네이버 지난 시간 자동 생략';
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
    ...successRowsForResult(row.naverBlockTasks, ['blocked', 'already-blocked', 'elapsed-no-action'], 'naver_block'),
    ...successRowsForResult(row.naverRestoreTasks, ['restored', 'already-available', 'restore-skipped-not-owned', 'elapsed-no-action'], 'naver_restore'),
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

function syncSuccessMessage(row) {
  const taskType = row.taskType || row.task_type || '';
  const isCancellation = ['delete', 'naver_restore', 'spacecloud_cancel', 'naver_cancel'].includes(taskType);
  return compactNotice(
    isCancellation ? '✅ 예약 취소 반영 완료' : '✅ 예약 반영 완료',
    [
      syncReservationLine(row),
      'DB 원장: 정상',
      syncPlatformResultLine(row),
    ],
  );
}

function reservationNotificationKey(row, fallbackTaskType = '') {
  return `reservation:${taskIdentityKey(row, fallbackTaskType)}`;
}

function reservationCompletionSignature(row) {
  // submitted/already-blocked/already-available are implementation paths to
  // the same verified final state. A retry must not create a second success
  // notification merely because that path label changed.
  return 'complete:verified';
}

function reservationAttentionSignature(rowOrError, category, taskType = '') {
  const row = firstProblemRow(rowOrError);
  const reason = firstFailureReason(rowOrError);
  const reasonFingerprint = createHash('sha256').update(reason).digest('hex').slice(0, 12);
  return `attention:${category}:${taskType || row.taskType || row.task_type || 'task'}:${row.status || 'failed'}:${reasonFingerprint}`;
}

function reservationAttentionNotificationKey(row, taskType = '') {
  if (row?.adminPanelTask && row?.adminReservationId) {
    return `admin-reservation:${row.adminReservationId}`;
  }
  return reservationNotificationKey(row, taskType);
}

async function notifyReservationAttention(args, rowOrError, category, taskType, text) {
  const row = firstProblemRow(rowOrError);
  const notificationKey = reservationAttentionNotificationKey(row, taskType);
  return notifyOnStateChange(
    args,
    notificationKey,
    reservationAttentionSignature(rowOrError, category, taskType),
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
    '예약 감시: 해당 플랫폼 작업만 안전하게 대기',
    `후보: ${candidates ?? '-'}건`,
    rows.length ? `대상:\n${formatBriefRows(rows, 1)}` : '',
    `원인: ${cleanTelegramText(errorText || '-', 120)}`,
    '조치: 맥북에서 ops/recover-ubuntu-platform-sessions.sh 실행 후 열린 미니PC 창에서 로그인',
    '세션 복구 후 미완료 작업은 DB 기록 순서대로 자동 재실행됩니다.',
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
    'elapsed-no-action',
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
    'elapsed-no-action',
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
  return compactNotice(`✅ ${smsMessageKind(rows)} 발송 완료`, [
    formatSmsRows(rows),
    '일정 동기화 상태와 별도로 처리됐습니다.',
  ]);
}

function smsFailureReasonText(row) {
  const reason = String(row?.sms?.reason || row?.sms?.error || row?.sms?.providerCode || '');
  if (reason === 'naver-login-required') return '네이버 로그인 세션 만료로 전화번호를 읽지 못함';
  if (reason === 'naver-reservation-not-found') return '네이버 예약 상세를 찾지 못해 전화번호를 확인하지 못함';
  if (reason === 'naver-phone-not-visible') return '네이버 예약 상세에 전화번호가 보이지 않음';
  if (reason === 'spacecloud-phone-not-visible') return '스페이스클라우드 예약 상세에 전화번호가 보이지 않음';
  if (reason === 'recipient-phone-missing') return '발송할 전화번호를 확보하지 못함';
  if (reason === 'provider-result-uncertain-no-auto-resend') return '문자 업체의 발송 결과가 불확실하여 중복 발송을 차단함';
  return cleanTelegramText(reason || '문자 후속처리 실패', 140);
}

function smsFailureMessage(rows) {
  const row = rows[0] || {};
  return compactNotice('🟡 예약 안내문자 후속처리 필요', [
    `대상: ${taskTargetText(row)}`,
    '예약 반영: DB 원장·상대 플랫폼 완료',
    `문자: ${smsFailureReasonText(row)}`,
    '영향: 일정 동기화에는 없음',
    '조치: 로그인 복구 후 자동 재시도 · 발송 결과 불확실 건은 수동 확인',
  ]);
}

function smsNotificationKey(row) {
  return `sms-delivery:${taskIdentityKey(row)}`;
}

async function notifySmsState(args, row) {
  const key = smsNotificationKey(row);
  if (smsNeedsAttention(row)) {
    if (isLoginProblem(row.sms?.reason || row.sms?.error || '')) {
      return { sent: false, reason: 'covered-by-platform-session-alert' };
    }
    if (!smsFailureShouldAlert(row)) {
      return { sent: false, reason: `automatic-retry-scheduled:${row.sms?.nextRetryAt || '-'}` };
    }
    const signature = `problem:${row.sms?.status || 'failed'}:${row.sms?.reason || row.sms?.providerCode || ''}`;
    return notifyOnStateChange(args, key, signature, smsFailureMessage([row]));
  }
  const state = await readJsonObject(args.notifyState);
  const previous = state[key] || {};
  if (!previous.lastSentAt || !String(previous.stateSignature || '').startsWith('problem:')) {
    return { sent: false, reason: 'no-prior-sms-alert' };
  }
  return notifyOnStateChange(args, key, 'healthy', smsSuccessMessage([row]));
}

function cycleErrorMessage(errorText, { transient = false } = {}) {
  return compactNotice(transient ? '🟡 서버 연결 확인 중' : '🔴 자동화 감시 중지', [
    `상태: ${transient ? '다음 주기 자동 재시도' : '자동 재시작 필요'}`,
    `자동화 기록: ${cleanTelegramText(errorText || '-', 180)}`,
    '같은 상태는 다시 알리지 않습니다.',
  ]);
}

function dbStatusForDeleteRow(row, task = null) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'deleted') return 'done';
  if (row.status === 'already-gone') return 'already_gone';
  if (row.status === 'needs-review') return 'needs_review';
  const retryStatus = retryablePlatformDbStatus(row, task);
  if (retryStatus) return retryStatus;
  return 'failed';
}

function dbStatusForUploadRow(row, task = null) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'naver-cancel-queued') return 'done';
  if (row.status === 'submitted') return 'done';
  if (row.status === 'needs-review') return 'needs_review';
  const retryStatus = retryablePlatformDbStatus(row, task);
  if (retryStatus) return retryStatus;
  return 'failed';
}

function dbStatusForNaverBlockRow(row, task = null) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (row.status === 'blocked' || row.status === 'already-blocked' || row.status === 'elapsed-no-action') return 'done';
  if (row.status === 'spacecloud-cancel-queued') return 'done';
  if (row.status === 'winner-waiting-loser-cancellation') return 'pending';
  if (row.status === 'naver-conflict' || row.status === 'later-reservation-conflict' || row.status === 'needs-review') return 'needs_review';
  const retryStatus = retryablePlatformDbStatus(row, task);
  if (retryStatus) return retryStatus;
  return 'failed';
}

function dbStatusForSpacecloudCancelRow(row, task = null) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (['canceled', 'already-canceled', 'conflict-cleared-source-requeued'].includes(row.status)) return 'done';
  if (['guard-retry-pending', 'winner-verification-pending', 'cancellation-verification-pending', 'canceled-finalization-pending', 'external-cancellation-sync-pending'].includes(row.status)) return 'pending';
  if (row.status === 'needs-review') return 'needs_review';
  const retryStatus = retryablePlatformDbStatus(row, task);
  if (retryStatus) return retryStatus;
  return 'failed';
}

function dbStatusForNaverCancelRow(row, task = null) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip') return 'done';
  if (['canceled', 'already-canceled', 'conflict-cleared-source-requeued'].includes(row.status)) return 'done';
  if (['guard-retry-pending', 'winner-verification-pending', 'cancellation-verification-pending', 'canceled-finalization-pending', 'external-cancellation-sync-pending'].includes(row.status)) return 'pending';
  if (row.status === 'needs-review') return 'needs_review';
  const retryStatus = retryablePlatformDbStatus(row, task);
  if (retryStatus) return retryStatus;
  return 'failed';
}

function dbStatusForNaverRestoreRow(row, task = null) {
  if (row.status === 'stale-running-needs-review') return 'needs_review';
  if (row.status === 'missing-ledger-needs-review') return 'needs_review';
  if (row.status === 'stale-ledger-skip' || row.status === 'restore-skipped-not-owned') return 'done';
  if (row.status === 'restore-grace-wait') return 'pending';
  if (row.status === 'restored' || row.status === 'already-available' || row.status === 'elapsed-no-action') return 'done';
  if (row.status === 'needs-review' || row.status === 'naver-conflict') return 'needs_review';
  const retryStatus = retryablePlatformDbStatus(row, task);
  if (retryStatus) return retryStatus;
  return 'failed';
}

function isRetryingPlatformRow(row) {
  return row?.dbStatus === 'pending'
    && (
      ['guard-retry-pending', 'winner-verification-pending', 'cancellation-verification-pending', 'canceled-finalization-pending', 'external-cancellation-sync-pending'].includes(row?.status)
      || row?.status === 'winner-waiting-loser-cancellation'
      || (!isLoginProblem(row.error) && isRetryablePlatformProblem(row.error))
    );
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

function classifyAdminPanelConflict(task, row, currentPlatform, overlaps) {
  if (!isAdminPanelTask(task)) return null;
  const bookings = Array.isArray(overlaps) ? overlaps : [];
  const taskType = String(task?.taskType || task?.task_type || '');

  if (taskType === 'upload' && currentPlatform === 'naver' && bookings.length === 0) {
    return {
      ...row,
      conflictPolicyDecision: 'admin-panel-clear',
      conflictPolicyReason: 'admin-panel-no-real-platform-overlap',
      overlapBookings: [],
      actionableOverlapBookings: [],
      ignoredRecordOnlyOverlapBookings: [],
      error: '',
      nextAction: 'continue-admin-panel-upload',
    };
  }

  return {
    ...row,
    status: 'needs-review',
    conflictPolicyDecision: 'admin-panel-manual-review',
    conflictPolicyReason: bookings.length
      ? 'admin-panel-real-platform-overlap'
      : 'admin-panel-platform-conflict',
    overlapBookings: bookings,
    actionableOverlapBookings: bookings,
    ignoredRecordOnlyOverlapBookings: [],
    error: bookings.length
      ? `관리자 입력 시간에 기존 실제 플랫폼 예약 ${bookings.length}건이 확인되어 자동 반영을 중단했습니다.`
      : '관리자 입력 시간에 플랫폼 충돌이 감지되어 기존 예약을 자동 취소하지 않았습니다.',
    nextAction: 'manual-review-admin-panel-conflict',
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

function sourceTaskForConflictBooking(booking) {
  const sourcePlatform = String(booking?.sourcePlatform || booking?.source_platform || '').trim();
  const sourceTaskType = sourcePlatform === 'naver' ? 'upload' : sourcePlatform === 'spacecloud' ? 'naver_block' : '';
  let sourcePayload = {};
  try {
    sourcePayload = JSON.parse(booking?.sourceTaskPayloadJson || '{}');
    if (!sourcePayload || typeof sourcePayload !== 'object' || Array.isArray(sourcePayload)) sourcePayload = {};
  } catch {
    sourcePayload = {};
  }
  const reservationId = String(booking?.spacecloudReservationId || booking?.spacecloud_reservation_id || '').trim();
  if (sourcePlatform === 'spacecloud' && reservationId) {
    sourcePayload.spacecloud_reservation_id = reservationId;
  }
  return {
    id: Number(booking?.sourceTaskId || 0),
    taskType: booking?.sourceTaskType || sourceTaskType,
    status: booking?.sourceTaskStatus || '',
    emailEventId: booking?.confirmedEmailEventId || booking?.confirmed_email_event_id || null,
    ledgerId: booking?.id || null,
    roomKey: booking?.roomKey || booking?.room_key || '',
    reservationNo: booking?.reservationNumber || booking?.reservation_number || reservationId,
    reserverName: booking?.reserverName || booking?.reserver_name || '',
    product: booking?.product || '',
    date: booking?.date || booking?.reservation_date || '',
    startTime: booking?.startTime || booking?.start_time || '',
    endTime: booking?.endTime || booking?.end_time || '',
    payloadJson: JSON.stringify(sourcePayload),
  };
}

async function queueStrictLaterBookingCancellation(args, winner, loser) {
  const sourceTask = sourceTaskForConflictBooking(loser);
  const expectedSourceTaskType = loser?.sourcePlatform === 'naver' ? 'upload' : 'naver_block';
  if (!Number.isSafeInteger(sourceTask.id) || sourceTask.id <= 0) {
    throw new Error(`losing booking source task missing: ledger=${loser?.id || ''}`);
  }
  if (sourceTask.taskType !== expectedSourceTaskType) {
    throw new Error(`losing booking source task type mismatch: expected=${expectedSourceTaskType} actual=${sourceTask.taskType || ''}`);
  }
  if (String(sourceTask.emailEventId || '') !== String(loser?.confirmedEmailEventId || '')) {
    throw new Error(`losing booking email identity mismatch: ledger=${loser?.id || ''}`);
  }
  const conflictRow = {
    priorityRule: CANCELLATION_PRIORITY_RULE,
    winningBooking: winner,
    losingBooking: loser,
  };
  const queued = loser.sourcePlatform === 'naver'
    ? await createRemoteNaverCancelTask(args, sourceTask, conflictRow)
    : await createRemoteSpacecloudCancelTask(args, sourceTask, conflictRow);
  return {
    ...queued,
    taskType: loser.sourcePlatform === 'naver' ? 'naver_cancel' : 'spacecloud_cancel',
    winnerLedgerId: winner.id,
    loserLedgerId: loser.id,
    sourceTaskId: sourceTask.id,
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

def parse_json(value):
    try:
        parsed = json.loads(value or '{}')
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}

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
                confirmed_email_event_id AS confirmedEmailEventId,
                CAST(confirmed_email_received_at AS CHAR) AS confirmedAt,
                CAST(last_event_at AS CHAR) AS lastEventAt,
                CAST(created_at AS CHAR) AS createdAt,
                payload_json AS ledgerPayloadJson
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
              COALESCE(confirmed_email_received_at, '9999-12-31 23:59:59') ASC,
              id ASC
            """,
            (
                payload.get('roomKey') or '',
                target_end_at,
                target_start_at,
            ),
        )
        overlaps = cur.fetchall()
        for booking in overlaps:
            ledger_payload = parse_json(booking.get('ledgerPayloadJson'))
            booking['spacecloudReservationId'] = (
                ledger_payload.get('spacecloud_reservation_id')
                or ledger_payload.get('spacecloudReservationId')
                or ''
            )
            source_task_type = 'upload' if booking.get('sourcePlatform') == 'naver' else 'naver_block'
            cur.execute(
                """
                SELECT id, task_type, status
                FROM rhythmjoy_spacecloud_tasks
                WHERE email_event_id=%s AND task_type=%s
                ORDER BY id ASC
                LIMIT 1
                """,
                (booking.get('confirmedEmailEventId'), source_task_type),
            )
            source_task = cur.fetchone() or {}
            booking['sourceTaskId'] = source_task.get('id')
            booking['sourceTaskType'] = source_task.get('task_type') or source_task_type
            booking['sourceTaskStatus'] = source_task.get('status') or ''
            booking.pop('ledgerPayloadJson', None)
    print(json.dumps({
        'overlaps': overlaps,
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
      status: 'needs-review',
      error: `예약 충돌 순서 검증 실패: ${String(error?.message || error)}`,
      nextAction: 'manual-review-conflict-classification-failed',
      conflictClassificationError: String(error?.message || error),
    };
  }

  const adminClassification = classifyAdminPanelConflict(
    task,
    row,
    currentPlatform,
    classification.overlaps || [],
  );
  if (adminClassification) return adminClassification;

  const policy = assessLaterReservationConflict({
    overlaps: classification.overlaps || [],
    currentLedgerId: task.ledgerId || task.ledger_id,
    currentPlatform,
  });
  const cancellationPair = cancellationPairForConflict(policy);
  if (policy.decision === 'invalid' || policy.decision === 'ambiguous') {
    return {
      ...row,
      status: 'needs-review',
      priorityRule: CANCELLATION_PRIORITY_RULE,
      overlapBookings: classification.overlaps || [],
      actionableOverlapBookings: policy.ordered || [],
      ignoredRecordOnlyOverlapBookings: policy.unknownPriorityBookings || [],
      conflictPolicyDecision: policy.decision,
      conflictPolicyReason: policy.reason,
      error: `예약 충돌 자동판정 중단: ${policy.reason}`,
      nextAction: 'manual-review-ambiguous-booking-priority',
    };
  }

  if (policy.decision === 'later') {
    const winner = cancellationPair?.winner || null;
    const current = cancellationPair?.loser || null;
    if (!winner || !current) {
      return {
        ...row,
        status: 'needs-review',
        priorityRule: CANCELLATION_PRIORITY_RULE,
        conflictPolicyDecision: policy.decision,
        conflictPolicyReason: 'strict-cancellation-pair-missing',
        error: '후예약 충돌 판정은 났지만 안전한 취소 쌍을 만들 수 없습니다.',
        nextAction: 'manual-review-strict-cancellation-pair-missing',
      };
    }
    let cancellationTask;
    try {
      cancellationTask = await queueStrictLaterBookingCancellation(args, winner, current);
    } catch (error) {
      return {
        ...row,
        status: 'needs-review',
        priorityRule: CANCELLATION_PRIORITY_RULE,
        winningBooking: winner,
        losingBooking: current,
        overlapBookings: classification.overlaps || [],
        actionableOverlapBookings: policy.ordered || [],
        conflictPolicyDecision: policy.decision,
        conflictPolicyReason: policy.reason,
        error: `후예약 취소 작업 생성 실패: ${String(error?.message || error)}`,
        nextAction: 'manual-review-cancel-task-queue-failed',
      };
    }
    return {
      ...row,
      status: currentPlatform === 'naver' ? 'naver-cancel-queued' : 'spacecloud-cancel-queued',
      originalStatus: row.status || '',
      priorityRule: CANCELLATION_PRIORITY_RULE,
      winningBooking: winner,
      losingBooking: current,
      cancellationTask,
      overlapBookings: classification.overlaps || [],
      actionableOverlapBookings: policy.ordered || [],
      ignoredRecordOnlyOverlapBookings: [],
      error: '',
      nextAction: 'cancel-later-reservation-after-strict-recheck',
    };
  }

  if (policy.decision === 'winner' && cancellationPair) {
    const winner = cancellationPair.winner;
    const loser = cancellationPair.loser;
    let cancellationTask;
    try {
      cancellationTask = await queueStrictLaterBookingCancellation(args, winner, loser);
    } catch (error) {
      return {
        ...row,
        status: 'needs-review',
        priorityRule: CANCELLATION_PRIORITY_RULE,
        winningBooking: winner,
        losingBooking: loser,
        overlapBookings: classification.overlaps || [],
        actionableOverlapBookings: policy.ordered || [],
        conflictPolicyDecision: policy.decision,
        conflictPolicyReason: policy.reason,
        error: `역순 유입 후예약 취소 작업 생성 실패: ${String(error?.message || error)}`,
        nextAction: 'manual-review-reversed-arrival-cancel-task-queue-failed',
      };
    }
    return {
      ...row,
      status: currentPlatform === 'spacecloud' ? 'winner-waiting-loser-cancellation' : row.status,
      originalStatus: row.status || '',
      priorityRule: CANCELLATION_PRIORITY_RULE,
      winningBooking: winner,
      losingBooking: loser,
      cancellationTask,
      overlapBookings: classification.overlaps || [],
      actionableOverlapBookings: policy.ordered || [],
      ignoredRecordOnlyOverlapBookings: [],
      conflictPolicyDecision: policy.decision,
      conflictPolicyReason: policy.reason,
      error: currentPlatform === 'spacecloud'
        ? '선예약은 유지하고 네이버 후예약 취소 완료 후 예약불가 반영을 다시 확인합니다.'
        : '',
      nextAction: currentPlatform === 'spacecloud'
        ? 'retry-winner-block-after-loser-cancellation'
        : 'continue-winner-upload-while-loser-cancellation-is-guarded',
    };
  }

  return {
    ...row,
    priorityRule: CANCELLATION_PRIORITY_RULE,
    conflictPolicyDecision: policy.decision,
    conflictPolicyReason: policy.reason,
    overlapBookings: classification.overlaps || [],
    actionableOverlapBookings: policy.ordered || [],
    ignoredRecordOnlyOverlapBookings: [],
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
    return recordRemoteSmsPhoneLookupFailure(args, {
      task,
      reason: lookup.reason || lookup.status || 'naver-phone-lookup-failed',
      source: lookup.source || 'naver',
    });
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
    return recordRemoteSmsPhoneLookupFailure(args, {
      task,
      reason: lookup.reason || lookup.status || 'spacecloud-phone-lookup-failed',
      source: lookup.source || 'spacecloud',
    });
  }
  return sendRemoteConfirmationSms(args, {
    task,
    phone: lookup.phone,
    source: lookup.source || 'spacecloud',
  });
}

async function fetchRemoteSmsPhoneLookupFollowUps(args) {
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

load_env(os.environ['RHYTHMJOY_ENV_FILE'])
conn = pymysql.connect(
    host=os.environ['DB_SERVERNAME'], port=int(os.environ.get('DB_PORT', '3306')),
    user=os.environ['DB_USERNAME'], password=os.environ['DB_PASSWORD'],
    database=os.environ['DB_NAME'], charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        for column, definition in (
            ('attempt_count', 'INT UNSIGNED NOT NULL DEFAULT 0'),
            ('first_failed_at', 'DATETIME NULL'),
            ('last_attempt_at', 'DATETIME NULL'),
            ('next_retry_at', 'DATETIME NULL'),
        ):
            cur.execute('SHOW COLUMNS FROM rhythmjoy_sms_deliveries LIKE %s', (column,))
            if cur.fetchone() is None:
                cur.execute(f'ALTER TABLE rhythmjoy_sms_deliveries ADD COLUMN {column} {definition}')
        cur.execute("SHOW COLUMNS FROM rhythmjoy_spacecloud_tasks LIKE 'confirmation_sms_required'")
        if cur.fetchone() is None:
            cur.execute(
                'ALTER TABLE rhythmjoy_spacecloud_tasks '
                'ADD COLUMN confirmation_sms_required TINYINT(1) NOT NULL DEFAULT 0 AFTER claim_token'
            )
        # Double-check the transactional outbox invariant. New reservation tasks
        # declare the obligation on the task row; if an outbox row is ever lost,
        # the watcher recreates it before looking for work.
        cur.execute("""
            INSERT IGNORE INTO rhythmjoy_sms_deliveries (
              idempotency_key, source_task_type, source_task_id, template_name,
              recipient_phone_hash, recipient_phone_last4, status,
              attempt_count, created_at, updated_at
            )
            SELECT
              CONCAT('reservation-confirmed-v1|', t.task_type, '|', t.id),
              t.task_type, t.id, 'reservation-confirmed-v1',
              '', '', 'pending', 0, NOW(), NOW()
            FROM rhythmjoy_spacecloud_tasks t
            WHERE t.confirmation_sms_required=1
              AND t.task_type IN ('upload','naver_block')
        """)
        conn.commit()
        cur.execute("""
            SELECT
              d.id AS deliveryId,
              d.attempt_count AS attemptCount,
              CAST(d.next_retry_at AS CHAR) AS nextRetryAt,
              t.id, t.id AS taskId, t.task_type AS taskType,
              t.room_key AS roomKey, CAST(t.reservation_date AS CHAR) AS date,
              TIME_FORMAT(t.start_time, '%H:%i') AS startTime,
              TIME_FORMAT(t.end_time, '%H:%i') AS endTime,
              t.reservation_number AS reservationNo, t.reserver_name AS reserverName,
              t.product, t.payload_json AS payloadJson
            FROM rhythmjoy_sms_deliveries d
            INNER JOIN rhythmjoy_spacecloud_tasks t
              ON t.id=d.source_task_id AND t.task_type=d.source_task_type
            WHERE d.status IN ('pending','phone_lookup_failed','failed')
              AND d.template_name='reservation-confirmed-v1'
              AND (
                    d.status='pending'
                 OR COALESCE(d.next_retry_at, DATE_ADD(d.updated_at, INTERVAL 5 MINUTE)) <= NOW()
                  )
              AND t.status IN ('done','already_gone')
              AND t.task_type IN ('upload','naver_block')
            ORDER BY d.updated_at ASC, d.id ASC
            LIMIT 10
        """)
        rows = cur.fetchall()
finally:
    conn.close()
print(json.dumps(rows, ensure_ascii=False, default=str))
PY
`;
  return JSON.parse(runSshScript(target, script).trim() || '[]');
}

async function runSmsPhoneLookupFollowUps(args, context, sessionStatuses = []) {
  if (args.dryRun) {
    return {
      status: 'sms-follow-up-dry-run', fetched: 0, attempted: 0, rows: [], failed: [],
    };
  }
  const candidates = await fetchRemoteSmsPhoneLookupFollowUps(args);
  const task = candidates.find((row) => !platformSessionBlocked(
    sessionStatuses,
    row.taskType === 'upload' ? 'naver' : 'spacecloud',
  ));
  if (!task) {
    return {
      status: candidates.length ? 'sms-follow-up-session-blocked' : 'no-sms-follow-ups',
      fetched: candidates.length,
      attempted: 0,
      rows: [],
      failed: [],
    };
  }
  let sms;
  try {
    sms = task.taskType === 'upload'
      ? await sendNaverOriginConfirmationSms(args, context, task)
      : await sendSpacecloudOriginConfirmationSms(args, context, task);
  } catch (error) {
    sms = await recordRemoteSmsPhoneLookupFailure(args, {
      task,
      reason: `sms-follow-up-exception:${String(error?.message || error)}`,
      source: task.taskType === 'upload' ? 'naver' : 'spacecloud',
    });
  }
  const row = {
    ...task,
    status: 'sms-follow-up',
    sms,
  };
  return {
    status: smsSendOk(sms.status) ? 'sms-follow-up-sent' : 'sms-follow-up-pending',
    fetched: candidates.length,
    attempted: 1,
    rows: [row],
    failed: [],
  };
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

function smsFailureShouldAlert(row) {
  const status = String(row?.sms?.status || '');
  if (['needs_review', 'uncertain', 'delivery_in_progress'].includes(status)) return true;
  if (['phone_lookup_failed', 'failed', 'skipped'].includes(status)) {
    return Number(row?.sms?.attemptCount || 0) >= 3;
  }
  return true;
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
            const classifiedRow = await classifyUploadConflict(args, task, row);
            row = classifiedRow;
            if (!['needs-review', 'naver-cancel-queued'].includes(row.status)) {
              const conflictContext = row.cancellationTask ? {
                priorityRule: row.priorityRule,
                conflictPolicyDecision: row.conflictPolicyDecision,
                conflictPolicyReason: row.conflictPolicyReason,
                winningBooking: row.winningBooking,
                losingBooking: row.losingBooking,
                cancellationTask: row.cancellationTask,
                nextAction: row.nextAction,
              } : null;
              row = await uploadSpacecloudDirectReservation(activeContext, event);
              if (conflictContext) Object.assign(row, conflictContext);
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
      const status = dbStatusForUploadRow(row, task);
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
      const status = dbStatusForDeleteRow(row, task);
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
      const status = dbStatusForNaverBlockRow(row, task);
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
    'elapsed-no-action',
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

function cancellationTaskType(platform) {
  return platform === 'naver' ? 'naver_cancel' : 'spacecloud_cancel';
}

function cancellationAttemptCount(task) {
  const value = Number(task?.attempts ?? task?.staleAttempts ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function cancellationHoldRow(task, platform, pendingStatus, reason, extra = {}) {
  const attempts = cancellationAttemptCount(task);
  const retry = attempts < CANCELLATION_GUARD_MAX_ATTEMPTS;
  return {
    ...basicTaskSummary(task),
    taskType: cancellationTaskType(platform),
    status: retry ? pendingStatus : 'needs-review',
    attempts,
    maxAutomaticAttempts: CANCELLATION_GUARD_MAX_ATTEMPTS,
    reason,
    error: reason,
    ...extra,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

async function inspectCancellationTargetLive(context, task, platform, args) {
  if (platform === 'naver') {
    const result = await inspectNaverReservationStatus(context, task, {
      businessId: args.naverBusinessId,
    });
    return {
      platform,
      confirmed: result.status === '확정',
      canceled: result.status === '취소',
      status: result.status || 'unknown',
      reservationNo: result.reservationNo || '',
      source: result.source || '',
      reason: result.reason || '',
    };
  }
  const result = await inspectSpacecloudConfirmedReservation(context, task);
  return {
    platform,
    confirmed: result.confirmed === true,
    canceled: result.status === 'canceled',
    status: result.status || 'unknown',
    statusCode: result.statusCode || '',
    reservationId: result.reservationId || '',
    verification: result.verification || null,
    reason: result.reason || '',
  };
}

async function fetchCancellationPhone(context, task, platform, args) {
  if (platform === 'naver') {
    return fetchNaverReservationPhone(context, task, { businessId: args.naverBusinessId });
  }
  return fetchSpacecloudReservationPhone(context, task);
}

async function attachPriorBookingCancellationSms(args, task, row, platform) {
  row.smsPreview = priorBookingCancelSmsMessage(task);
  if (!shouldSendPriorBookingCancellationSms(task, row)) return row;
  try {
    row.sms = await sendPriorBookingCancellationSms(args, {
      task: {
        ...task,
        taskType: cancellationTaskType(platform),
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
  return row;
}

async function finishConflictClearedCancellation(args, task, platform, guard) {
  const summary = conflictGuardSummary(guard);
  try {
    const requeue = await requeueRemoteConflictSource(args, task, guard);
    if (requeue.sourceUpdated !== 1 || requeue.loserStatus !== 'confirmed') {
      throw new Error(`source requeue invariant failed: ${JSON.stringify(requeue)}`);
    }
    return {
      ...basicTaskSummary(task),
      taskType: cancellationTaskType(platform),
      status: 'conflict-cleared-source-requeued',
      reason: 'queued winner is no longer the strict live winner; cancellation skipped and source task requeued',
      cancellationGuard: summary,
      requeue,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    return cancellationHoldRow(
      task,
      platform,
      'guard-retry-pending',
      `conflict changed but source task could not be requeued safely: ${String(error?.message || error)}`,
      { cancellationGuard: summary },
    );
  }
}

async function finalizeProvenCancellation(args, task, row, platform, guard) {
  try {
    const finalization = await finalizeRemoteCancellationSuccess(args, task, guard, row);
    if (finalization.sourceUpdated !== 1 || finalization.ledgerStatus !== 'canceled') {
      throw new Error(`cancellation finalization invariant failed: ${JSON.stringify(finalization)}`);
    }
    row.dbFinalization = finalization;
  } catch (error) {
    row.platformStatus = row.status;
    row.status = cancellationAttemptCount(task) < CANCELLATION_GUARD_MAX_ATTEMPTS
      ? 'canceled-finalization-pending'
      : 'needs-review';
    row.error = `platform cancellation is confirmed but DB finalization failed: ${String(error?.message || error)}`;
    row.finishedAt = new Date().toISOString();
    return row;
  }
  return attachPriorBookingCancellationSms(args, task, row, platform);
}

async function recoverPreviouslySubmittedCancellation(args, context, task, platform, guard, knownLiveTarget = null) {
  const guardSummary = conflictGuardSummary(guard);
  let liveTarget = knownLiveTarget;
  try {
    if (!liveTarget) liveTarget = await inspectCancellationTargetLive(context, task, platform, args);
  } catch (error) {
    return cancellationHoldRow(
      task,
      platform,
      'cancellation-verification-pending',
      `could not verify previously submitted cancellation: ${String(error?.message || error)}`,
      { cancellationGuard: guardSummary },
    );
  }
  if (!liveTarget.canceled) {
    return cancellationHoldRow(
      task,
      platform,
      'cancellation-verification-pending',
      liveTarget.confirmed
        ? 'DB says canceled after a submit checkpoint, but the exact platform reservation is still confirmed; no repeat click allowed'
        : `previously submitted cancellation has no exact canceled platform match: ${liveTarget.reason || liveTarget.status}`,
      { cancellationGuard: guardSummary, liveTarget },
    );
  }

  let phoneLookup;
  try {
    phoneLookup = await fetchCancellationPhone(context, task, platform, args);
  } catch (error) {
    return cancellationHoldRow(
      task,
      platform,
      'cancellation-verification-pending',
      `canceled reservation phone lookup failed during recovery: ${String(error?.message || error)}`,
      { cancellationGuard: guardSummary, liveTarget },
    );
  }
  if (phoneLookup.status !== 'found' || !/^01[016789]\d{7,8}$/.test(phoneLookup.phone || '')) {
    return cancellationHoldRow(
      task,
      platform,
      'cancellation-verification-pending',
      `canceled reservation phone is not verifiable during recovery: ${phoneLookup.reason || phoneLookup.status}`,
      { cancellationGuard: guardSummary, liveTarget, maskedPhone: phoneLookup.maskedPhone || '' },
    );
  }

  const row = {
    ...basicTaskSummary(task),
    taskType: cancellationTaskType(platform),
    status: 'already-canceled',
    submissionAttempted: true,
    submissionConfirmed: true,
    recoveredAfterSubmitCheckpoint: true,
    maskedPhone: phoneLookup.maskedPhone || '',
    cancellationGuard: guardSummary,
    liveTarget,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  Object.defineProperty(row, 'phone', { value: phoneLookup.phone, enumerable: false });
  return finalizeProvenCancellation(args, task, row, platform, guard);
}

async function runGuardedCustomerCancellation(args, context, task, platform) {
  const taskType = cancellationTaskType(platform);
  const ledgerIssue = ledgerIssueForTask(task, taskType);
  if (ledgerIssue && ledgerIssue !== 'already-canceled') return ledgerIssueRow(task, taskType, ledgerIssue);

  let guard;
  try {
    guard = await verifyRemoteCancellationGuard(args, task);
  } catch (error) {
    return cancellationHoldRow(
      task,
      platform,
      'guard-retry-pending',
      `cancellation DB guard could not be read: ${String(error?.message || error)}`,
    );
  }
  const guardSummary = conflictGuardSummary(guard);

  if (guard.decision === 'already-canceled') {
    if (taskPriorCancellationAttempted(task)) {
      return recoverPreviouslySubmittedCancellation(args, context, task, platform, guard);
    }
    return {
      ...ledgerIssueRow(task, taskType, 'already-canceled'),
      cancellationGuard: guardSummary,
      reason: 'ledger is already canceled and no automation submit checkpoint exists; no click and no cancellation SMS',
    };
  }
  if (guard.decision === 'conflict-cleared') {
    if (taskPriorCancellationAttempted(task)) {
      let liveTarget;
      try {
        liveTarget = await inspectCancellationTargetLive(context, task, platform, args);
      } catch (error) {
        return cancellationHoldRow(
          task,
          platform,
          'cancellation-verification-pending',
          `conflict changed after a submit checkpoint and target verification failed: ${String(error?.message || error)}`,
          { cancellationGuard: guardSummary },
        );
      }
      if (liveTarget.canceled) {
        return recoverPreviouslySubmittedCancellation(args, context, task, platform, guard, liveTarget);
      }
      if (!liveTarget.confirmed) {
        return cancellationHoldRow(
          task,
          platform,
          'cancellation-verification-pending',
          `conflict changed after a submit checkpoint and target state is ambiguous: ${liveTarget.reason || liveTarget.status}`,
          { cancellationGuard: guardSummary, liveTarget },
        );
      }
    }
    return finishConflictClearedCancellation(args, task, platform, guard);
  }
  if (guard.approved !== true) {
    return {
      ...basicTaskSummary(task),
      taskType,
      status: 'needs-review',
      reason: `cancellation guard rejected the queued task: ${guard.reason || 'not-approved'}`,
      error: `cancellation guard rejected the queued task: ${guard.reason || 'not-approved'}`,
      cancellationGuard: guardSummary,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  let liveWinner;
  try {
    liveWinner = await verifyWinningBookingLive(context, guard, args);
  } catch (error) {
    return cancellationHoldRow(
      task,
      platform,
      'winner-verification-pending',
      `winning reservation live verification failed: ${String(error?.message || error)}`,
      { cancellationGuard: guardSummary },
    );
  }
  if (liveWinner.confirmed !== true) {
    return cancellationHoldRow(
      task,
      platform,
      'winner-verification-pending',
      `winning reservation is not exactly confirmed on its platform: ${liveWinner.reason || liveWinner.status}`,
      { cancellationGuard: guardSummary, liveWinner },
    );
  }

  let finalGuard = guard;
  const beforeConfirm = async () => {
    try {
      finalGuard = await verifyRemoteCancellationGuard(args, task);
      const summary = conflictGuardSummary(finalGuard);
      if (finalGuard.approved !== true) {
        return {
          approved: false,
          retryable: false,
          reason: finalGuard.reason || finalGuard.decision || 'not-approved',
          summary,
        };
      }
      await updateRemoteTask(args, task, 'running', JSON.stringify({
        ...basicTaskSummary(task),
        status: 'cancel-submit-checkpoint',
        submissionAttempted: true,
        priorityRule: CANCELLATION_PRIORITY_RULE,
        cancellationGuard: summary,
        liveWinner,
        checkpointAt: new Date().toISOString(),
      }, null, 2), { releaseClaim: false });
      return { approved: true, summary };
    } catch (error) {
      return {
        approved: false,
        retryable: true,
        reason: `final cancellation guard failed: ${String(error?.message || error)}`,
        summary: conflictGuardSummary(finalGuard),
      };
    }
  };

  let row;
  if (platform === 'naver') {
    row = await cancelNaverConfirmedReservation(context, task, {
      businessId: args.naverBusinessId,
      beforeConfirm,
    });
  } else {
    row = await cancelSpacecloudConfirmedReservation(context, task, { beforeConfirm });
  }
  row.preflightCancellationGuard = guardSummary;
  row.liveWinner = liveWinner;

  if (finalGuard.decision === 'conflict-cleared' && row.submissionAttempted !== true) {
    return finishConflictClearedCancellation(args, task, platform, finalGuard);
  }
  if (finalGuard.decision === 'already-canceled' && row.submissionAttempted !== true) {
    return {
      ...ledgerIssueRow(task, taskType, 'already-canceled'),
      cancellationGuard: conflictGuardSummary(finalGuard),
      reason: 'losing ledger became canceled before final confirm; no click and no automation cancellation SMS',
    };
  }
  if (row.status === 'guard-retry-pending') return row;
  if (row.submissionAttempted === true && !['canceled', 'already-canceled'].includes(row.status)) {
    row.platformStatus = row.status;
    row.status = cancellationAttemptCount(task) < CANCELLATION_GUARD_MAX_ATTEMPTS
      ? 'cancellation-verification-pending'
      : 'needs-review';
    row.error = `cancellation submit result is not yet exact; retry will verify platform state first: ${row.error || row.platformStatus}`;
    return row;
  }
  if (row.status === 'canceled' && row.submissionAttempted === true) {
    return finalizeProvenCancellation(args, task, row, platform, finalGuard);
  }
  if (row.status === 'already-canceled' && taskPriorCancellationAttempted(task)) {
    return finalizeProvenCancellation(args, task, row, platform, finalGuard);
  }
  if (row.status === 'already-canceled') {
    return cancellationHoldRow(
      task,
      platform,
      'external-cancellation-sync-pending',
      'the exact platform reservation was already canceled before this automation reached submit; waiting for cancellation email/ledger sync and not sending an automation cancellation SMS',
      { liveWinner, preflightCancellationGuard: guardSummary },
    );
  }
  return row;
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
  if (!customerReservationCancellationEnabled()) {
    return {
      status: 'spacecloud-cancel-disabled-wait',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
      retrying: [],
      reason: 'customer reservation cancellation emergency stop is active; pending tasks were left unclaimed',
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
        row = await runGuardedCustomerCancellation(args, activeContext, task, 'spacecloud');
      }

      rows.push(row);
      const status = dbStatusForSpacecloudCancelRow(row, task);
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
    'conflict-cleared-source-requeued',
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
  if (!customerReservationCancellationEnabled()) {
    return {
      status: 'naver-cancel-disabled-wait',
      fetched: 0,
      attempted: 0,
      rows: [],
      failed: [],
      retrying: [],
      reason: 'customer reservation cancellation emergency stop is active; pending tasks were left unclaimed',
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
        row = await runGuardedCustomerCancellation(args, activeContext, task, 'naver');
      }

      rows.push(row);
      const status = dbStatusForNaverCancelRow(row, task);
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
    'conflict-cleared-source-requeued',
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
        ? dbStatusForNaverRestoreRow(row, task)
        : dbStatusForNaverBlockRow(row, task);
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
        'elapsed-no-action',
        'restore-grace-wait',
        'stale-ledger-skip',
      ]
      : [
        'blocked',
        'already-blocked',
        'elapsed-no-action',
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
  const spacecloudUrl = 'https://partner.spacecloud.kr/reservation-calendar?product=108674&space=66056';
  const naverUrl = `https://partner.booking.naver.com/bizes/${args.naverBusinessId}/booking-calendar-view`;
  await page.goto(spacecloudUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  logLine(`Chrome profile opened: ${args.profileDir}`);
  logLine('Log in to SpaceCloud first. Naver opens automatically after the SpaceCloud calendar is verified.');

  const deadline = Date.now() + 30 * 60 * 1000;
  let lastUrl = '';
  let platform = 'spacecloud';
  let postLoginNavigateAttempted = false;
  const sessions = [];
  while (Date.now() < deadline) {
    const currentUrl = page.url();
    const spacecloudReady = platform === 'spacecloud'
      && /^https:\/\/partner\.spacecloud\.kr\/reservation-calendar(?:[/?#]|$)/.test(currentUrl)
      && await page.locator('a._additionalReserveLayerOpen').filter({ visible: true }).count().catch(() => 0) === 1;
    if (spacecloudReady) {
      sessions.push({
        platform: 'spacecloud',
        ok: true,
        url: currentUrl,
        title: await page.title().catch(() => ''),
      });
      logLine('SpaceCloud login verified. Opening Naver SmartPlace login/calendar.');
      platform = 'naver';
      lastUrl = '';
      postLoginNavigateAttempted = false;
      await page.goto(naverUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      continue;
    }

    const naverReady = platform === 'naver'
      && /^https:\/\/partner\.booking\.naver\.com\/bizes\/[^/]+\/booking-calendar-view(?:[/?#]|$)/.test(currentUrl)
      && await page.locator('button[class*="Select__btn-selected"]').filter({ visible: true }).count().catch(() => 0) >= 1;
    if (naverReady) {
      sessions.push({
        platform: 'naver',
        ok: true,
        url: currentUrl,
        title: await page.title().catch(() => ''),
      });
      const result = {
        ok: true,
        sessions,
        profileDir: args.profileDir,
        reason: '',
      };
      logLine('SpaceCloud and Naver login checks both passed; closing the profile cleanly.');
      await context.close();
      return result;
    }

    // Do not navigate while the user is inside the Naver/SpaceCloud auth flow.
    // Restarting these URLs can invalidate the active OAuth token and force a new login page.
    const isAuthFlow = /nid\.naver\.com|partner\.spacecloud\.kr\/auth\//.test(currentUrl);
    const expectedPlatformHost = platform === 'spacecloud'
      ? /partner\.spacecloud\.kr/.test(currentUrl)
      : /(?:nid|partner\.booking)\.naver\.com/.test(currentUrl);
    const expectedCalendar = platform === 'spacecloud'
      ? /partner\.spacecloud\.kr\/reservation-calendar/.test(currentUrl)
      : /partner\.booking\.naver\.com\/bizes\/[^/]+\/booking-calendar-view/.test(currentUrl);
    if (
      !postLoginNavigateAttempted
      && !isAuthFlow
      && expectedPlatformHost
      && !expectedCalendar
    ) {
      postLoginNavigateAttempted = true;
      await page.goto(platform === 'spacecloud' ? spacecloudUrl : naverUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => {});
    }
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      logLine(`waiting for ${platform} login: ${currentUrl}`);
    }
    await sleep(5000);
  }

  await context.close();
  throw new Error(`login check timed out after 30 minutes while waiting for ${platform}`);
}

async function runCheckSessions(args) {
  const context = await openSpacecloudContext({
    profileDir: args.profileDir,
    headless: args.headless,
  });
  try {
    const spacecloud = await checkSpacecloudLogin(context);
    const naver = await checkNaverSmartplaceLogin(context, {
      businessId: args.naverBusinessId,
    });
    return {
      ok: Boolean(spacecloud.ok && naver.ok),
      sessions: [
        { platform: 'spacecloud', ...spacecloud },
        { platform: 'naver', ...naver },
      ],
    };
  } finally {
    await context.close();
  }
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

async function runNowModeSelfTest() {
  assert.equal(parseArgs(['node', 'tools/spacecloud-watch.mjs', 'watch']).customerPlatformAudit, false);
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
    '--customer-platform-audit',
  ]);
  assert.equal(parsed.nowMode, true);
  assert.equal(parsed.urgentWindowMinutes, 180);
  assert.equal(parsed.urgentIntervalSeconds, 15);
  assert.equal(parsed.urgentCooldownSeconds, 300);
  assert.equal(parsed.restoreGraceSeconds, 45);
  assert.equal(parsed.sessionCheckIntervalSeconds, 180);
  assert.equal(parsed.adminPlatformAudit, true);
  assert.equal(parsed.adminPlatformAuditIntervalMinutes, 30);
  assert.equal(parsed.adminPlatformAuditLimit, 2);
  assert.equal(parsed.customerPlatformAudit, true);
  assert.equal(parsed.customerPlatformAuditIntervalMinutes, 240);
  assert.equal(parsed.customerPlatformAuditLimit, 1);
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
  assert.match(
    REMOTE_TASK_ENRICHMENT_PY,
    /payload\.get\('ledger_key'\).*importer\.booking_ledger_key/,
    'admin tasks must prefer the exact ledger key supplied by the PHP transaction',
  );
  assert.match(
    REMOTE_TASK_ENRICHMENT_PY,
    /normalize_reserver_name_for_match\(payload\.get\('name'\)\)\.lower\(\)/,
    'older admin tasks must retry the PHP-compatible case-normalized ledger key',
  );
  assert.deepEqual(adminTaskFields({
    payloadJson: JSON.stringify({ source: 'admin-panel', admin_reservation_id: 41, admin_series_id: 9 }),
  }), {
    adminPanelTask: true,
    adminReservationId: 41,
    adminSeriesId: 9,
  });
  const adminUploadTask = {
    taskType: 'upload',
    payloadJson: JSON.stringify({ source: 'admin-panel', admin_reservation_id: 41 }),
  };
  assert.equal(
    classifyAdminPanelConflict(adminUploadTask, { status: 'upload-pending' }, 'naver', []).status,
    'upload-pending',
    'an admin upload without a real-platform overlap must continue to the uploader',
  );
  const guardedAdminUpload = classifyAdminPanelConflict(
    adminUploadTask,
    { status: 'upload-pending' },
    'naver',
    [{ id: 92, sourcePlatform: 'spacecloud' }],
  );
  assert.equal(guardedAdminUpload.status, 'needs-review');
  assert.equal(guardedAdminUpload.conflictPolicyReason, 'admin-panel-real-platform-overlap');
  assert.equal(
    classifyAdminPanelConflict({ taskType: 'upload', payloadJson: '{}' }, { status: 'upload-pending' }, 'naver', []),
    null,
    'email-origin tasks must keep the strict confirmed-email conflict policy',
  );
  assert.equal(syncSuccessRowsFromCycle({
    uploadTasks: { rows: [{
      taskId: 501,
      taskType: 'upload',
      status: 'submitted',
      adminPanelTask: true,
      adminSeriesId: 9,
    }] },
  }).length, 0, 'bulk admin success rows must not create one Telegram message per occurrence');
  assert.deepEqual(
    classifyAdminPlatformInspection({ taskType: 'upload' }, { status: 'identity-matched' }),
    { ok: true, status: 'ok', reason: '스페이스클라우드 예약 일치' },
  );
  assert.equal(
    classifyAdminPlatformInspection({ taskType: 'upload' }, { status: 'absent' }).status,
    'mismatch',
  );
  assert.equal(
    classifyAdminPlatformInspection({ taskType: 'naver_restore' }, { status: 'ok', slots: [] }).status,
    'check_failed',
  );
  assert.equal(
    classifyAdminPlatformInspection({ taskType: 'naver_restore' }, { status: 'ok', slots: [{ status: 'available' }] }).ok,
    true,
  );
  const selectedAdminAudits = selectAdminPlatformAuditReservations([
    { adminReservationId: 1, date: '2026-08-12' },
    { adminReservationId: 2, date: '2026-08-13' },
    { adminReservationId: 3, date: '2026-08-14' },
  ], {
    reservations: {
      1: { checkedAt: '2026-08-10T01:00:00Z' },
      2: { checkedAt: '2026-08-10T02:00:00Z' },
    },
  }, 2);
  assert.deepEqual(selectedAdminAudits.map((row) => row.adminReservationId), [3, 1]);
  const recheckAdminAudits = selectAdminPlatformAuditReservations([
    { adminReservationId: 1, date: '2026-08-12' },
    { adminReservationId: 2, date: '2026-08-13' },
  ], {
    reservations: {
      1: { checkedAt: '2026-08-10T01:00:00Z' },
      2: { checkedAt: '2026-08-10T02:00:00Z', auditStatus: 'recheck_pending' },
    },
  }, 1);
  assert.deepEqual(recheckAdminAudits.map((row) => row.adminReservationId), [2]);
  const failedPlatformRead = [{ classification: { ok: false, status: 'check_failed' } }];
  assert.equal(platformAuditStatusForRows(failedPlatformRead, '').auditStatus, 'recheck_pending');
  assert.equal(platformAuditStatusForRows(failedPlatformRead, 'recheck_pending').auditStatus, 'check_failed');
  assert.equal(
    adminPlatformAuditIntervalMs({ adminPlatformAuditIntervalMinutes: 30 }, {
      reservations: { 2: { auditStatus: 'recheck_pending' } },
    }),
    3 * 60 * 1000,
  );
  const naverCustomerTask = customerAuditTask({
    ledgerId: 51,
    sourcePlatform: 'naver',
    roomKey: 'a',
    date: '2026-08-12',
    startTime: '19:00',
    endTime: '20:00',
    reservationNo: '1310000000',
    payloadJson: '{}',
  });
  assert.equal(naverCustomerTask.reservationNo, '1310000000');
  const updatedCustomerTask = customerAuditTask({
    ledgerId: 52,
    mirrorTaskId: 81,
    sourcePlatform: 'spacecloud',
    roomKey: 'b',
    date: '2026-08-13',
    startTime: '10:00',
    endTime: '11:00',
    reservationNo: 'current-source-id',
    mirrorPayloadJson: JSON.stringify({ spacecloud_reservation_id: 'old-source-id', task_marker: 'keep-me' }),
    payloadJson: JSON.stringify({ spacecloud_reservation_id: 'current-source-id' }),
  });
  assert.equal(updatedCustomerTask.payload.spacecloud_reservation_id, 'current-source-id');
  assert.equal(updatedCustomerTask.payload.task_marker, 'keep-me');
  assert.deepEqual(
    customerAuditChecks({ sourcePlatform: 'naver', mirrorTaskId: null, mirrorTaskStatus: '' })
      .map((row) => row.checkType),
    ['naver_source'],
    'legacy source-only rows must not be judged as missing a mirror that was never created',
  );
  assert.deepEqual(
    customerAuditChecks({ sourcePlatform: 'naver', mirrorTaskId: 71, mirrorTaskStatus: 'pending' })
      .map((row) => row.checkType),
    ['naver_source'],
    'unfinished mirror tasks are handled by task audit, not platform-presence audit',
  );
  assert.deepEqual(
    customerAuditChecks({ sourcePlatform: 'naver', mirrorTaskId: 72, mirrorTaskStatus: 'done' })
      .map((row) => row.checkType),
    ['naver_source', 'spacecloud_mirror'],
  );
  assert.deepEqual(
    customerAuditChecks({ sourcePlatform: 'spacecloud', mirrorTaskId: 73, mirrorTaskStatus: 'google_pending' })
      .map((row) => row.checkType),
    ['spacecloud_source', 'naver_mirror'],
    'legacy Google-pending means the platform mirror itself was already submitted',
  );
  assert.deepEqual(
    customerAuditChecks({ currentStatus: 'canceled', sourcePlatform: 'naver' })
      .map((row) => row.checkType),
    ['spacecloud_mirror_absent'],
    'recent Naver cancellations must re-read the SpaceCloud mirror absence',
  );
  assert.deepEqual(
    customerAuditChecks({ currentStatus: 'canceled', sourcePlatform: 'spacecloud' })
      .map((row) => row.checkType),
    ['naver_mirror_available'],
    'recent SpaceCloud cancellations must re-read restored Naver availability',
  );
  assert.equal(
    classifyCustomerPlatformInspection('naver_source', { status: '확정' }, naverCustomerTask).ok,
    true,
  );
  assert.equal(
    classifyCustomerPlatformInspection('naver_source', { status: 'not_found' }, naverCustomerTask).status,
    'check_failed',
  );
  assert.equal(
    classifyCustomerPlatformInspection('naver_source', { status: '취소' }, naverCustomerTask).status,
    'mismatch',
  );
  assert.match(inspectNaverReservationStatus.toString(), /naverBookingDetailUrl/);
  assert.equal(
    classifyCustomerPlatformInspection('spacecloud_mirror', { status: 'needs_review' }, naverCustomerTask).status,
    'check_failed',
  );
  assert.equal(
    classifyCustomerPlatformInspection('naver_mirror', { status: 'inspected', slots: [{ status: 'suspended' }] }, naverCustomerTask).ok,
    true,
  );
  assert.equal(
    classifyCustomerPlatformInspection('naver_mirror', { status: 'inspected', slots: [{ status: 'confirmed' }] }, naverCustomerTask).status,
    'mismatch',
  );
  assert.equal(
    classifyCustomerPlatformInspection('spacecloud_mirror_absent', { status: 'not_found' }, naverCustomerTask).ok,
    true,
  );
  assert.equal(
    classifyCustomerPlatformInspection('spacecloud_mirror_absent', { status: 'found' }, naverCustomerTask).status,
    'mismatch',
  );
  assert.equal(
    classifyCustomerPlatformInspection('naver_mirror_available', { status: 'inspected', slots: [{ status: 'available' }] }, naverCustomerTask).ok,
    true,
  );
  const canceledSpacecloudCandidate = {
    ledgerId: 9152,
    currentStatus: 'canceled',
    sourcePlatform: 'spacecloud',
    sourceMode: 'spacecloud_email',
    roomKey: 'e',
    date: '2026-09-17',
    startTime: '19:00',
    endTime: '22:00',
    payloadJson: '{}',
  };
  const overlapPool = [
    canceledSpacecloudCandidate,
    {
      ledgerId: 9199,
      currentStatus: 'confirmed',
      sourcePlatform: 'spacecloud',
      sourceMode: 'spacecloud_email',
      roomKey: 'e',
      date: '2026-09-17',
      startTime: '20:00',
      endTime: '22:00',
      mirrorTaskType: 'naver_block',
      mirrorTaskId: 572,
      mirrorTaskStatus: 'done',
    },
    {
      ledgerId: 9200,
      currentStatus: 'confirmed',
      sourcePlatform: 'naver',
      sourceMode: '',
      roomKey: 'e',
      date: '2026-09-17',
      startTime: '22:00',
      endTime: '23:00',
      mirrorTaskStatus: 'done',
    },
  ];
  const overlapBookings = customerCancellationOverlapBookings(canceledSpacecloudCandidate, overlapPool);
  assert.deepEqual(overlapBookings.map((row) => row.ledgerId), [9199], 'adjacent reservations must not justify a canceled slot block');
  const cancellationTaskWithOverlap = customerAuditTask({
    ...canceledSpacecloudCandidate,
    cancellationOverlapBookings: overlapBookings,
  });
  const partiallyProtectedInspection = {
    status: 'inspected',
    slots: [
      { date: '2026-09-17', startTime: '19:00', endTime: '20:00', status: 'available' },
      { date: '2026-09-17', startTime: '20:00', endTime: '21:00', status: 'suspended' },
      { date: '2026-09-17', startTime: '21:00', endTime: '22:00', status: 'suspended' },
    ],
  };
  const protectedClassification = classifyCustomerPlatformInspection(
    'naver_mirror_available',
    partiallyProtectedInspection,
    cancellationTaskWithOverlap,
  );
  assert.equal(protectedClassification.ok, true, 'a later active SpaceCloud booking must keep only its overlapping slots blocked');
  assert.match(protectedClassification.reason, /다른 활성 예약 보호 2칸/);
  assert.deepEqual(
    partiallyProtectedInspection.slotExpectations.map((row) => row.allowedStatuses),
    [['available'], ['available', 'suspended'], ['available', 'suspended']],
  );
  assert.equal(
    classifyCustomerPlatformInspection('naver_mirror_available', {
      status: 'inspected',
      slots: [{ date: '2026-09-17', startTime: '19:00', endTime: '20:00', status: 'suspended' }],
    }, cancellationTaskWithOverlap).status,
    'mismatch',
    'a non-overlapping leftover block must still be detected',
  );
  const naverOverlapTask = customerAuditTask({
    ...canceledSpacecloudCandidate,
    cancellationOverlapBookings: [{
      ledgerId: 9178,
      currentStatus: 'confirmed',
      sourcePlatform: 'naver',
      sourceMode: '',
      roomKey: 'e',
      date: '2026-09-17',
      startTime: '20:00',
      endTime: '21:00',
    }],
  });
  assert.equal(
    classifyCustomerPlatformInspection('naver_mirror_available', {
      status: 'inspected',
      slots: [{ date: '2026-09-17', startTime: '20:00', endTime: '21:00', status: 'confirmed' }],
    }, naverOverlapTask).ok,
    true,
    'an overlapping active Naver source reservation must remain confirmed',
  );
  const unownedSpacecloudBlockTask = customerAuditTask({
    ...canceledSpacecloudCandidate,
    cancellationOverlapBookings: [{
      ledgerId: 9300,
      currentStatus: 'confirmed',
      sourcePlatform: 'spacecloud',
      sourceMode: 'historical-source-only',
      roomKey: 'e',
      date: '2026-09-17',
      startTime: '20:00',
      endTime: '21:00',
      mirrorTaskType: 'naver_block',
      mirrorTaskStatus: '',
    }],
  });
  assert.equal(
    classifyCustomerPlatformInspection('naver_mirror_available', {
      status: 'inspected',
      slots: [{ date: '2026-09-17', startTime: '20:00', endTime: '21:00', status: 'suspended' }],
    }, unownedSpacecloudBlockTask).status,
    'mismatch',
    'a source-only historical row must not hide a leftover canceled-reservation block',
  );
  const adminSlot = { date: '2026-09-17', startTime: '20:00', endTime: '21:00', status: 'suspended' };
  assert.equal(naverCancellationSlotExpectation(adminSlot, [{
    ledgerId: 9401,
    currentStatus: 'confirmed',
    sourcePlatform: 'naver',
    sourceMode: 'admin-task-anchor',
    roomKey: 'e',
    date: '2026-09-17',
    startTime: '20:00',
    endTime: '21:00',
    mirrorTaskType: 'upload',
    mirrorTaskStatus: 'done',
  }]).ok, false, 'an admin SpaceCloud upload must not be mistaken for ownership of a Naver block');
  assert.equal(naverCancellationSlotExpectation(adminSlot, [{
    ledgerId: 9402,
    currentStatus: 'confirmed',
    sourcePlatform: 'spacecloud',
    sourceMode: 'admin-task-anchor',
    roomKey: 'e',
    date: '2026-09-17',
    startTime: '20:00',
    endTime: '21:00',
    mirrorTaskType: 'naver_block',
    mirrorTaskStatus: 'done',
  }]).ok, true, 'only a completed admin Naver-block task may justify a protected slot');
  const previousCancellationAuditLookback = process.env.RHYTHMJOY_CUSTOMER_CANCELLATION_AUDIT_LOOKBACK_DAYS;
  delete process.env.RHYTHMJOY_CUSTOMER_CANCELLATION_AUDIT_LOOKBACK_DAYS;
  assert.equal(customerCancellationAuditLookbackDays(), 10);
  if (previousCancellationAuditLookback === undefined) {
    delete process.env.RHYTHMJOY_CUSTOMER_CANCELLATION_AUDIT_LOOKBACK_DAYS;
  } else {
    process.env.RHYTHMJOY_CUSTOMER_CANCELLATION_AUDIT_LOOKBACK_DAYS = previousCancellationAuditLookback;
  }
  const uncertainCustomerRow = [{ classification: { ok: false, status: 'check_failed' } }];
  assert.equal(customerAuditStatusForRows(uncertainCustomerRow, '').auditStatus, 'recheck_pending');
  assert.equal(customerAuditStatusForRows(uncertainCustomerRow, 'recheck_pending').auditStatus, 'check_failed');
  assert.equal(
    customerPlatformAuditIntervalMs({ customerPlatformAuditIntervalMinutes: 240 }, { recheckPending: 1 }),
    3 * 60 * 1000,
    'uncertain platform reads must be rechecked promptly instead of waiting four hours',
  );
  assert.equal(
    customerAuditStatusForRows([{ classification: { ok: false, status: 'mismatch' } }], '').auditStatus,
    'mismatch',
  );

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
  assert.equal(shouldSendPriorBookingCancellationSms(recoveredClaim, { status: 'already-canceled' }), false);
  const recoveredCancellationClaim = normalizeClaimedTaskForRecovery({
    ...staleClaim,
    taskType: 'spacecloud_cancel',
    resultText: JSON.stringify({ status: 'cancel-submit-checkpoint', submissionAttempted: true }),
  });
  assert.equal(taskPriorCancellationAttempted(recoveredCancellationClaim), true);
  assert.equal(shouldSendPriorBookingCancellationSms(recoveredCancellationClaim, { status: 'already-canceled' }), true);
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
  const exhaustedTransientRow = {
    status: 'failed',
    error: 'page.goto: Timeout 20000ms exceeded while waiting until domcontentloaded',
    currentAttempt: PLATFORM_TRANSIENT_MAX_ATTEMPTS,
  };
  assert.equal(dbStatusForDeleteRow(exhaustedTransientRow), 'needs_review');
  assert.equal(exhaustedTransientRow.retryExhausted, true);
  assert.equal(exhaustedTransientRow.automaticRetry.currentAttempt, PLATFORM_TRANSIENT_MAX_ATTEMPTS);
  assert.match(exhaustedTransientRow.error, /자동 재시도 한도 도달/);
  const belowRetryLimitRow = {
    status: 'failed',
    error: 'page.goto: Timeout 20000ms exceeded while waiting until domcontentloaded',
  };
  assert.equal(dbStatusForUploadRow(belowRetryLimitRow, { attempts: PLATFORM_TRANSIENT_MAX_ATTEMPTS - 2 }), 'pending');
  assert.equal(belowRetryLimitRow.automaticRetry.currentAttempt, PLATFORM_TRANSIENT_MAX_ATTEMPTS - 1);
  const atRetryLimitRow = {
    status: 'failed',
    error: 'login required',
  };
  assert.equal(dbStatusForNaverBlockRow(atRetryLimitRow, { attempts: PLATFORM_TRANSIENT_MAX_ATTEMPTS - 1 }), 'needs_review');
  assert.equal(atRetryLimitRow.automaticRetry.kind, 'login-or-session');
  assert.equal(dbStatusForNaverCancelRow({ status: 'winner-verification-pending' }), 'pending');
  assert.equal(dbStatusForSpacecloudCancelRow({ status: 'cancellation-verification-pending' }), 'pending');
  assert.equal(dbStatusForNaverCancelRow({ status: 'conflict-cleared-source-requeued' }), 'done');
  assert.equal(dbStatusForSpacecloudCancelRow({ status: 'conflict-cleared-source-requeued' }), 'done');
  assert.equal(dbStatusForNaverBlockRow({ status: 'winner-waiting-loser-cancellation' }), 'pending');
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
  assert.equal(dbStatusForUploadRow(smsFailedRow), 'done');
  assert.equal(dbStatusForNaverBlockRow({ ...smsFailedRow, status: 'blocked' }), 'done');
  assert.equal(dbStatusForNaverCancelRow({ status: 'canceled', sms: { status: 'failed' } }), 'done');
  assert.equal(dbStatusForSpacecloudCancelRow({ status: 'canceled', sms: { status: 'needs_review' } }), 'done');
  assert.equal(dbStatusForUploadRow(smsUncertainRow), 'done');
  assert.equal(dbStatusForUploadRow(smsSentRow), 'done');
  assert.equal(smsSendOk('already_sent'), true);
  assert.equal(smsSendOk('delivery_in_progress'), false);
  assert.equal(redactPhoneText('recipient 010-4801-7180 failed'), 'recipient 010-****-7180 failed');
  assert.equal(redactPhoneText('01048017180'), '010-****-7180');
  const compactedLongResult = taskResultTextForDb(JSON.stringify({
    status: 'needs-review',
    taskId: 777,
    reservationNo: '1311471051',
    submissionAttempted: true,
    submissionConfirmed: false,
    resubmitBlocked: true,
    retryMode: 'verification-only',
    error: 'x'.repeat(20_000),
    candidates: Array.from({ length: 100 }, (_, index) => ({ index, text: '후보'.repeat(1000) })),
  }), 4000);
  const parsedLongResult = JSON.parse(compactedLongResult);
  assert.ok(Buffer.byteLength(compactedLongResult, 'utf8') <= 4000);
  assert.equal(parsedLongResult.status, 'needs-review');
  assert.equal(parsedLongResult.reservationNo, '1311471051');
  assert.equal(parsedLongResult.submissionAttempted, true);
  assert.equal(parsedLongResult.submissionConfirmed, false);
  assert.equal(parsedLongResult.resubmitBlocked, true);
  assert.equal(parsedLongResult.retryMode, 'verification-only');
  const verboseNaverSlots = Array.from({ length: 24 }, (_, index) => ({
    date: '2026-09-17',
    startTime: `${String(index).padStart(2, '0')}:00`,
    endTime: `${String(index + 1).padStart(2, '0')}:00`,
    slotIndex: index + 1,
    beforeSlot: {
      status: 'suspended',
      cellText: '불필요한 DOM 화면 정보'.repeat(200),
      buttons: Array.from({ length: 20 }, () => ({ text: '예약불가', visible: true })),
    },
    panelVerification: {
      ok: true,
      errors: [],
      textPreview: '불필요한 패널 전문'.repeat(200),
      panelCandidateCount: 1,
    },
    save: { dialogTypes: [] },
    afterSlot: {
      status: 'available',
      cellText: '불필요한 DOM 화면 정보'.repeat(200),
      buttons: Array.from({ length: 20 }, () => ({ text: '예약가능', visible: true })),
    },
    status: 'restored',
  }));
  const preservedNaverResult = taskResultTextForDb(JSON.stringify({
    status: 'restored',
    taskId: 571,
    taskType: 'naver_restore',
    roomKey: 'e',
    date: '2026-09-17',
    startTime: '00:00',
    endTime: '24:00',
    targetStatus: 'available',
    slotCount: verboseNaverSlots.length,
    changedSlotCount: verboseNaverSlots.length,
    beforeSlots: verboseNaverSlots.map((slot) => ({ ...slot, slot: slot.beforeSlot })),
    appliedSlots: verboseNaverSlots,
  }));
  const parsedNaverResult = JSON.parse(preservedNaverResult);
  assert.ok(Buffer.byteLength(preservedNaverResult, 'utf8') <= TASK_RESULT_TEXT_MAX_BYTES);
  assert.equal(parsedNaverResult.verificationEvidence.slotCount, 24);
  assert.equal(parsedNaverResult.verificationEvidence.observedSlotCount, 24);
  assert.equal(parsedNaverResult.verificationEvidence.verifiedSlotCount, 24);
  assert.equal(parsedNaverResult.verificationEvidence.allSlotsVerified, true);
  assert.equal(parsedNaverResult.verificationEvidence.slots.length, 24);
  assert.equal(parsedNaverResult.appliedSlots.length, 24);
  assert.equal(parsedNaverResult.appliedSlots[0].beforeStatus, 'suspended');
  assert.equal(parsedNaverResult.appliedSlots[0].afterStatus, 'available');
  assert.equal(parsedNaverResult.appliedSlots[0].verified, true);
  assert.equal(Object.hasOwn(parsedNaverResult.appliedSlots[0], 'beforeSlot'), false);
  assert.throws(
    () => taskResultTextForDb(JSON.stringify({
      status: 'restored',
      taskType: 'naver_restore',
      slotCount: verboseNaverSlots.length,
      appliedSlots: verboseNaverSlots,
    }), 300),
    /essential task verification evidence exceeds/,
  );
  const alertNow = Date.parse('2026-08-03T12:00:00Z');
  const priorAlert = { lastSentAt: '2026-08-03T11:59:00Z', textPreview: 'same issue' };
  assert.equal(notificationSuppressedByCooldown(priorAlert, 'same issue', alertNow, 3600), true);
  assert.equal(notificationSuppressedByCooldown(priorAlert, 'different issue', alertNow, 3600), false);
  assert.equal(notificationSuppressedByState({ stateSignature: 'complete:done', lastSentAt: '2026-08-03T12:00:00Z' }, 'complete:done'), true);
  assert.equal(notificationSuppressedByState({ stateSignature: 'attention:failed', lastSentAt: '2026-08-03T12:00:00Z' }, 'complete:done'), false);
  assert.equal(
    reservationCompletionSignature({ status: 'blocked' }),
    reservationCompletionSignature({ status: 'already-blocked' }),
    'equivalent verified completion paths must share one Telegram state',
  );
  const adminAttentionA = { rows: [{
    taskId: 701,
    taskType: 'naver_block',
    status: 'needs-review',
    error: 'calendar panel missing',
    adminPanelTask: true,
    adminReservationId: 51,
    adminSeriesId: 9,
  }] };
  const adminAttentionB = { rows: [{
    ...adminAttentionA.rows[0],
    taskId: 702,
    error: 'save verification failed',
    adminReservationId: 52,
  }] };
  assert.equal(reservationAttentionNotificationKey(adminAttentionA.rows[0], 'naver_block'), 'admin-reservation:51');
  assert.equal(reservationAttentionNotificationKey(adminAttentionB.rows[0], 'naver_block'), 'admin-reservation:52');
  assert.notEqual(
    reservationAttentionSignature(adminAttentionA, 'platform', 'naver_block'),
    reservationAttentionSignature(adminAttentionB, 'platform', 'naver_block'),
    'a different actionable failure must create a new Telegram state',
  );
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
  assert.doesNotMatch(telegramSuccess, /문자|확인 필요/);
  const smsAttention = smsFailureMessage([{
    id: 597,
    taskType: 'upload',
    status: 'submitted',
    date: '2026-09-19',
    roomKey: 'a',
    startTime: '10:00',
    endTime: '13:00',
    reserverName: '황*정님',
    sms: { status: 'phone_lookup_failed', reason: 'naver-reservation-not-found' },
  }]);
  assert.match(smsAttention, /^🟡 예약 안내문자 후속처리 필요/m);
  assert.match(smsAttention, /예약 반영: DB 원장·상대 플랫폼 완료/);
  assert.match(smsAttention, /영향: 일정 동기화에는 없음/);
  assert.equal(platformSessionBlocked([{ platform: 'naver', status: 'login_required' }], 'naver'), true);
  assert.equal(platformSessionBlocked([{ platform: 'naver', status: 'ready' }], 'naver'), false);
  assert.equal(sessionBlockedTaskResult('naver').attempted, 0);
  assert.match(sessionProblemMessage('naver', { status: 'login_required' }), /같은 세션 장애를 예약별로 반복 알리지 않습니다/);
  assert.doesNotMatch(sessionProblemMessage('naver', { status: 'login_required' }), /세션 만료/);
  const crashedSession = {
    platform: 'naver',
    status: 'check_failed',
    note: 'page.waitForTimeout: Page crashed',
    diagnostic: { failureCategory: 'browser_check_failed' },
  };
  assert.equal(isBrowserContextClosedProblem(crashedSession.note), true);
  assert.throws(
    () => ensureBrowserInspectionUsable({ status: 'failed', error: 'page.waitForTimeout: Page crashed' }, 'audit'),
    /Page crashed/,
  );
  assert.equal(browserSessionRecoveryNeeded([crashedSession]), true);
  assert.equal(browserSessionRecoveryNeeded([{ ...crashedSession, status: 'login_required' }]), false);
  assert.match(sessionProblemMessage('naver', crashedSession), /로그인 만료 확정 아님/);
  assert.doesNotMatch(sessionProblemMessage('naver', crashedSession), /로그인 필요/);
  assert.notEqual(
    sessionProblemSignature(crashedSession),
    sessionProblemSignature({ ...crashedSession, status: 'login_required' }),
  );
  assert.match(runWatch.toString(), /session check repeated after browser recovery/);
  assert.match(runWatch.toString(), /browser page crash detected during admin platform audit/);
  assert.match(runWatch.toString(), /browser page crash detected during customer platform audit/);
  const liveCookie = {
    primaryPresent: true,
    primaryFingerprint: 'cookie-a',
    primaryExpiresAt: '2026-09-11T10:47:59.000Z',
    captureError: '',
  };
  assert.equal(classifySessionDiagnostic({
    platform: 'naver',
    status: 'login_required',
    before: liveCookie,
    after: liveCookie,
    previous: {},
    result: { url: 'https://nid.naver.com/nidlogin.login?url=redacted' },
  }), 'server_rejected_unexpired_cookie');
  assert.equal(classifySessionDiagnostic({
    platform: 'naver',
    status: 'login_required',
    before: { ...liveCookie, primaryPresent: false, primaryFingerprint: '', primaryExpiresAt: '' },
    after: { ...liveCookie, primaryPresent: false, primaryFingerprint: '', primaryExpiresAt: '' },
    previous: { cookieFingerprint: 'cookie-old', cookieExpiresAt: '2099-01-01T00:00:00.000Z' },
    result: { url: 'https://nid.naver.com/nidlogin.login' },
  }), 'cookie_removed_before_expiry');
  assert.equal(classifySessionDiagnostic({
    platform: 'naver',
    status: 'login_required',
    before: { ...liveCookie, primaryPresent: false, primaryFingerprint: '', primaryExpiresAt: '' },
    after: { ...liveCookie, primaryPresent: false, primaryFingerprint: '', primaryExpiresAt: '' },
    previous: { cookieFingerprint: 'cookie-old', cookieExpiresAt: '' },
    result: { url: 'https://nid.naver.com/nidlogin.login' },
  }), 'cookie_removed_expiry_unknown');
  assert.equal(classifySessionDiagnostic({
    platform: 'naver',
    status: 'login_required',
    before: { ...liveCookie, primaryExpiresAt: '' },
    after: { ...liveCookie, primaryExpiresAt: '' },
    previous: {},
    result: { url: 'https://nid.naver.com/nidlogin.login' },
  }), 'server_rejected_cookie_validity_unknown');
  assert.equal(classifySessionDiagnostic({
    platform: 'naver',
    status: 'ready',
    before: liveCookie,
    after: { ...liveCookie, primaryFingerprint: 'cookie-b' },
    previous: { cookieFingerprint: 'cookie-a' },
    result: { url: 'https://partner.booking.naver.com/bizes/1/booking-calendar-view' },
  }), 'authenticated_cookie_rotated');
  assert.equal(privateFingerprint('local-secret', 'cookie-value'), privateFingerprint('local-secret', 'cookie-value'));
  assert.notEqual(privateFingerprint('local-secret', 'cookie-value'), privateFingerprint('local-secret', 'other-value'));
  assert.equal(
    sanitizeSessionDiagnosticNote('failed https://nid.naver.com/login?token=secret&state=private'),
    'failed https://nid.naver.com/login',
  );
  const previousCancellationSetting = process.env.RHYTHMJOY_CUSTOMER_RESERVATION_CANCELLATION_ENABLED;
  delete process.env.RHYTHMJOY_CUSTOMER_RESERVATION_CANCELLATION_ENABLED;
  assert.equal(customerReservationCancellationEnabled(), true);
  process.env.RHYTHMJOY_CUSTOMER_RESERVATION_CANCELLATION_ENABLED = '0';
  assert.equal(customerReservationCancellationEnabled(), false);
  if (previousCancellationSetting === undefined) delete process.env.RHYTHMJOY_CUSTOMER_RESERVATION_CANCELLATION_ENABLED;
  else process.env.RHYTHMJOY_CUSTOMER_RESERVATION_CANCELLATION_ENABLED = previousCancellationSetting;
  assert.match(createRemoteSpacecloudCancelTask.toString(), /CANCELLATION_PRIORITY_RULE/);
  assert.match(createRemoteNaverCancelTask.toString(), /CANCELLATION_PRIORITY_RULE/);
  assert.match(runGuardedCustomerCancellation.toString(), /verifyWinningBookingLive/);
  assert.match(runGuardedCustomerCancellation.toString(), /beforeConfirm/);
  assert.match(runGuardedCustomerCancellation.toString(), /cancel-submit-checkpoint/);
  assert.match(classifyLaterReservationConflict.toString(), /policy\.decision === 'winner'/);
  assert.match(classifyLaterReservationConflict.toString(), /queueStrictLaterBookingCancellation/);
  assert.doesNotMatch(runWatch.toString(), /stopping after (?:db upload|delete|naver block|naver restore|naver cancel|spacecloud cancel) failure/);
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
  assert.match(dailyReconcileMessage({}), /journalctl --user -u rhythmjoy-spacecloud-watch\.service/);
  assert.match(runAdminPlatformAudit.toString(), /persistRemoteAdminPlatformAudits/);
  assert.match(
    fetchRemoteAdminPlatformAuditCandidates.toString(),
    /DATE_ADD\(CAST\(r\.reservation_date AS DATETIME\), INTERVAL r\.end_hour HOUR\) > NOW\(\)/,
  );
  assert.ok(
    runAdminPlatformAudit.toString().indexOf('persistRemoteAdminPlatformAudits')
      < runAdminPlatformAudit.toString().indexOf('writeJson'),
    'admin platform audit persistence must finish before the local interval checkpoint',
  );
  assert.match(maybeRunAdminPlatformAudit.toString(), /persistRemoteAdminPlatformAuditFailure/);
  assert.match(runCustomerPlatformAudit.toString(), /persistRemoteCustomerPlatformAudits/);
  assert.ok(
    runCustomerPlatformAudit.toString().indexOf('persistRemoteCustomerPlatformAudits')
      < runCustomerPlatformAudit.toString().indexOf('writeJson'),
    'customer platform audit persistence must finish before the local interval checkpoint',
  );
  assert.match(maybeRunCustomerPlatformAudit.toString(), /persistRemoteCustomerPlatformAuditFailure/);
  assert.match(fetchRemoteReflectionAudit.toString(), /rhythmjoy_reflection_audit\.py/);
  assert.doesNotMatch(fetchRemoteReflectionAudit.toString(), /import pymysql|CREATE TABLE/);

  const rotationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rhythmjoy-watch-log-'));
  try {
    const rotationPath = path.join(rotationDir, 'runs.jsonl');
    await fs.writeFile(rotationPath, '123456789');
    assert.equal(await rotateJsonlIfNeeded(rotationPath, 8, 2), true);
    assert.equal(await fs.readFile(`${rotationPath}.1`, 'utf8'), '123456789');
    await appendJsonl(rotationPath, { ok: true });
    assert.match(await fs.readFile(rotationPath, 'utf8'), /"ok":true/);
    const atomicStatePath = path.join(rotationDir, 'notify-state.json');
    await writeJson(atomicStatePath, { first: { stateSignature: 'problem:a' } });
    await writeJson(atomicStatePath, { second: { stateSignature: 'healthy' } });
    assert.deepEqual(JSON.parse(await fs.readFile(atomicStatePath, 'utf8')), {
      second: { stateSignature: 'healthy' },
    });
    assert.equal((await fs.readdir(rotationDir)).some((name) => name.endsWith('.tmp')), false);
  } finally {
    await fs.rm(rotationDir, { recursive: true, force: true });
  }

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
      'crashed session pages reopen and recheck before any login warning',
      'ambiguous SpaceCloud submit is verified on retry',
      'task runners depend only on the DB queue and opposite booking platform',
      'SMS delivery state stays separate from successful reservation synchronization and retries by idempotency key',
      'SMS errors redact full recipient phone numbers',
      'oversized task results remain valid JSON with status and reservation identity',
      'Telegram state writes are atomic and suppress only equivalent reservation states',
      'customer cancellation defaults on, supports an emergency off switch, and requires live winner plus final DB guard',
      'reversed mailbox arrival still queues the strictly later opposite-platform reservation',
      'one quarantined reservation task does not stop later queue processing',
      'task claims use transactional row locks and unique claim tokens',
      'only the current claim owner can checkpoint or finish a task',
      'task rows are claimed one at a time so untouched rows never remain running',
      'new platform work is processed in source-received order',
      'daily reconcile message renders with log hint',
      'admin DB reservations rotate through actual Naver and SpaceCloud state inspection',
      'admin platform audits exclude reservations whose end time is already past',
      'admin platform audit results and audit failures persist to the DB-backed alert center before checkpointing independently of Telegram',
      'platform read failures stay distinct from mismatches and require a three-minute second pass before alerting',
      'platform session circuit breakers pause affected work and audits without consuming reservation attempts',
      'session diagnostics distinguish local cookie loss, scheduled expiry, and server rejection without storing cookie values',
      'customer DB reservations rotate through source and mirrored actual-platform inspection',
      'customer platform audit alerts persist to DB before the local interval checkpoint',
      'reflection audit uses the single canonical Cafe24 implementation',
      'watcher JSONL logs rotate instead of growing without limit',
    ],
  };
}

async function checkAutomationSessionStatuses(args, context) {
  const statuses = [];
  const priorState = await readJsonObject(path.join(args.workDir, 'session-check-state.json'));
  const previousStatuses = Array.isArray(priorState.statuses) ? priorState.statuses : [];
  const salt = await sessionDiagnosticSalt(args.workDir);
  const checkPlatform = async (platform, callback) => {
    const before = await collectSessionCookieSnapshot(context, platform, salt);
    let result = null;
    let error = null;
    try {
      result = await callback();
    } catch (caught) {
      error = caught;
    }
    const after = await collectSessionCookieSnapshot(context, platform, salt);
    const runtime = await sessionRuntimeSnapshot(args, context, salt);
    const status = error ? 'check_failed' : (result?.ok ? 'ready' : 'login_required');
    const diagnostic = buildSessionDiagnostic({
      platform,
      status,
      before,
      after,
      previous: previousDiagnosticForPlatform(previousStatuses, platform),
      result,
      error,
      runtime,
    });
    if (error) {
      statuses.push({
        platform,
        status,
        note: sanitizeSessionDiagnosticNote(error?.message || error),
        diagnostic,
      });
      return;
    }
    statuses.push({
      platform,
      status,
      note: sanitizeSessionDiagnosticNote(result?.ok
        ? sessionDiagnosticLabel(diagnostic.failureCategory)
        : `${sessionDiagnosticLabel(diagnostic.failureCategory)} · ${result?.reason || 'login may be required'}`
      ),
      diagnostic,
    });
  };

  await checkPlatform('naver', () => checkNaverSmartplaceLogin(context, {
      businessId: args.naverBusinessId,
      timeoutMs: 15000,
  }));

  await checkPlatform('spacecloud', () => checkSpacecloudLogin(context, {
    timeoutMs: 15000,
  }));

  try {
    await persistLocalSessionDiagnostics(args, statuses, previousStatuses);
  } catch (error) {
    logLine(`local session diagnostic persistence failed: ${String(error?.message || error)}`);
  }

  try {
    await updateRemoteAdminSessions(args, statuses);
  } catch (error) {
    logLine(`session status DB update failed: ${String(error?.message || error)}`);
  }

  return statuses;
}

function sessionStatusForPlatform(statuses, platform) {
  return (Array.isArray(statuses) ? statuses : [])
    .find((row) => row?.platform === platform) || null;
}

function platformSessionBlocked(statuses, platform) {
  const row = sessionStatusForPlatform(statuses, platform);
  return Boolean(row && ['login_required', 'check_failed'].includes(String(row.status || '')));
}

function blockedSessionPlatforms(statuses, platforms = ['naver', 'spacecloud']) {
  return platforms.filter((platform) => platformSessionBlocked(statuses, platform));
}

function sessionPlatformLabel(platform) {
  return platform === 'naver' ? '네이버 스마트플레이스' : '스페이스클라우드';
}

function sessionProblemMessage(platform, row) {
  const diagnosticReason = sessionDiagnosticLabel(row?.diagnostic?.failureCategory);
  if (row?.status === 'login_required') {
    return compactNotice(`⚠️ ${sessionPlatformLabel(platform)} 로그인 필요`, [
      '상태: 해당 플랫폼 자동 작업·실제 화면 검사를 일시 중지',
      'DB 원장과 다른 플랫폼 작업: 계속 운영',
      `진단: ${diagnosticReason}`,
      '조치: 미니 PC 자동화 브라우저에서 수동 로그인',
      '같은 세션 장애를 예약별로 반복 알리지 않습니다.',
    ]);
  }
  return compactNotice(`🟡 ${sessionPlatformLabel(platform)} 화면 검사 장애`, [
    '판정: 로그인 만료 확정 아님',
    '상태: 자동 브라우저 재생성 후에도 실제 화면 확인 실패',
    `원인: ${cleanTelegramText(row?.note || diagnosticReason || '화면 확인 실패', 140)}`,
    '조치: 다음 순환에서 다시 검사하며 같은 원인은 반복 발송하지 않습니다.',
  ]);
}

function sessionProblemSignature(row) {
  const status = String(row?.status || 'check_failed');
  const category = String(row?.diagnostic?.failureCategory || 'unknown');
  return `problem:${status}:${category}`;
}

function browserSessionRecoveryNeeded(statuses) {
  return (Array.isArray(statuses) ? statuses : []).some((row) => (
    row?.status === 'check_failed'
    && isBrowserContextClosedProblem(`${row?.note || ''} ${JSON.stringify(row?.diagnostic || {})}`)
  ));
}

async function notifySessionStateChanges(args, statuses) {
  for (const platform of ['naver', 'spacecloud']) {
    const row = sessionStatusForPlatform(statuses, platform);
    if (!row || !['ready', 'login_required', 'check_failed'].includes(String(row.status || ''))) continue;
    const key = `system:session:${platform}`;
    if (row.status !== 'ready') {
      await notifyOnStateChange(args, key, sessionProblemSignature(row), sessionProblemMessage(platform, row));
      continue;
    }
    const state = await readJsonObject(args.notifyState);
    const previous = state[key] || {};
    if (previous.lastSentAt && String(previous.stateSignature || '').startsWith('problem:')) {
      await notifyOnStateChange(args, key, 'healthy', compactNotice(`✅ ${sessionPlatformLabel(platform)} 로그인 복구`, [
        '상태: 자동 작업·실제 화면 검사 재개',
        '대기 작업은 DB 접수 순서대로 자동 처리합니다.',
      ]));
    }
  }
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
    if (Array.isArray(state.statuses) && state.statuses.length) {
      return state.statuses.map((row) => ({ ...row, cached: true }));
    }
    return [];
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

function sessionBlockedTaskResult(platform) {
  return {
    status: `${platform}-session-blocked`,
    fetched: 0,
    attempted: 0,
    rows: [],
    failed: [],
    retrying: [],
    sessionBlocked: true,
  };
}

function sessionBlockedBookingSyncResult() {
  return {
    order: [],
    uploadTasks: sessionBlockedTaskResult('spacecloud'),
    deleteTasks: sessionBlockedTaskResult('spacecloud'),
  };
}

async function runNowModeCycleTasks(args, row, activeContext, sessionStatuses = []) {
  const naverBlocked = platformSessionBlocked(sessionStatuses, 'naver');
  const spacecloudBlocked = platformSessionBlocked(sessionStatuses, 'spacecloud');
  const firstSpacecloudCancel = spacecloudBlocked
    ? sessionBlockedTaskResult('spacecloud')
    : await runSpacecloudCancelTasks(args, activeContext);
  row.spacecloudCancelTasks = firstSpacecloudCancel;
  setCycleStatusFromResult(row, row.spacecloudCancelTasks, {
    processed: 'spacecloud-cancel-processed',
    needsReview: 'spacecloud-cancel-needs-review',
    retrying: 'spacecloud-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.spacecloudCancelTasks)) return;

  const firstNaverCancel = naverBlocked
    ? sessionBlockedTaskResult('naver')
    : await runNaverCancelTasks(args, activeContext);
  row.naverCancelTasks = firstNaverCancel;
  setCycleStatusFromResult(row, row.naverCancelTasks, {
    processed: 'naver-cancel-processed',
    needsReview: 'naver-cancel-needs-review',
    retrying: 'naver-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.naverCancelTasks)) return;

  row.naverAvailabilityTasks = naverBlocked
    ? sessionBlockedTaskResult('naver')
    : await runNaverAvailabilityTasks(args, activeContext);
  const split = splitNaverAvailabilityResult(row.naverAvailabilityTasks);
  row.naverBlockTasks = split.naverBlockTasks;
  row.naverRestoreTasks = split.naverRestoreTasks;
  setCycleStatusFromResult(row, row.naverAvailabilityTasks, {
    processed: 'naver-availability-processed',
    needsReview: 'naver-availability-needs-review',
    retrying: 'naver-availability-retry-pending',
  });
  if (hasBlockingFailures(row.naverAvailabilityTasks)) return;

  const secondSpacecloudCancel = spacecloudBlocked
    ? sessionBlockedTaskResult('spacecloud')
    : await runSpacecloudCancelTasks(args, activeContext);
  row.spacecloudCancelTasks = mergeTaskResults(row.spacecloudCancelTasks, secondSpacecloudCancel);
  setCycleStatusFromResult(row, row.spacecloudCancelTasks, {
    processed: 'spacecloud-cancel-processed',
    needsReview: 'spacecloud-cancel-needs-review',
    retrying: 'spacecloud-cancel-retry-pending',
  });
  if (hasBlockingFailures(row.spacecloudCancelTasks)) return;

  row.bookingSyncTasks = spacecloudBlocked
    ? sessionBlockedBookingSyncResult()
    : await runOrderedBookingSyncTasks(args, activeContext);
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

  const secondNaverCancel = naverBlocked
    ? sessionBlockedTaskResult('naver')
    : await runNaverCancelTasks(args, activeContext);
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
      await runNowModeCycleTasks(args, row, activeContext, row.sessionStatus);
    } else {
      const naverBlocked = platformSessionBlocked(row.sessionStatus, 'naver');
      const spacecloudBlocked = platformSessionBlocked(row.sessionStatus, 'spacecloud');
      row.bookingSyncTasks = spacecloudBlocked
        ? sessionBlockedBookingSyncResult()
        : await runOrderedBookingSyncTasks(args, activeContext);
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
        row.naverCancelTasks = naverBlocked
          ? sessionBlockedTaskResult('naver')
          : await runNaverCancelTasks(args, activeContext);
        if (['planned', 'dry-run', 'idle', 'upload-task-processed'].includes(row.status) && row.naverCancelTasks.attempted > 0) {
          setCycleStatusFromResult(row, row.naverCancelTasks, {
            processed: 'naver-cancel-processed',
            needsReview: 'naver-cancel-needs-review',
            retrying: 'naver-cancel-retry-pending',
          });
        }
      }

      if (!row.failed?.length && !hasBlockingFailures(row.uploadTasks) && !hasBlockingFailures(row.naverCancelTasks) && !hasBlockingFailures(row.deleteTasks)) {
        row.naverAvailabilityTasks = naverBlocked
          ? sessionBlockedTaskResult('naver')
          : await runNaverAvailabilityTasks(args, activeContext);
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
        row.spacecloudCancelTasks = spacecloudBlocked
          ? sessionBlockedTaskResult('spacecloud')
          : await runSpacecloudCancelTasks(args, activeContext);
        if (['planned', 'dry-run', 'idle'].includes(row.status) && row.spacecloudCancelTasks.attempted > 0) {
          setCycleStatusFromResult(row, row.spacecloudCancelTasks, {
            processed: 'spacecloud-cancel-processed',
            needsReview: 'spacecloud-cancel-needs-review',
            retrying: 'spacecloud-cancel-retry-pending',
          });
        }
      }
    }

    row.smsFollowUpTasks = await runSmsPhoneLookupFollowUps(args, activeContext, row.sessionStatus);

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
    row.smsFollowUpTasks,
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
  const recoverBrowserAndRecheckSessions = async (reason) => {
    logLine(`${reason}; reopening context before notification`);
    await reopenBrowserContext();
    const statuses = await checkAutomationSessionStatuses(args, context);
    await writeJson(path.join(args.workDir, 'session-check-state.json'), {
      checkedAt: new Date().toISOString(),
      statuses,
    });
    logLine(`session check repeated after browser recovery: ${statuses.map((entry) => `${entry.platform}=${entry.status}`).join(',')}`);
    return statuses;
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
      let cycleSessionStatuses = [];
      const reportWatcherProblem = async (stateSignature, text) => {
        watcherProblemThisCycle = true;
        return notifyWatcherProblem(args, stateSignature, text);
      };
      try {
        const row = await runCycle(args, context);
        cycleSessionStatuses = row.sessionStatus || [];
        if (browserSessionRecoveryNeeded(cycleSessionStatuses)) {
          cycleSessionStatuses = await recoverBrowserAndRecheckSessions('browser page crash detected during session check');
          row.sessionStatus = cycleSessionStatuses;
        }
        await notifySessionStateChanges(args, cycleSessionStatuses);
        if (args.nowMode && cycleNeedsUrgentFollowUp(row)) {
          urgentUntil = Math.max(urgentUntil, Date.now() + args.urgentCooldownSeconds * 1000);
        }
        logLine(`cycle ${row.status}; candidates=${row.uploadCandidates}; attempted=${row.attempted || 0}; remaining=${row.remainingInPlan ?? 0}; uploadTasks=${row.uploadTasks?.attempted || 0}; naverCancelTasks=${row.naverCancelTasks?.attempted || 0}; deleteTasks=${row.deleteTasks?.attempted || 0}; naverBlockTasks=${row.naverBlockTasks?.attempted || 0}; naverRestoreTasks=${row.naverRestoreTasks?.attempted || 0}; spacecloudCancelTasks=${row.spacecloudCancelTasks?.attempted || 0}`);
        if (isBrowserContextClosedProblem(JSON.stringify(row))) {
          await reopenBrowserContext();
        }
        const successRows = syncSuccessRowsFromCycle(row);
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
        for (const smsRow of smsRows) {
          const result = await notifySmsState(args, smsRow);
          if (!result.sent) logLine(`telegram sms state skipped: ${result.reason}`);
        }
        if (row.failed?.length) {
          const errorText = row.failed.map((failedRow) => failedRow.error).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row));
            logLine(`login needed; waiting for manual login: ${JSON.stringify(row.failed)}`);
          } else {
            await notifyWithCooldown(args, 'spacecloud-upload-failed', uploadFailureMessage(row));
            logLine(`reservation work quarantined after non-login failure; watcher continues: ${JSON.stringify(row.failed)}`);
          }
        }
        if (row.uploadTasks?.failed?.length) {
          const errorText = row.uploadTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.uploadTasks));
            logLine(`login needed during db upload; waiting for manual login: ${JSON.stringify(row.uploadTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.uploadTasks, 'platform', 'upload', uploadTaskFailureMessage(row.uploadTasks));
            logLine(`upload task quarantined; watcher continues: ${JSON.stringify(row.uploadTasks.failed)}`);
          }
        }
        if (row.deleteTasks?.failed?.length) {
          const errorText = row.deleteTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.deleteTasks));
            logLine(`login needed during delete; waiting for manual login: ${JSON.stringify(row.deleteTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.deleteTasks, 'platform', 'delete', deleteFailureMessage(row.deleteTasks));
            logLine(`delete task quarantined; watcher continues: ${JSON.stringify(row.deleteTasks.failed)}`);
          }
        }
        if (row.naverBlockTasks?.failed?.length) {
          const errorText = row.naverBlockTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.naverBlockTasks));
            logLine(`login needed during naver block; waiting for manual login: ${JSON.stringify(row.naverBlockTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.naverBlockTasks, 'platform', 'naver_block', naverBlockFailureMessage(row.naverBlockTasks));
            logLine(`naver block task quarantined; watcher continues: ${JSON.stringify(row.naverBlockTasks.failed)}`);
          }
        }
        if (row.naverRestoreTasks?.failed?.length) {
          const errorText = row.naverRestoreTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.naverRestoreTasks));
            logLine(`login needed during naver restore; waiting for manual login: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.naverRestoreTasks, 'platform', 'naver_restore', naverRestoreFailureMessage(row.naverRestoreTasks));
            logLine(`naver restore task quarantined; watcher continues: ${JSON.stringify(row.naverRestoreTasks.failed)}`);
          }
        }
        if (row.naverCancelTasks?.failed?.length) {
          const errorText = row.naverCancelTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.naverCancelTasks));
            logLine(`login needed during naver cancel; waiting for manual login: ${JSON.stringify(row.naverCancelTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.naverCancelTasks, 'platform', 'naver_cancel', naverCancelFailureMessage(row.naverCancelTasks));
            logLine(`naver cancel task quarantined; watcher continues: ${JSON.stringify(row.naverCancelTasks.failed)}`);
          }
        }
        if (row.spacecloudCancelTasks?.failed?.length) {
          const errorText = row.spacecloudCancelTasks.failed.map((failedRow) => failedRow.error || failedRow.status).join('\n');
          if (isLoginProblem(errorText)) {
            await reportWatcherProblem('problem:login-needed', loginNeededMessage(row.spacecloudCancelTasks));
            logLine(`login needed during spacecloud cancel; waiting for manual login: ${JSON.stringify(row.spacecloudCancelTasks.failed)}`);
          } else {
            await notifyReservationAttention(args, row.spacecloudCancelTasks, 'platform', 'spacecloud_cancel', spacecloudCancelFailureMessage(row.spacecloudCancelTasks));
            logLine(`spacecloud cancel task quarantined; watcher continues: ${JSON.stringify(row.spacecloudCancelTasks.failed)}`);
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
      let adminAuditResult = await maybeRunAdminPlatformAudit(
        args,
        context,
        cycleSessionStatuses,
        { deferBrowserFailure: true },
      );
      if (isBrowserContextClosedProblem(adminAuditResult?.error)) {
        cycleSessionStatuses = await recoverBrowserAndRecheckSessions('browser page crash detected during admin platform audit');
        await notifySessionStateChanges(args, cycleSessionStatuses);
        adminAuditResult = await maybeRunAdminPlatformAudit(
          args,
          context,
          cycleSessionStatuses,
          { force: true },
        );
      }
      let customerAuditResult = await maybeRunCustomerPlatformAudit(
        args,
        context,
        cycleSessionStatuses,
        { deferBrowserFailure: true },
      );
      if (isBrowserContextClosedProblem(customerAuditResult?.error)) {
        cycleSessionStatuses = await recoverBrowserAndRecheckSessions('browser page crash detected during customer platform audit');
        await notifySessionStateChanges(args, cycleSessionStatuses);
        customerAuditResult = await maybeRunCustomerPlatformAudit(
          args,
          context,
          cycleSessionStatuses,
          { force: true },
        );
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

  if (args.command === 'check-sessions') {
    const result = await runCheckSessions(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.ok ? 'SpaceCloud and Naver login OK' : 'One or more platform logins need attention');
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
    const result = await runNowModeSelfTest();
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

  if (args.command === 'admin-platform-audit') {
    const result = await withAutomationProcessLock(args, async () => {
      const context = await openSpacecloudContext({
        profileDir: args.profileDir,
        headless: args.headless,
      });
      try {
        return await runAdminPlatformAudit(args, context, { force: true });
      } finally {
        await context.close();
      }
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`admin platform audit checked=${result.checked || 0}; ok=${result.ok || 0}; mismatches=${result.mismatches || 0}; recheckPending=${result.recheckPending || 0}; checkFailed=${result.checkFailed || 0}`);
    return;
  }

  if (args.command === 'customer-platform-audit') {
    const result = await withAutomationProcessLock(args, async () => {
      const context = await openSpacecloudContext({
        profileDir: args.profileDir,
        headless: args.headless,
      });
      try {
        return await runCustomerPlatformAudit(args, context, { force: true });
      } finally {
        await context.close();
      }
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`customer platform audit checked=${result.checked || 0}; ok=${result.ok || 0}; mismatches=${result.mismatches || 0}; recheckPending=${result.recheckPending || 0}; checkFailed=${result.checkFailed || 0}`);
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
