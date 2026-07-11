import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export const SPACECLOUD_ROOMS = {
  a: { spaceId: '66056', productId: '108673', name: 'A홀' },
  b: { spaceId: '66056', productId: '108674', name: 'B홀' },
  c: { spaceId: '66056', productId: '108675', name: 'C홀' },
  d: { spaceId: '66056', productId: '108989', name: 'D홀' },
  e: { spaceId: '66056', productId: '108676', name: 'E홀' },
};

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

function reservationCalendarUrl(roomKey) {
  const room = SPACECLOUD_ROOMS[roomKey];
  if (!room) throw new Error(`unknown SpaceCloud room key: ${roomKey}`);
  return `https://partner.spacecloud.kr/reservation-calendar?product=${room.productId}&space=${room.spaceId}`;
}

function hourFromSlot(value) {
  if (String(value) === '24:00') return 24;
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new Error(`invalid slot time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute === 59 && hour < 24) return hour + 1;
  if (minute !== 0) throw new Error(`SpaceCloud automation only supports whole-hour slots: ${value}`);
  return hour;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, '');
}

function normalizeDate(value) {
  const text = String(value || '').trim().replace(/\./g, '-').replace(/\/+/g, '-').replace(/-+$/, '');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) throw new Error(`invalid date: ${value}`);
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function normalizeName(value) {
  return String(value || '')
    .replace(/님+$/u, '')
    .replace(/\s+/g, '')
    .trim();
}

function displayReserverName(value) {
  const normalized = normalizeName(value);
  if (!normalized) return '';
  return /[가-힣]/u.test(normalized) ? `${normalized}님` : normalized;
}

function slotTimeText(value) {
  const hour = hourFromSlot(value);
  if (hour === 24) return '24:00';
  return `${String(hour).padStart(2, '0')}:00`;
}

function eventFingerprint(eventLike) {
  return [
    eventLike.roomKey,
    eventLike.date,
    eventLike.startTime,
    eventLike.endTime,
  ].join('|');
}

function buildSpacecloudUiInput(event) {
  const room = SPACECLOUD_ROOMS[event.roomKey];
  if (!room) throw new Error(`unknown SpaceCloud room key: ${event.roomKey}`);
  const startHour = hourFromSlot(event.startTime);
  const endHour = hourFromSlot(event.endTime);
  return {
    reservationCalendarUrl: event.reservationCalendarUrl || reservationCalendarUrl(event.roomKey),
    selectors: {
      date: '#start_day',
      startHour: '#shour',
      endHour: '#ehour',
      name: '#reserve_name',
      tel: '#reserve_tel',
      memo: '#reserve_memo',
      submit: '#_addExternalSchedule',
    },
    values: {
      date: event.date,
      startHourSelectValue: String(startHour - 1),
      endHourSelectValue: String(endHour - 1),
      name: event.reserverNameDisplay || event.reserverName || event.reserverNameKey || event.title || '',
      tel: event.tel || '',
      memo: event.memo || '',
    },
  };
}

function parseTaskPayload(task) {
  if (task.payload && typeof task.payload === 'object') return task.payload;
  const raw = task.payloadJson || task.payload_json || '{}';
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function spacecloudUploadEventFromTask(task) {
  const payload = parseTaskPayload(task);
  const roomKey = task.roomKey || task.room_key || payload.roomKey || payload.room_key || '';
  const room = SPACECLOUD_ROOMS[roomKey];
  if (!room) throw new Error(`unknown SpaceCloud room key: ${roomKey}`);

  const date = normalizeDate(task.date || task.reservation_date || payload.date);
  const startTime = slotTimeText(task.startTime || task.start_time || payload.start_time || payload.startTime);
  const endTime = slotTimeText(task.endTime || task.end_time || payload.end_time || payload.endTime);
  const reserverName = task.reserverName || task.reserver_name || payload.name || '';
  const reservationNo = task.reservationNo || task.reservation_number || payload.reservation_number || '';
  const sourceEventId = payload.googleEventId || payload.google_event_id || (payload.emailEventId ? `email:${payload.emailEventId}` : `task:${task.id || task.taskId || ''}`);
  const event = {
    source: 'rhythmjoy-naver-email-db',
    taskId: task.id || task.taskId || null,
    emailEventId: payload.emailEventId || task.emailEventId || task.email_event_id || null,
    sourceEventId,
    googleEventId: payload.googleEventId || '',
    roomKey,
    rhythmjoyRoomName: payload.calendarKey || payload.target_calendar || room.name,
    spacecloudSpaceId: room.spaceId,
    spacecloudProductId: room.productId,
    spacecloudRoomName: room.name,
    title: payload.product || task.product || room.name,
    date,
    startTime,
    endTime,
    reserverName,
    reserverNameKey: normalizeName(reserverName),
    reserverNameDisplay: displayReserverName(reserverName),
    reservationNo,
    paymentStatus: payload.payment_status || task.payment_status || '',
    product: payload.product || task.product || '',
  };
  event.memo = [
    'Rhythmjoy Naver email DB sync',
    `room=${event.spacecloudRoomName}`,
    event.emailEventId ? `emailEventId=${event.emailEventId}` : '',
    event.taskId ? `taskId=${event.taskId}` : '',
    reservationNo ? `naverReservationNo=${reservationNo}` : '',
  ].filter(Boolean).join(' / ');
  event.fingerprint = eventFingerprint(event);
  event.spacecloudUiInput = buildSpacecloudUiInput(event);
  return event;
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

async function closeReservationPopup(page) {
  if (!(await visible(page, '.layer_popup.reservation_state').catch(() => false))) return;
  const close = page.locator('.layer_popup.reservation_state .btn_pop_close, .layer_popup.reservation_state a.btn_close, .layer_popup.reservation_state button.btn_close').filter({ visible: true });
  if (await close.count() > 0) {
    await close.first().click({ timeout: 5000 });
    await waitHidden(page, '.layer_popup.reservation_state', 5000);
  }
}

async function calendarMonth(page) {
  const text = await page.evaluate(() => {
    const title = document.querySelector('.calendar_tit.short strong') || document.querySelector('.calendar_tit.short');
    return title?.innerText || '';
  });
  const match = String(text).match(/(\d{4})\s*\.\s*(\d{1,2})/);
  if (!match) throw new Error(`calendar title month not found: ${String(text).slice(0, 80)}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

async function gotoCalendarMonth(page, targetDate) {
  const targetYm = ymFromDate(targetDate);
  for (let i = 0; i < 36; i += 1) {
    const currentYm = await calendarMonth(page);
    const diff = ymIndex(targetYm) - ymIndex(currentYm);
    if (diff === 0) return currentYm;
    const selector = diff > 0 ? '.calendar_tit.short .btn_next' : '.calendar_tit.short .btn_prev';
    const button = page.locator(selector).filter({ visible: true });
    const count = await button.count();
    if (count < 1) throw new Error(`calendar month control not found: ${selector}`);
    await button.first().click({ timeout: 5000 });
    await page.waitForTimeout(700);
  }
  throw new Error(`calendar month navigation failed for ${targetDate}`);
}

async function findDirectEventCandidates(page, {
  date,
  startTime,
  endTime,
}) {
  const targetDate = normalizeDate(date);
  const day = Number(targetDate.slice(8, 10));
  const startHour = hourFromSlot(startTime);
  const endHour = hourFromSlot(endTime);

  return page.evaluate(({ day, startHour, endHour }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '');
    const timePatterns = [
      `추${startHour}~${endHour}`,
      `추${String(startHour).padStart(2, '0')}~${String(endHour).padStart(2, '0')}`,
      `추${startHour}~${String(endHour).padStart(2, '0')}`,
      `추${String(startHour).padStart(2, '0')}~${endHour}`,
    ];
    const rows = [];
    const dayCells = [...document.querySelectorAll('.booking_wrap')];
    for (const dayCell of dayCells) {
      const firstLine = String(dayCell.innerText || '').split(/\n/)[0]?.trim();
      if (Number(firstLine) !== day) continue;
      const links = [...dayCell.querySelectorAll('a.type5')];
      links.forEach((link, index) => {
        const text = normalize(link.innerText || link.textContent || '');
        const timeMatches = timePatterns.some((pattern) => text.includes(pattern));
        if (timeMatches) {
          link.setAttribute('data-codex-delete-candidate', String(index));
          rows.push({ index, text });
        }
      });
    }
    return rows;
  }, { day, startHour, endHour });
}

function popupDeleteVerification(popupText, row) {
  const normalized = compactText(popupText);
  const errors = [];
  const room = SPACECLOUD_ROOMS[row.roomKey];
  const startHour = hourFromSlot(row.startTime);
  const endHour = hourFromSlot(row.endTime);
  const timePatterns = [
    `${startHour}:00~${endHour}:00`,
    `${String(startHour).padStart(2, '0')}:00~${String(endHour).padStart(2, '0')}:00`,
    `${startHour}:00~${String(endHour).padStart(2, '0')}:00`,
    `${String(startHour).padStart(2, '0')}:00~${endHour}:00`,
  ];
  const dateText = normalizeDate(row.date).replace(/-/g, '.');

  if (!/직접\s*추가한\s*예약/.test(popupText)) errors.push('not-direct-added');
  if (!room?.name || !normalized.includes(room.name)) errors.push(`room-mismatch:${room?.name || row.roomKey}`);
  if (!normalized.includes(dateText)) errors.push(`date-mismatch:${dateText}`);
  if (!timePatterns.some((pattern) => normalized.includes(pattern))) {
    errors.push(`time-mismatch:${row.startTime}-${row.endTime}`);
  }
  if (!row.reservationNo) {
    errors.push('reservation-number-missing-in-task');
  } else if (!normalized.includes(String(row.reservationNo))) {
    errors.push(`reservation-number-mismatch:${row.reservationNo}`);
  }

  return { ok: errors.length === 0, errors };
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

export async function uploadSpacecloudDirectReservation(context, event) {
  const page = await pageForContext(context);
  const ui = event.spacecloudUiInput || buildSpacecloudUiInput(event);
  const row = {
    taskId: event.taskId || null,
    fingerprint: event.fingerprint || eventFingerprint(event),
    sourceEventId: event.sourceEventId || '',
    reservationNo: event.reservationNo || '',
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

  return row;
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
    const row = await uploadSpacecloudDirectReservation(context, event);
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

export async function deleteSpacecloudDirectReservation(context, task) {
  const page = await pageForContext(context);
  const row = {
    taskId: task.id || null,
    roomKey: task.roomKey || task.room_key,
    date: normalizeDate(task.date || task.reservation_date),
    startTime: task.startTime || task.start_time,
    endTime: task.endTime || task.end_time,
    reserverName: task.reserverName || task.reserver_name || '',
    reservationNo: task.reservationNo || task.reservation_number || '',
    startedAt: new Date().toISOString(),
  };
  row.reservationCalendarUrl = task.reservationCalendarUrl || reservationCalendarUrl(row.roomKey);
  if (!row.reservationNo) {
    row.status = 'needs-review';
    row.error = 'reservation number missing; automatic SpaceCloud delete requires room, time, and reservation number';
    row.finishedAt = new Date().toISOString();
    return row;
  }

  const dialogTypes = [];
  const onDialog = async (dialog) => {
    dialogTypes.push(dialog.type());
    if (dialog.type() === 'confirm' || dialog.type() === 'alert') await dialog.accept();
    else await dialog.dismiss();
  };

  page.on('dialog', onDialog);
  try {
    if (page.url() !== row.reservationCalendarUrl) {
      await page.goto(row.reservationCalendarUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await closeModalIfOpen(page);

    if (!(await waitVisible(page, 'a._additionalReserveLayerOpen', 20000))) {
      throw new Error('calendar add button not visible; login or page load may have failed');
    }

    await gotoCalendarMonth(page, row.date);
    const candidates = await findDirectEventCandidates(page, row);
    row.candidates = candidates;

    if (candidates.length === 0) {
      row.status = 'already-gone';
      row.finishedAt = new Date().toISOString();
      return row;
    }
    if (candidates.length > 1) {
      row.status = 'needs-review';
      row.error = `multiple direct events matched: ${candidates.map((candidate) => candidate.text).join(' / ')}`;
      row.finishedAt = new Date().toISOString();
      return row;
    }

    const selector = `a.type5[data-codex-delete-candidate="${candidates[0].index}"]`;
    await page.locator(selector).first().click({ timeout: 8000 });
    if (!(await waitVisible(page, '.layer_popup.reservation_state', 8000))) {
      throw new Error('reservation popup did not open after clicking event');
    }

    const popupText = await page.locator('.layer_popup.reservation_state').filter({ visible: true }).first().innerText({ timeout: 5000 });
    row.popupTextPreview = popupText.replace(/\s+/g, ' ').slice(0, 300);
    const verification = popupDeleteVerification(popupText, row);
    row.deleteVerification = verification;
    if (!verification.ok) {
      row.status = 'needs-review';
      row.error = `matched event failed delete verification: ${verification.errors.join(', ')}`;
      row.finishedAt = new Date().toISOString();
      await closeReservationPopup(page).catch(() => {});
      return row;
    }

    const deleteButton = page.locator('.layer_popup.reservation_state .btn_negative').filter({ hasText: '예약 삭제', visible: true });
    const deleteCount = await deleteButton.count();
    if (deleteCount !== 1) throw new Error(`visible reservation delete button count ${deleteCount}`);
    await deleteButton.first().click({ timeout: 8000 });

    const confirmButton = page.locator('#_deleteExternalScheduleOK').filter({ visible: true });
    if (await confirmButton.count() === 1) {
      await confirmButton.first().click({ timeout: 8000 });
    }
    await page.waitForTimeout(1500);

    await waitHidden(page, '.layer_popup.reservation_state', 10000);
    const remaining = await findDirectEventCandidates(page, row);
    if (remaining.length === 0) {
      row.status = 'deleted';
    } else {
      row.status = 'failed';
      row.error = `event still visible after delete: ${remaining.map((candidate) => candidate.text).join(' / ')}`;
      row.remaining = remaining;
    }
    if (dialogTypes.length > 0) row.dialogTypes = dialogTypes;
    row.finishedAt = new Date().toISOString();
    return row;
  } catch (error) {
    row.status = row.status || 'failed';
    row.error = String(error?.message || error);
    row.finishedAt = new Date().toISOString();
    try {
      const close = page.locator('.btn_pop_close, a.btn_close, button.btn_close').filter({ visible: true });
      if (await close.count() === 1) await close.click({ timeout: 3000 });
    } catch {}
    return row;
  } finally {
    page.off('dialog', onDialog);
  }
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
