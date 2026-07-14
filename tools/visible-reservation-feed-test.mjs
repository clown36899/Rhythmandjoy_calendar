#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const DEFAULT_WORK_DIR = 'state/platform-detect-test/visible-feed';
const DEFAULT_NAVER_BUSINESS_ID = '1257912';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function usage() {
  return `Usage:
  node tools/visible-reservation-feed-test.mjs scan --cdp-url <url> [options]
  node tools/visible-reservation-feed-test.mjs scan --profile-dir <path> [options]
  node tools/visible-reservation-feed-test.mjs watch --cdp-url <url> [options]
  node tools/visible-reservation-feed-test.mjs watch --profile-dir <path> [options]

Read-only visible UI feed test. It attaches to an already-open logged-in Chrome
debugging endpoint, or briefly opens a customer browser profile, and reads
reservation list pages that an operator can see.
It does not call hidden platform APIs and does not change platform data.

Options:
  --cdp-url <url>             Attach to an already-open Chrome. Example: http://127.0.0.1:9223
  --profile-dir <path>        Open this persistent browser profile for the scan, then close it.
  --headless                  Launch profile mode headlessly. Defaults to headed.
  --channel <name>            Browser channel for profile mode. Auto-tries chrome when omitted.
  --executable-path <path>    Browser executable for profile mode.
  --platform <name>           naver, spacecloud, or both. Defaults to both.
  --naver-business-id <id>    Defaults to ${DEFAULT_NAVER_BUSINESS_ID}.
  --work-dir <path>           Defaults to ${DEFAULT_WORK_DIR}.
  --naver-application-days <n>
                              Defaults to 30.
  --naver-future-days <n>     Defaults to 180.
  --limit <n>                 Rows per feed. Defaults to 12.
  --interval-seconds <n>      Watch interval. Defaults to 60.
  --cycles <n>                Watch cycles. Defaults to 1. Use 0 for infinite.
  --settle-ms <n>             Wait after page changes. Defaults to 1600.
  --json                      Print machine-readable JSON.

Examples:
  node tools/visible-reservation-feed-test.mjs scan --cdp-url http://127.0.0.1:9223
  node tools/visible-reservation-feed-test.mjs scan --profile-dir state/customer-profiles/demo --platform both --headless
  node tools/visible-reservation-feed-test.mjs watch --cdp-url http://127.0.0.1:9223 --interval-seconds 60 --cycles 3
`;
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'help',
    cdpUrl: '',
    profileDir: '',
    headless: false,
    channel: '',
    executablePath: '',
    platform: 'both',
    naverBusinessId: DEFAULT_NAVER_BUSINESS_ID,
    workDir: DEFAULT_WORK_DIR,
    naverApplicationDays: 30,
    naverFutureDays: 180,
    limit: 12,
    intervalSeconds: 60,
    cycles: 1,
    settleMs: 1600,
    json: false,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--headless') {
      args.headless = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;

    if ([
      'naver-application-days',
      'naver-future-days',
      'limit',
      'interval-seconds',
      'cycles',
      'settle-ms',
    ].includes(key)) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${arg} must be a non-negative integer`);
      args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = parsed;
    } else if (key === 'cdp-url') {
      args.cdpUrl = next;
    } else if (key === 'profile-dir') {
      args.profileDir = next;
    } else if (key === 'channel') {
      args.channel = next;
    } else if (key === 'executable-path') {
      args.executablePath = next;
    } else if (key === 'platform') {
      args.platform = next;
    } else if (key === 'naver-business-id') {
      args.naverBusinessId = next;
    } else if (key === 'work-dir') {
      args.workDir = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['scan', 'watch', 'help'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  if (!['naver', 'spacecloud', 'both'].includes(args.platform)) throw new Error('--platform must be naver, spacecloud, or both');
  if (args.command !== 'help') {
    if (!args.cdpUrl && !args.profileDir) throw new Error('Either --cdp-url or --profile-dir is required');
    if (args.cdpUrl && args.profileDir) throw new Error('Use only one of --cdp-url or --profile-dir');
    if (args.cdpUrl && (args.headless || args.channel || args.executablePath)) {
      throw new Error('--headless, --channel, and --executable-path are only valid with --profile-dir');
    }
  }
  return args;
}

function kstNow() {
  return new Date(Date.now() + KST_OFFSET_MS);
}

function formatDateOnly(date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function addDaysKst(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function maskName(name) {
  const clean = String(name || '').replace(/\s+/g, '').trim();
  if (!clean) return '';
  if (clean.length <= 2) return `${clean[0]}*`;
  return `${clean[0]}${'*'.repeat(Math.max(1, clean.length - 2))}${clean[clean.length - 1]}`;
}

function parseKoreanShortDateTime(value) {
  const text = String(value || '');
  const match = text.match(/(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\([^)]*\)\s*(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!match) return '';
  let year = Number(match[1]);
  if (year < 100) year += 2000;
  let hour = Number(match[5]);
  const minute = Number(match[6]);
  if (match[4] === '오후' && hour < 12) hour += 12;
  if (match[4] === '오전' && hour === 12) hour = 0;
  return `${year}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
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

async function openPage(args) {
  const { chromium } = await loadPlaywright();
  if (args.cdpUrl) {
    const browser = await chromium.connectOverCDP(args.cdpUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error(`No Chrome context available from ${args.cdpUrl}`);
    const page = await context.newPage();
    return {
      page,
      source: 'cdp',
      close: async () => {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  }

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
  if (args.executablePath) launchOptions.executablePath = args.executablePath;
  if (args.channel) launchOptions.channel = args.channel;

  let context;
  if (args.channel || args.executablePath) {
    context = await chromium.launchPersistentContext(args.profileDir, launchOptions);
  } else {
    try {
      context = await chromium.launchPersistentContext(args.profileDir, {
        ...launchOptions,
        channel: 'chrome',
      });
    } catch (error) {
      if (!/channel|executable|Chrome/i.test(String(error?.message || error))) throw error;
      context = await chromium.launchPersistentContext(args.profileDir, launchOptions);
    }
  }

  const page = context.pages()[0] || await context.newPage();
  return {
    page,
    source: 'profile',
    close: async () => {
      await context.close().catch(() => {});
    },
  };
}

async function settle(page, args) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(args.settleMs);
}

function naverApplicationUrl(args) {
  const today = kstNow();
  const start = formatDateOnly(addDaysKst(today, -args.naverApplicationDays));
  const end = formatDateOnly(today);
  const params = new URLSearchParams({
    dateDropdownType: 'DIRECT',
    startDateTime: start,
    endDateTime: end,
    dateFilter: 'REGDATE',
    searchValueCode: 'USER_NAME',
  });
  return `https://partner.booking.naver.com/bizes/${args.naverBusinessId}/booking-list-view?${params}`;
}

function naverCancellationUrls(args) {
  const today = kstNow();
  const futureUseParams = new URLSearchParams({
    dateDropdownType: 'DIRECT',
    startDateTime: formatDateOnly(today),
    endDateTime: formatDateOnly(addDaysKst(today, args.naverFutureDays)),
    dateFilter: 'USEDATE',
    searchValueCode: 'USER_NAME',
  });
  const recentApplicationParams = new URLSearchParams({
    dateDropdownType: 'DIRECT',
    startDateTime: formatDateOnly(addDaysKst(today, -args.naverApplicationDays)),
    endDateTime: formatDateOnly(today),
    dateFilter: 'REGDATE',
    searchValueCode: 'USER_NAME',
  });
  return [
    {
      name: 'future-use-date',
      url: `https://partner.booking.naver.com/bizes/${args.naverBusinessId}/booking-list-view?${futureUseParams}`,
    },
    {
      name: 'recent-application-date',
      url: `https://partner.booking.naver.com/bizes/${args.naverBusinessId}/booking-list-view?${recentApplicationParams}`,
    },
  ];
}

async function clickNaverHeaderSort(page, headerText) {
  const clicked = await page.evaluate((headerTextArg) => {
    const exact = (value) => String(value || '').replace(/\s+/g, ' ').trim() === headerTextArg;
    const labels = Array.from(document.querySelectorAll('*')).filter((el) => exact(el.textContent));
    let best = null;
    for (const label of labels) {
      const lr = label.getBoundingClientRect();
      if (!lr.width || !lr.height) continue;
      const buttons = Array.from(document.querySelectorAll('button')).filter((button) => {
        const br = button.getBoundingClientRect();
        return br.width > 0
          && br.height > 0
          && Math.abs(br.y - lr.y) <= 8
          && br.x > lr.x
          && br.x < lr.x + lr.width + 35;
      });
      if (buttons.length) {
        best = buttons[0];
        break;
      }
    }
    if (!best) return false;
    best.click();
    return true;
  }, headerText);
  if (!clicked) throw new Error(`Could not find Naver sort header: ${headerText}`);
  await settle(page, { settleMs: 900 });
}

async function extractNaverRows(page, args) {
  return page.evaluate((limit) => {
    const compactLocal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizePhoneLocal = (value) => String(value || '').replace(/\D+/g, '');
    const priceTextLocal = (value) => String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
    const priceAmountLocal = (value) => Number(priceTextLocal(value).replace(/\D+/g, '') || 0);
    const maskNameLocal = (name) => {
      const clean = String(name || '').replace(/\s+/g, '').trim();
      if (!clean) return '';
      if (clean.length <= 2) return `${clean[0]}*`;
      return `${clean[0]}${'*'.repeat(Math.max(1, clean.length - 2))}${clean[clean.length - 1]}`;
    };
    const anchors = Array.from(document.querySelectorAll('a[href*="booking-list-view/bookings/"]'))
      .filter((a) => a.getBoundingClientRect().height > 20);
    const unique = [];
    const seen = new Set();
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const id = href.match(/bookings\/(\d+)/)?.[1] || '';
      const text = compactLocal(a.innerText);
      if (!id || !text || seen.has(id)) continue;
      seen.add(id);
      unique.push({ href, text });
    }
    return unique.slice(0, limit).map(({ href, text }) => {
      const bookingNo = href.match(/bookings\/(\d+)/)?.[1] || '';
      const phoneRaw = text.match(/010-\d{3,4}-\d{4}/)?.[0] || '';
      const status = text.match(/^(확정|취소|완료|신청|노쇼)/)?.[1] || '';
      const name = phoneRaw ? text.slice(status.length, text.indexOf(phoneRaw)).trim() : '';
      const useRange = text.match(/\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.\([^)]*\)\s*(오전|오후)\s*\d{1,2}:\d{2}~(오전|오후)?\s*\d{1,2}:\d{2}/)?.[0] || '';
      const room = text.match(/(A홀|B홀|C홀|D홀|E홀)[^ ]*/)?.[0] || '';
      const dateTimes = text.match(/\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.\([^)]*\)\s*(오전|오후)\s*\d{1,2}:\d{2}/g) || [];
      return {
        platform: 'naver',
        bookingNo,
        status,
        nameMasked: maskNameLocal(name),
        phoneLast4: normalizePhoneLocal(phoneRaw).slice(-4),
        useRange,
        room,
        appliedAtText: dateTimes[1] || '',
        confirmedAtText: dateTimes[2] || '',
        canceledAtText: dateTimes[3] || '',
        priceText: priceTextLocal(text),
        priceAmount: priceAmountLocal(text),
        sourceHref: href,
      };
    });
  }, args.limit);
}

