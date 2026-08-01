import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SPACECLOUD_PAGE_LOAD_TIMEOUT_MS = 20000;

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

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function maskPhone(value) {
  const digits = normalizePhone(value);
  if (digits.length < 7) return '';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function redactPhone(value) {
  return String(value || '').replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, (match) => maskPhone(match));
}

function findPhoneInObject(value) {
  const seen = new Set();
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (typeof current === 'object') seen.add(current);
    if (typeof current === 'string' || typeof current === 'number') {
      const digits = normalizePhone(current);
      if (/^01[016789]\d{7,8}$/.test(digits)) return digits;
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (typeof current === 'object') {
      stack.push(...Object.values(current));
    }
  }
  return '';
}

function displayReserverName(value) {
  const normalized = normalizeName(value);
  if (!normalized) return '';
  const chars = Array.from(normalized);
  if (chars.length === 1) return '*님';
  if (chars.length === 2) return `${chars[0]}*님`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}님`;
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

function spacecloudReservationIdFromTask(task) {
  const payload = parseTaskPayload(task);
  return String(
    payload.spacecloud_reservation_id
    || payload.spacecloudReservationId
    || payload.reservationId
    || task.spacecloudReservationId
    || task.spacecloud_reservation_id
    || ''
  ).trim();
}

async function fetchSpacecloudReservationDetail(page, reservationId) {
  return page.evaluate(async (id) => {
    const rawUserInfo = window.localStorage.getItem('spacecloud__userInfo') || '{}';
    let accessToken = '';
    try {
      const userInfo = JSON.parse(rawUserInfo);
      accessToken = userInfo.accessToken || userInfo.access_token || userInfo.token || '';
    } catch {}
    if (!accessToken) return { ok: false, status: 0, error: 'spacecloud-access-token-missing' };
    const response = await fetch(`https://api.spacecloud.kr/partner/reservations/${encodeURIComponent(id)}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include',
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { ok: response.ok, status: response.status, body };
  }, reservationId);
}

function spacecloudReservationStatus(detail) {
  return String(detail?.body?.RSV_STAT_CD || detail?.body?.status || '').trim();
}

function displayHour(value) {
  const time = slotTimeText(value);
  if (time === '24:00') return '24';
  return String(Number(time.slice(0, 2)));
}

