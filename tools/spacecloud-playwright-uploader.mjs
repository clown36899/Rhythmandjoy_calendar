import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

function compactDate(value) {
  return String(value || '').replace(/-/g, '');
}

function ymFromDate(value) {
  const [year, month] = String(value).slice(0, 7).split('-').map(Number);
  return { year, month };
}

function ymIndex(ym) {
  return ym.year * 12 + ym.month;
}

export async function loadPlaywright() {
  const searchRoots = [
    process.cwd(),
    '/Users/inteyeo/Rhythmjoy2025555-5',
    '/Users/inteyeo/web_crawling',
  ];

  for (const root of searchRoots) {
    try {
      const resolved = require.resolve('playwright', { paths: [root] });
      const mod = await import(pathToFileURL(resolved));
      return mod.default || mod;
    } catch {}
  }

  throw new Error('playwright dependency not found. Install it or keep /Users/inteyeo/Rhythmjoy2025555-5/node_modules available.');
}

export async function openSpacecloudContext({
  profileDir = '/Users/inteyeo/.spacecloud-automation',
  headless = false,
  channel = 'chrome',
} = {}) {
  const { chromium } = await loadPlaywright();
  const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless,
    viewport: { width: 1440, height: 1000 },
    locale: 'ko-KR',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });
  return context;
}

async function pageForContext(context) {
  const pages = context.pages();
  return pages[0] || context.newPage();
}