function isDescendingBy(rows, field) {
  const values = rows.map((row) => parseKoreanShortDateTime(row[field])).filter(Boolean);
  if (values.length < 2) return true;
  for (let i = 1; i < Math.min(values.length, 5); i += 1) {
    if (values[i] > values[i - 1]) return false;
  }
  return true;
}

async function scanNaverApplications(page, args) {
  await page.goto(naverApplicationUrl(args));
  await settle(page, args);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = await extractNaverRows(page, args);
    if (isDescendingBy(rows, 'appliedAtText')) return { feed: 'naver_applications', rows };
    await clickNaverHeaderSort(page, '신청일시');
  }
  return { feed: 'naver_applications', rows: await extractNaverRows(page, args), warning: 'sort-not-confirmed' };
}

async function scanNaverCancellations(page, args) {
  const byBookingNo = new Map();
  const sources = [];
  let sortWarning = false;

  for (const source of naverCancellationUrls(args)) {
    await page.goto(source.url);
    await settle(page, args);

    let sourceRows = [];
    let sortClickError = '';
    try {
      await clickNaverHeaderSort(page, '취소일시');
    } catch (error) {
      sortClickError = error?.message || String(error);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      sourceRows = (await extractNaverRows(page, args))
        .filter((row) => row.status === '취소' && row.canceledAtText);
      if (isDescendingBy(sourceRows, 'canceledAtText')) break;
      if (sortClickError) break;
      await clickNaverHeaderSort(page, '취소일시');
    }

    if (!isDescendingBy(sourceRows, 'canceledAtText')) sortWarning = true;
    sources.push({
      source: source.name,
      rows: sourceRows.length,
      ...(sortClickError ? { warning: sortClickError } : {}),
    });
    for (const row of sourceRows) {
      byBookingNo.set(row.bookingNo, { ...row, cancelSource: source.name });
    }
  }

  const rows = Array.from(byBookingNo.values())
    .sort((a, b) => parseKoreanShortDateTime(b.canceledAtText).localeCompare(parseKoreanShortDateTime(a.canceledAtText)))
    .slice(0, args.limit);
  return {
    feed: 'naver_cancellations',
    rows,
    sources,
    ...(sortWarning ? { warning: 'sort-not-confirmed' } : {}),
  };
}