function verifySpacecloudReservationText(text, row, reservationId) {
  const compact = compactText(text);
  const errors = [];
  if (!compact.includes(`예약번호:${reservationId}`)) errors.push('reservation-id');
  const name = normalizeName(row.reserverName);
  if (name && !compact.includes(name)) errors.push('reserver-name');
  const dateText = row.date.replace(/-/g, '.');
  if (!compact.includes(dateText)) errors.push('date');
  const startHour = displayHour(row.startTime);
  const endHour = displayHour(row.endTime);
  if (!compact.includes(`${startHour}시~${endHour}시`)) errors.push('time');
  const roomName = SPACECLOUD_ROOMS[row.roomKey]?.name || '';
  if (roomName && !compact.includes(roomName)) errors.push('room');
  return { ok: errors.length === 0, errors };
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
    attempts: Number(task.attempts || 0),
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
  const [targetYear, targetMonth, targetDay] = targetDate.split('-').map(Number);
  const day = Number(targetDate.slice(8, 10));
  const startHour = hourFromSlot(startTime);
  const endHour = hourFromSlot(endTime);

  return page.evaluate(({ targetDate, targetYear, targetMonth, targetDay, day, startHour, endHour }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '');
    const pad = (value) => String(value).padStart(2, '0');
    const compactDate = targetDate.replace(/-/g, '');
    const dottedDate = targetDate.replace(/-/g, '.');
    const slashDate = targetDate.replace(/-/g, '/');
    const firstWeekday = new Date(targetYear, targetMonth - 1, 1).getDay();
    const expectedCellIndex = firstWeekday + targetDay - 1;
    const dateNeedles = [
      targetDate,
      compactDate,
      dottedDate,
      slashDate,
      `${targetYear}.${targetMonth}.${targetDay}`,
      `${targetYear}/${targetMonth}/${targetDay}`,
    ];
    const timePatterns = [
      `${startHour}~${endHour}`,
      `${pad(startHour)}~${pad(endHour)}`,
      `${startHour}~${pad(endHour)}`,
      `${pad(startHour)}~${endHour}`,
      `${startHour}:00~${endHour}:00`,
      `${pad(startHour)}:00~${pad(endHour)}:00`,
      `${startHour}:00~${pad(endHour)}:00`,
      `${pad(startHour)}:00~${endHour}:00`,
    ];
    const eventSelector = [
      'a',
      'button',
      '[onclick]',
      '[role="button"]',
      '.type1',
      '.type2',
      '.type3',
      '.type4',
      '.type5',
      '.type6',
    ].join(',');
    const rows = [];
    const visibleLinks = [];
    let dayCellText = '';
    let dateScopeMethod = '';
    let dateScopeError = '';
    const dayCells = [...document.querySelectorAll('.booking_wrap')];

    const elementDateText = (element) => {
      const values = [];
      let cursor = element;
      for (let depth = 0; cursor && depth < 4; depth += 1) {
        values.push(
          cursor.getAttribute('data-date'),
          cursor.getAttribute('data-day'),
          cursor.getAttribute('datetime'),
          cursor.getAttribute('aria-label'),
          cursor.getAttribute('title'),
          cursor.id,
          cursor.className,
        );
        cursor = cursor.parentElement;
      }
      return normalize(values.filter(Boolean).join(' '));
    };

    const cellsWithAttributeDate = dayCells
      .map((cell, index) => ({ cell, index, dateText: elementDateText(cell) }))
      .filter((entry) => dateNeedles.some((needle) => entry.dateText.includes(normalize(needle))));

    let scopedDayCells = [];
    if (cellsWithAttributeDate.length === 1) {
      scopedDayCells = cellsWithAttributeDate;
      dateScopeMethod = 'date-attribute';
    } else if (dayCells.length > expectedCellIndex) {
      const cell = dayCells[expectedCellIndex];
      const firstLine = String(cell?.innerText || '').split(/\n/)[0]?.trim();
      if (Number(firstLine) === day) {
        scopedDayCells = [{ cell, index: expectedCellIndex, dateText: elementDateText(cell) }];
        dateScopeMethod = 'calendar-grid-index';
      } else {
        dateScopeError = `calendar grid cell mismatch: expected index ${expectedCellIndex}, firstLine=${firstLine || ''}, targetDay=${day}`;
      }
    } else {
      dateScopeError = `calendar grid too short: expected index ${expectedCellIndex}, cellCount=${dayCells.length}`;
    }

    if (scopedDayCells.length === 0) {
      const sameDayCells = dayCells
        .map((cell, index) => ({
          cell,
          index,
          firstLine: String(cell?.innerText || '').split(/\n/)[0]?.trim(),
          dateText: elementDateText(cell),
        }))
        .filter((entry) => Number(entry.firstLine) === day);
      if (sameDayCells.length === 1) {
        scopedDayCells = sameDayCells;
        dateScopeMethod = 'unique-day-number';
      } else if (sameDayCells.length > 1) {
        dateScopeError = `ambiguous same-day cells for ${targetDate}: indexes=${sameDayCells.map((entry) => entry.index).join(',')}`;
      }
    }

    for (const { cell: dayCell, index: cellIndex, dateText } of scopedDayCells) {
      dayCellText = String(dayCell.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const seenElements = new Set();
      const seenTexts = new Set();
      const links = [...dayCell.querySelectorAll(eventSelector)].filter((link) => {
        if (seenElements.has(link)) return false;
        seenElements.add(link);
        return true;
      });
      links.forEach((link) => {
        const visibleText = String(link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim();
        const text = normalize(visibleText);
        if (!text) return;
        const className = String(link.getAttribute('class') || '');
        const href = String(link.getAttribute('href') || '');
        const debugRow = {
          text,
          visibleText: visibleText.slice(0, 120),
          className,
          href,
          tagName: String(link.tagName || '').toLowerCase(),
        };
        if (visibleLinks.length < 30) visibleLinks.push(debugRow);
        const timeMatches = timePatterns.some((pattern) => text.includes(pattern));
        if (timeMatches) {
          const dedupeKey = `${text}|${href}|${className}`;
          if (seenTexts.has(dedupeKey)) return;
          seenTexts.add(dedupeKey);
          const index = String(rows.length);
          link.setAttribute('data-codex-delete-candidate', index);
          rows.push({
            index,
            cellIndex,
            dateScopeMethod,
            dateText,
            text,
            visibleText,
            className,
            href,
            tagName: debugRow.tagName,
            directHint: text.includes('추') || /\btype5\b/.test(className),
          });
        }
      });
    }
    return {
      candidates: rows,
      dayCellText,
      visibleLinks,
      dateScope: {
        targetDate,
        targetYear,
        targetMonth,
        targetDay,
        expectedCellIndex,
        cellCount: dayCells.length,
        method: dateScopeMethod,
        error: dateScopeError,
        attributeDateMatches: cellsWithAttributeDate.map((entry) => ({
          index: entry.index,
          dateText: entry.dateText.slice(0, 160),
        })).slice(0, 6),
      },
    };
  }, { targetDate, targetYear, targetMonth, targetDay, day, startHour, endHour });
}

async function waitForDirectEventCandidates(page, row, {
  timeoutMs = 12000,
  intervalMs = 500,
} = {}) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started <= timeoutMs) {
    latest = await findDirectEventCandidates(page, row);
    if ((latest.candidates || []).length > 0) {
      return {
        ...latest,
        waitedMs: Date.now() - started,
      };
    }
    await page.waitForTimeout(intervalMs);
  }
  return {
    ...(latest || { candidates: [], dayCellText: '', visibleLinks: [] }),
    waitedMs: Date.now() - started,
  };
}