async function visible(page, selector) {
  return page.evaluate((sel) => {
    const elements = [...document.querySelectorAll(sel)];
    return elements.some((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }, selector);
}

async function waitVisible(page, selector, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await visible(page, selector).catch(() => false)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitHidden(page, selector, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await visible(page, selector).catch(() => false))) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function closeModalIfOpen(page) {
  if (!(await visible(page, '#start_day').catch(() => false))) return;
  const close = page.locator('.btn_pop_close, a.btn_close, button.btn_close').filter({ visible: true });
  if (await close.count() === 1) {
    await close.click({ timeout: 5000 });
    await waitHidden(page, '#start_day', 5000);
  }
}

async function openDatePicker(page) {
  if (await visible(page, '#_dpicker1 .calendar_tit').catch(() => false)) return;

  const opener = page.locator('a._miniCalOpen').filter({ visible: true });
  if (await opener.count() > 0) {
    await opener.first().click({ timeout: 5000 });
  } else {
    await page.locator('#start_day').click({ force: true, timeout: 5000 });
  }

  if (!(await waitVisible(page, '#_dpicker1 .calendar_tit', 8000))) throw new Error('datepicker did not open');
}

async function pickerMonth(page) {
  const text = await page.evaluate(() => {
    const root = document.querySelector('#_dpicker1');
    const title = root?.querySelector('.calendar_tit strong') || root?.querySelector('.calendar_tit') || root;
    return title?.innerText || '';
  });
  const match = String(text).match(/(\d{4})\s*\.\s*(\d{1,2})/);
  if (!match) throw new Error(`datepicker title month not found: ${String(text).slice(0, 80)}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

async function setDate(page, targetDate) {
  const targetCompact = compactDate(targetDate);
  const isTarget = async () => {
    const current = await page.evaluate(() => document.querySelector('#start_day')?.value || '');
    return {
      current,
      ok: String(current).replace(/[^0-9]/g, '').slice(0, 8) === targetCompact,
    };
  };

  const before = await isTarget();
  if (before.ok) return { method: 'already-default', current: before.current };

  await openDatePicker(page);

  const targetYm = ymFromDate(targetDate);
  for (let i = 0; i < 24; i += 1) {
    const currentYm = await pickerMonth(page);
    const diff = ymIndex(targetYm) - ymIndex(currentYm);
    if (diff === 0) break;

    const selector = diff > 0 ? '#_dpicker1 .btn_month_next' : '#_dpicker1 .btn_month_prev';
    const control = page.locator(selector).filter({ visible: true });
    const count = await control.count();
    if (count !== 1) throw new Error(`datepicker ${diff > 0 ? 'next' : 'prev'} count ${count}`);
    await control.click({ timeout: 5000 });
    await page.waitForTimeout(250);
  }

  const finalYm = await pickerMonth(page);
  if (ymIndex(finalYm) !== ymIndex(targetYm)) {
    throw new Error(`datepicker month not reached: ${finalYm.year}-${finalYm.month}, target=${targetDate.slice(0, 7)}`);
  }

  const day = String(Number(targetDate.slice(8, 10))).padStart(2, '0');
  const dayLocator = page.locator('#_dpicker1 a:not(.disable)').filter({ hasText: day, visible: true });
  const dayCount = await dayLocator.count();
  if (dayCount !== 1) throw new Error(`enabled datepicker day ${day} count ${dayCount}`);
  await dayLocator.click({ timeout: 5000 });

  const started = Date.now();
  while (Date.now() - started < 5000) {
    const after = await isTarget();
    if (after.ok) {
      return { method: 'datepicker', current: after.current, day, month: targetDate.slice(0, 7) };
    }
    await page.waitForTimeout(200);
  }

  const finalState = await isTarget();
  throw new Error(`date did not update to ${targetDate}; current=${finalState.current}`);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function readJsonArray(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function createSpacecloudPlaywrightUploader({
  context,
  planPath,
  resultsPath,
  roomOrder = ['a', 'b', 'e', 'c', 'd'],
}) {
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  let results = await readJsonArray(resultsPath);

  async function writeResults() {
    await writeJson(resultsPath, results);
  }

  async function uploadOne(event) {
    const page = await pageForContext(context);
    const ui = event.spacecloudUiInput;
    const row = {
      fingerprint: event.fingerprint,
      sourceEventId: event.sourceEventId,
      reservationNo: event.reservationNo,
      roomKey: event.roomKey,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      reserverName: event.reserverName,
      startedAt: new Date().toISOString(),
    };

    const dialogTypes = [];
    const onDialog = async (dialog) => {
      dialogTypes.push(dialog.type());
      if (dialog.type() === 'confirm') await dialog.accept();
      else await dialog.dismiss();
    };

    page.on('dialog', onDialog);
    try {
      if (page.url() !== ui.reservationCalendarUrl) {
        await page.goto(ui.reservationCalendarUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      await closeModalIfOpen(page);

      if (!(await waitVisible(page, 'a._additionalReserveLayerOpen', 20000))) {
        throw new Error('add button not visible; login or page load may have failed');
      }
      const add = page.locator('a._additionalReserveLayerOpen').filter({ visible: true });
      const addCount = await add.count();
      if (addCount !== 1) throw new Error(`visible add button count ${addCount}`);
      await add.click({ timeout: 10000 });
      if (!(await waitVisible(page, '#start_day', 12000))) throw new Error('add modal did not open');

      row.dateSet = await setDate(page, ui.values.date);
      await page.locator('#shour').selectOption(ui.values.startHourSelectValue, { timeout: 10000 });
      await page.locator('#ehour').selectOption(ui.values.endHourSelectValue, { timeout: 10000 });
      await page.locator('#reserve_name').fill(ui.values.name, { timeout: 10000 });
      await page.locator('#reserve_tel').fill(ui.values.tel || '', { timeout: 10000 });
      await page.locator('#reserve_memo').fill(ui.values.memo, { timeout: 10000 });

      const filled = await page.evaluate(() => ({
        date: document.querySelector('#start_day')?.value || '',
        shour: document.querySelector('#shour')?.value || '',
        ehour: document.querySelector('#ehour')?.value || '',
        name: document.querySelector('#reserve_name')?.value || '',
      }));

      if (
        String(filled.date).replace(/[^0-9]/g, '').slice(0, 8) !== compactDate(ui.values.date)
        || filled.shour !== ui.values.startHourSelectValue
        || filled.ehour !== ui.values.endHourSelectValue
        || filled.name !== ui.values.name
      ) {
        throw new Error(`field verification failed: ${JSON.stringify(filled)}`);
      }

      const submit = page.locator('#_addExternalSchedule').filter({ visible: true });
      const submitCount = await submit.count();
      if (submitCount !== 1) throw new Error(`visible submit count ${submitCount}`);
      await submit.click({ timeout: 10000 });
      await page.waitForTimeout(1200);

      const hidden = await waitHidden(page, '#start_day', 12000);
      row.finishedAt = new Date().toISOString();
      row.status = hidden ? 'submitted' : 'submitted-modal-still-visible';
      if (dialogTypes.length > 0) row.dialogTypes = dialogTypes;
      if (!hidden) throw new Error('modal still visible after submit');
    } catch (error) {
      row.finishedAt = new Date().toISOString();
      row.status = row.status || 'failed';
      row.error = String(error?.message || error);
      try {
        const close = page.locator('.btn_pop_close, a.btn_close, button.btn_close').filter({ visible: true });
        if (await close.count() === 1) await close.click({ timeout: 3000 });
      } catch {}
    } finally {
      page.off('dialog', onDialog);
    }

    results.push(row);
    await writeResults();
    return row;
  }

  function summary() {
    const submitted = new Set(results.filter((row) => row.status === 'submitted').map((row) => row.fingerprint));
    const pending = plan.upload.filter((event) => !submitted.has(event.fingerprint));
    return {
      total: plan.upload.length,
      submitted: submitted.size,
      remaining: pending.length,
      remainingByRoom: pending.reduce((acc, event) => {
        acc[event.roomKey] = (acc[event.roomKey] || 0) + 1;
        return acc;
      }, {}),
      failedAttempts: results.filter((row) => row.status !== 'submitted').length,
    };
  }

  async function runBatch(limit = 3) {
    const submitted = new Set(results.filter((row) => row.status === 'submitted').map((row) => row.fingerprint));
    const pending = plan.upload
      .filter((event) => !submitted.has(event.fingerprint))
      .sort((left, right) => (
        roomOrder.indexOf(left.roomKey) - roomOrder.indexOf(right.roomKey)
      ) || String(`${left.date} ${left.startTime}`).localeCompare(`${right.date} ${right.startTime}`));

    const rows = [];
    for (const event of pending.slice(0, limit)) {
      const row = await uploadOne(event);
      rows.push(row);
      if (row.status !== 'submitted') break;
      const page = await pageForContext(context);
      await page.waitForTimeout(1200);
    }

    return {
      attempted: rows.length,
      ...summary(),
      failed: rows
        .filter((row) => row.status !== 'submitted')
        .map((row) => ({ fingerprint: row.fingerprint, error: row.error })),
      rows,
    };
  }

  return {
    plan,
    resultsPath,
    summary,
    runBatch,
  };
}

export async function checkSpacecloudLogin(context, {
  url = 'https://partner.spacecloud.kr/reservation-calendar?product=108674&space=66056',
  timeoutMs = 20000,
} = {}) {
  const page = await pageForContext(context);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
  const addVisible = await waitVisible(page, 'a._additionalReserveLayerOpen', timeoutMs);
  const currentUrl = page.url();
  const title = await page.title().catch(() => '');
  return {
    ok: addVisible,
    url: currentUrl,
    title,
    reason: addVisible ? '' : 'reservation add button not visible; login may be required',
  };
}