function spacecloudStatusUrl(statusCode) {
  return `https://partner.spacecloud.kr/reservation?RSV_STAT_CD=${encodeURIComponent(statusCode)}&page=1`;
}

async function extractSpacecloudRows(page, args) {
  return page.evaluate((limit) => {
    const compactLocal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizePhoneLocal = (value) => String(value || '').replace(/\D+/g, '');
    const priceTextLocal = (value) => String(value || '').match(/\d[\d,]*\s*원/)?.[0]?.replace(/\s+/g, '') || '';
    const priceAmountLocal = (value) => Number(priceTextLocal(value).replace(/\D+/g, '') || 0);
    const maskNameLocal = (name) => {
      const clean = String(name || '').replace(/\s+/g, '').trim();
      if (!clean) return '';
      if (clean.length <= 2) return `${clean[0]}*`;
      return `${clean[0]}${'*'.repeat(Math.max(1, clean.length - 2))}${clean[clean.length - 1]}`;
    };
    return Array.from(document.querySelectorAll('a[href^="/reservation/"]')).slice(0, limit).map((a) => {
      const text = compactLocal(a.innerText);
      const href = a.getAttribute('href') || '';
      const reservationNo = href.match(/reservation\/(\d+)/)?.[1] || text.match(/예약번호\s*(\d+)/)?.[1] || '';
      const status = text.match(/^(예약확정|취소환불|이용완료|승인대기|결제대기)/)?.[1] || '';
      const phoneRaw = text.match(/010-\d{3,4}-\d{4}/)?.[0] || '';
      const useRange = text.match(/20\d{2}\.\d{2}\.\d{2}\([^)]*\)\s*\d{1,2}~\d{1,2}\s*시/)?.[0] || '';
      const room = text.match(/[A-E]홀[^,\s]*/)?.[0] || '';
      const beforePhone = phoneRaw ? text.slice(0, text.indexOf(phoneRaw)).trim() : '';
      const name = beforePhone.match(/시간\s+([^ ]+)$/)?.[1] || '';
      return {
        platform: 'spacecloud',
        reservationNo,
        status,
        nameMasked: maskNameLocal(name),
        phoneLast4: normalizePhoneLocal(phoneRaw).slice(-4),
        useRange,
        room,
        priceText: priceTextLocal(text),
        priceAmount: priceAmountLocal(text),
        sourceHref: href,
      };
    }).filter((row) => row.reservationNo);
  }, args.limit);
}