async function verifyDirectEventCreated(page, event, {
  timeoutMs = 90000,
  intervalMs = 1500,
} = {}) {
  const row = {
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
  };
  const expectedName = normalizeName(event.reserverNameDisplay || event.reserverName || '');

  await closeModalIfOpen(page).catch(() => {});
  await page.goto(reservationCalendarUrl(event.roomKey), {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  }).catch(async () => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  });
  await page.waitForFunction(
    () => /\d{4}\s*\.\s*\d{1,2}/.test(
      document.querySelector('.calendar_tit.short strong')?.textContent
      || document.querySelector('.calendar_tit.short')?.textContent
      || '',
    ),
    { timeout: 20000 },
  );
  await gotoCalendarMonth(page, event.date);

  const latest = await waitForDirectEventCandidates(page, row, { timeoutMs, intervalMs });
  const candidates = latest.candidates || [];
  const nameMatched = expectedName
    ? candidates.some((candidate) => compactText(candidate.text || candidate.visibleText || '').includes(expectedName))
    : false;

  return {
    ok: candidates.length > 0,
    reason: candidates.length > 0 ? 'calendar-candidate-found' : 'calendar-candidate-not-found',
    waitedMs: latest.waitedMs,
    candidateCount: candidates.length,
    nameMatched,
    candidates: candidates.slice(0, 5),
    dayCellText: latest.dayCellText || '',
    visibleLinks: (latest.visibleLinks || []).slice(0, 12),
  };
}

function selectDeleteCandidate(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const directRows = rows.filter((candidate) => candidate.directHint);
  if (directRows.length === 1) {
    return {
      candidate: directRows[0],
      ignoredCandidates: rows.filter((candidate) => candidate !== directRows[0]),
    };
  }
  if (directRows.length > 1) {
    return {
      error: `multiple direct event candidates matched: ${directRows.map((candidate) => candidate.text).join(' / ')}`,
    };
  }
  if (rows.length === 1) {
    return { candidate: rows[0], ignoredCandidates: [] };
  }
  if (rows.length > 1) {
    return {
      error: `multiple non-direct event candidates matched: ${rows.map((candidate) => candidate.text).join(' / ')}`,
    };
  }
  return {
    error: 'no visible SpaceCloud event candidate matched room/date/time',
  };
}