async function scanSpacecloudFeed(page, args, statusCode, feed) {
  await page.goto(spacecloudStatusUrl(statusCode));
  await settle(page, args);
  return { feed, rows: await extractSpacecloudRows(page, args) };
}

async function runScan(args) {
  const session = await openPage(args);
  const { page } = session;
  const result = {
    generatedAt: new Date().toISOString(),
    mode: 'visible-ui-feed',
    platform: args.platform,
    runner: args.cdpUrl
      ? { type: 'cdp', cdpUrl: args.cdpUrl.replace(/\/\/.*@/, '//***@') }
      : {
          type: 'profile',
          profileDir: args.profileDir,
          headless: args.headless,
          channel: args.channel || 'auto',
          executablePath: args.executablePath || '',
        },
    feeds: [],
  };

  try {
    if (args.platform === 'naver' || args.platform === 'both') {
      result.feeds.push(await scanNaverApplications(page, args));
      result.feeds.push(await scanNaverCancellations(page, args));
    }
    if (args.platform === 'spacecloud' || args.platform === 'both') {
      result.feeds.push(await scanSpacecloudFeed(page, args, 'RSCMP', 'spacecloud_confirmed'));
      result.feeds.push(await scanSpacecloudFeed(page, args, 'RCCMP', 'spacecloud_canceled'));
    }
  } finally {
    await session.close();
  }

  const snapshotFile = path.join(args.workDir, 'snapshots', `${timestampForFile()}.json`);
  await writeJson(snapshotFile, result);
  await writeJson(path.join(args.workDir, 'latest.json'), result);
  result.snapshotFile = snapshotFile;
  return result;
}

async function runWatch(args) {
  const results = [];
  let cycle = 0;
  while (args.cycles === 0 || cycle < args.cycles) {
    cycle += 1;
    const startedAt = Date.now();
    const result = await runScan(args);
    results.push(result);
    if (!args.json) {
      const counts = result.feeds.map((feed) => `${feed.feed}:${feed.rows.length}`).join(' ');
      console.log(`[${result.generatedAt}] cycle=${cycle} ${counts}`);
    }
    if (args.cycles !== 0 && cycle >= args.cycles) break;
    const elapsed = Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, args.intervalSeconds * 1000 - elapsed)));
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'help') {
    process.stdout.write(usage());
    return;
  }

  const result = args.command === 'watch' ? await runWatch(args) : await runScan(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (args.command === 'scan') {
    const counts = result.feeds.map((feed) => `${feed.feed}:${feed.rows.length}`).join(' ');
    console.log(`visible feed scan complete: ${counts}`);
    console.log(`snapshot: ${result.snapshotFile}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