function rankDeleteCandidates(candidates, row) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const nameKey = compactText(normalizeName(row.reserverName));
  const maskedNameKey = compactText(normalizeName(displayReserverName(row.reserverName)));
  return rows
    .map((candidate, originalIndex) => {
      const text = compactText(candidate.text || candidate.visibleText || '');
      const nameMatched = Boolean(
        (nameKey && text.includes(nameKey))
        || (maskedNameKey && text.includes(maskedNameKey))
      );
      return {
        candidate,
        originalIndex,
        rank: [
          candidate.directHint ? 0 : 1,
          nameMatched ? 0 : 1,
          originalIndex,
        ],
      };
    })
    .sort((left, right) => {
      for (let i = 0; i < left.rank.length; i += 1) {
        if (left.rank[i] !== right.rank[i]) return left.rank[i] - right.rank[i];
      }
      return 0;
    })
    .map((entry) => entry.candidate);
}

async function findVerifiedDeleteCandidate(page, candidates, row) {
  const attempts = [];
  const orderedCandidates = rankDeleteCandidates(candidates, row);

  for (const candidate of orderedCandidates) {
    const selector = `[data-codex-delete-candidate="${candidate.index}"]`;
    const attempt = {
      candidate,
      selector,
    };
    attempts.push(attempt);

    try {
      await closeReservationPopup(page).catch(() => {});
      await page.locator(selector).first().click({ timeout: 8000 });
      if (!(await waitVisible(page, '.layer_popup.reservation_state', 8000))) {
        attempt.status = 'popup-not-opened';
        continue;
      }

      const popupText = await page.locator('.layer_popup.reservation_state').filter({ visible: true }).first().innerText({ timeout: 5000 });
      attempt.popupTextPreview = popupText.replace(/\s+/g, ' ').slice(0, 300);
      attempt.verification = popupDeleteVerification(popupText, row);
      if (attempt.verification.ok) {
        attempt.status = 'verified';
        return {
          candidate,
          popupText,
          verification: attempt.verification,
          attempts,
        };
      }

      attempt.status = 'verification-failed';
      await closeReservationPopup(page).catch(() => {});
    } catch (error) {
      attempt.status = 'error';
      attempt.error = String(error?.message || error);
      await closeReservationPopup(page).catch(() => {});
    }
  }

  return {
    error: attempts.length
      ? `no delete candidate passed detail verification: ${attempts.map((attempt) => `${attempt.candidate.text}:${attempt.verification?.errors?.join('|') || attempt.status}`).join(' / ')}`
      : 'no visible SpaceCloud event candidate matched room/date/time',
    attempts,
  };
}

export async function inspectSpacecloudReservationStatus(context, task, {
  timeoutMs = 15000,
} = {}) {
  const page = await pageForContext(context);
  const event = spacecloudUploadEventFromTask(task);
  const row = {
    roomKey: event.roomKey,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    reserverName: event.reserverName,
    reservationNo: event.reservationNo,
  };

  await page.goto(reservationCalendarUrl(row.roomKey), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForFunction(
    () => /\d{4}\s*\.\s*\d{1,2}/.test(
      document.querySelector('.calendar_tit.short strong')?.textContent
      || document.querySelector('.calendar_tit.short')?.textContent
      || '',
    ),
    { timeout: 20000 },
  );
  await gotoCalendarMonth(page, row.date);
  const search = await waitForDirectEventCandidates(page, row, { timeoutMs });
  const candidates = search.candidates || [];
  if (candidates.length === 0) {
    return {
      status: 'not_found',
      exists: false,
      reservationNo: row.reservationNo,
      candidateCount: 0,
      source: 'spacecloud-calendar',
    };
  }

  const selection = await findVerifiedDeleteCandidate(page, candidates, row);
  await closeReservationPopup(page).catch(() => {});
  if (!selection.candidate) {
    return {
      status: 'needs_review',
      exists: null,
      reservationNo: row.reservationNo,
      candidateCount: candidates.length,
      reason: selection.error || 'candidate-verification-failed',
      source: 'spacecloud-calendar',
    };
  }
  return {
    status: 'found',
    exists: true,
    reservationNo: row.reservationNo,
    candidateCount: candidates.length,
    source: 'spacecloud-calendar',
  };
}

function popupDeleteVerification(popupText, row) {
  const normalized = compactText(popupText);
  const errors = [];
  const room = SPACECLOUD_ROOMS[row.roomKey];
  const startHour = hourFromSlot(row.startTime);
  const endHour = hourFromSlot(row.endTime);
  const nameKey = normalizeName(row.reserverName);
  const maskedNameKey = normalizeName(displayReserverName(row.reserverName));
  const reservationNo = String(row.reservationNo || '').trim();
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

  const nameMatched = Boolean(
    (nameKey && normalized.includes(nameKey))
    || (maskedNameKey && normalized.includes(maskedNameKey))
  );
  const reservationNoMatched = Boolean(reservationNo && normalized.includes(reservationNo));
  const identityMode = reservationNo ? 'reservation-number' : 'reserver-name-fallback';
  if (reservationNo) {
    if (!reservationNoMatched) errors.push(`reservation-number-mismatch:${reservationNo}`);
  } else if (nameKey) {
    if (!nameMatched) errors.push(`reserver-name-mismatch:${nameKey}`);
  } else {
    errors.push('identity-missing');
  }

  return {
    ok: errors.length === 0,
    errors,
    identity: {
      mode: identityMode,
      nameMatched,
      reservationNoMatched,
      nameKey,
      maskedNameKey,
      reservationNo: reservationNo || '',
    },
  };
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
      await page.goto(ui.reservationCalendarUrl, {
        waitUntil: 'domcontentloaded',
        timeout: SPACECLOUD_PAGE_LOAD_TIMEOUT_MS,
      });
    }

    await closeModalIfOpen(page);

    if (Number(event.attempts || 0) > 0) {
      row.preflightVerification = await verifyDirectEventCreated(page, event, {
        timeoutMs: 12000,
        intervalMs: 750,
      });
      if (row.preflightVerification.ok && row.preflightVerification.nameMatched) {
        row.status = 'submitted';
        row.alreadyPresentOnRetry = true;
        row.finishedAt = new Date().toISOString();
        return row;
      }
      if (row.preflightVerification.candidateCount > 0) {
        row.status = 'needs-review';
        throw new Error('existing SpaceCloud schedule overlaps retry slot; manual review required');
      }
    }

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

    const hidden = await waitHidden(page, '#start_day', 45000);
    row.finishedAt = new Date().toISOString();
    row.status = hidden ? 'submitted' : 'submitted-modal-still-visible';
    if (dialogTypes.length > 0) row.dialogTypes = dialogTypes;
    if (!hidden) {
      row.postSubmitVerification = await verifyDirectEventCreated(page, event);
      if (row.postSubmitVerification.ok) {
        row.status = 'submitted';
        row.verifiedAfterModalStillVisible = true;
      } else {
        throw new Error('modal still visible after submit');
      }
    }
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

export async function fetchSpacecloudReservationPhone(context, task) {
  const page = await pageForContext(context);
  const roomKey = task.roomKey || task.room_key || parseTaskPayload(task).roomKey || parseTaskPayload(task).room_key || '';
  const reservationId = spacecloudReservationIdFromTask(task);
  if (!reservationId) {
    return {
      status: 'not_found',
      reason: 'spacecloud-reservation-id-missing',
      phone: '',
      maskedPhone: '',
      source: 'spacecloud-detail-api',
    };
  }
  if (roomKey && page.url() !== reservationCalendarUrl(roomKey)) {
    await page.goto(reservationCalendarUrl(roomKey), {
      waitUntil: 'domcontentloaded',
      timeout: SPACECLOUD_PAGE_LOAD_TIMEOUT_MS,
    }).catch(() => {});
  }

  const detail = await fetchSpacecloudReservationDetail(page, reservationId);

  if (!detail.ok) {
    return {
      status: 'not_found',
      reason: detail.error || `spacecloud-detail-http-${detail.status}`,
      phone: '',
      maskedPhone: '',
      source: 'spacecloud-detail-api',
      reservationId,
    };
  }

  const phone = findPhoneInObject(detail.body);
  if (!phone) {
    return {
      status: 'not_found',
      reason: 'spacecloud-phone-not-visible',
      phone: '',
      maskedPhone: '',
      source: 'spacecloud-detail-api',
      reservationId,
    };
  }
  return {
    status: 'found',
    phone,
    maskedPhone: maskPhone(phone),
    source: 'spacecloud-detail-api',
    reservationId,
  };
}

export async function cancelSpacecloudConfirmedReservation(context, task, {
  reasonCode = 'PRSCH',
  reasonText = '',
} = {}) {
  const page = await pageForContext(context);
  const payload = parseTaskPayload(task);
  const reservationId = spacecloudReservationIdFromTask(task);
  const roomKey = task.roomKey || task.room_key || payload.roomKey || payload.room_key || '';
  const row = {
    taskId: task.id || task.taskId || null,
    taskType: task.taskType || task.task_type || 'spacecloud_cancel',
    roomKey,
    date: normalizeDate(task.date || task.reservation_date || payload.date),
    startTime: slotTimeText(task.startTime || task.start_time || payload.start_time || payload.startTime),
    endTime: slotTimeText(task.endTime || task.end_time || payload.end_time || payload.endTime),
    reserverName: task.reserverName || task.reserver_name || payload.name || '',
    reservationId,
    product: task.product || payload.product || '',
    reasonCode,
    startedAt: new Date().toISOString(),
  };
  if (!reservationId) {
    row.status = 'needs-review';
    row.error = 'spacecloud reservation id missing; cannot cancel confirmed reservation';
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
    await page.goto(`https://partner.spacecloud.kr/reservation/${encodeURIComponent(reservationId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(1200);
    const detailBefore = await fetchSpacecloudReservationDetail(page, reservationId);
    row.beforeStatusCode = spacecloudReservationStatus(detailBefore);
    if (!detailBefore.ok) {
      row.status = 'needs-review';
      row.error = detailBefore.error || `spacecloud-detail-http-${detailBefore.status}`;
      row.finishedAt = new Date().toISOString();
      return row;
    }

    let phone = findPhoneInObject(detailBefore.body);
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    if (!phone) {
      const textPhone = bodyText.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/)?.[0] || '';
      phone = normalizePhone(textPhone);
    }
    row.maskedPhone = maskPhone(phone);
    if (!/^01[016789]\d{7,8}$/.test(phone)) {
      row.status = 'needs-review';
      row.error = 'recipient phone missing; cancellation blocked before SpaceCloud cancel click';
      row.finishedAt = new Date().toISOString();
      return row;
    }
    Object.defineProperty(row, 'phone', { value: phone, enumerable: false });

    if (row.beforeStatusCode && row.beforeStatusCode !== 'RSCMP') {
      row.status = row.beforeStatusCode === 'RCCMP' ? 'already-canceled' : 'needs-review';
      row.error = row.status === 'needs-review' ? `unexpected SpaceCloud status before cancel: ${row.beforeStatusCode}` : '';
      row.finishedAt = new Date().toISOString();
      return row;
    }

    row.detailVerification = verifySpacecloudReservationText(bodyText, row, reservationId);
    if (!row.detailVerification.ok) {
      row.status = 'needs-review';
      row.error = `SpaceCloud detail verification failed: ${row.detailVerification.errors.join(', ')}`;
      row.textPreview = redactPhone(bodyText).replace(/\s+/g, ' ').slice(0, 500);
      row.finishedAt = new Date().toISOString();
      return row;
    }

    const cancelButton = page.locator('a.btn_cancel.one_type').filter({ hasText: '예약취소', visible: true });
    const cancelCount = await cancelButton.count();
    if (cancelCount !== 1) throw new Error(`visible SpaceCloud cancel button count ${cancelCount}`);
    await cancelButton.first().click({ timeout: 8000 });
    await page.waitForTimeout(1000);

    const modalText = await page.locator('body').innerText({ timeout: 10000 });
    row.cancelModalVerification = verifySpacecloudReservationText(modalText, row, reservationId);
    if (!row.cancelModalVerification.ok) {
      row.status = 'needs-review';
      row.error = `SpaceCloud cancel modal verification failed: ${row.cancelModalVerification.errors.join(', ')}`;
      row.finishedAt = new Date().toISOString();
      await page.locator('.btn_pop_close').filter({ visible: true }).first().click({ timeout: 3000 }).catch(() => {});
      return row;
    }

    const reasonSelect = page.locator('select#select').filter({ visible: true });
    if (await reasonSelect.count() !== 1) throw new Error('SpaceCloud cancel reason select not visible');
    await reasonSelect.first().selectOption(reasonCode);
    const reasonInput = page.locator('textarea#cancel_gr1, textarea[name="cancel_gr"]').filter({ visible: true }).first();
    if (reasonText && await reasonInput.count() && await reasonInput.isEnabled().catch(() => false)) {
      await reasonInput.fill(reasonText.slice(0, 100), { timeout: 5000 });
    }

    const confirmButton = page.locator('a.btn.btn_full.btn_default').filter({ hasText: '확인', visible: true });
    if (await confirmButton.count() !== 1) throw new Error('SpaceCloud cancel confirm button not visible');
    await confirmButton.first().click({ timeout: 8000 });

    let afterStatus = '';
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.waitForTimeout(1000);
      const detailAfter = await fetchSpacecloudReservationDetail(page, reservationId).catch(() => null);
      afterStatus = spacecloudReservationStatus(detailAfter);
      if (afterStatus && afterStatus !== 'RSCMP') break;
    }
    row.afterStatusCode = afterStatus;
    if (afterStatus === 'RCCMP') {
      row.status = 'canceled';
    } else {
      row.status = 'failed';
      row.error = `SpaceCloud status did not become canceled after confirm: ${afterStatus || 'unknown'}`;
    }
    if (dialogTypes.length > 0) row.dialogTypes = dialogTypes;
    row.finishedAt = new Date().toISOString();
    return row;
  } catch (error) {
    row.status = row.status || 'failed';
    row.error = String(error?.message || error);
    row.finishedAt = new Date().toISOString();
    try {
      await page.locator('.btn_pop_close, a.btn_close, button.btn_close').filter({ visible: true }).first().click({ timeout: 3000 });
    } catch {}
    return row;
  } finally {
    page.off('dialog', onDialog);
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
  if (!row.reservationNo && !normalizeName(row.reserverName)) {
    row.status = 'needs-review';
    row.error = 'identity missing; automatic SpaceCloud delete requires reserver name or reservation number';
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
      await page.goto(row.reservationCalendarUrl, {
        waitUntil: 'domcontentloaded',
        timeout: SPACECLOUD_PAGE_LOAD_TIMEOUT_MS,
      });
    }
    await closeModalIfOpen(page);

    if (!(await waitVisible(page, 'a._additionalReserveLayerOpen', 20000))) {
      throw new Error('calendar add button not visible; login or page load may have failed');
    }

    await gotoCalendarMonth(page, row.date);
    const candidateSearch = await waitForDirectEventCandidates(page, row);
    const candidates = candidateSearch.candidates || [];
    row.candidateSearch = candidateSearch;
    row.candidates = candidates;

    if (candidates.length === 0) {
      row.status = 'needs-review';
      row.error = 'no visible SpaceCloud event candidate matched room/date/time; not marking as deleted';
      row.finishedAt = new Date().toISOString();
      return row;
    }

    const selection = await findVerifiedDeleteCandidate(page, candidates, row);
    row.deleteCandidateAttempts = selection.attempts || [];
    if (!selection.candidate) {
      row.status = 'needs-review';
      row.error = selection.error;
      row.finishedAt = new Date().toISOString();
      return row;
    }
    row.selectedCandidate = selection.candidate;
    if (selection.ignoredCandidates?.length) row.ignoredCandidates = selection.ignoredCandidates;
    const popupText = selection.popupText || await page.locator('.layer_popup.reservation_state').filter({ visible: true }).first().innerText({ timeout: 5000 });
    row.popupTextPreview = popupText.replace(/\s+/g, ' ').slice(0, 300);
    const verification = selection.verification || popupDeleteVerification(popupText, row);
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
    const remainingSearch = await findDirectEventCandidates(page, row);
    const remaining = remainingSearch.candidates || [];
    const directRemaining = remaining.filter((candidate) => candidate.directHint);
    row.remainingSearch = remainingSearch;
    if (directRemaining.length === 0) {
      row.status = 'deleted';
      if (remaining.length > 0) row.remainingNonDirectCandidates = remaining;
    } else {
      row.status = 'failed';
      row.error = `direct event still visible after delete: ${directRemaining.map((candidate) => candidate.text).join(' / ')}`;
      row.remaining = directRemaining;
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
