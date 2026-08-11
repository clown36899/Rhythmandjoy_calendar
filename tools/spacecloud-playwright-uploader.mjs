import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SPACECLOUD_PAGE_LOAD_TIMEOUT_MS = 20000;
const CALENDAR_MONTH_READY_TIMEOUT_MS = 20000;
const SPACECLOUD_CALENDAR_API_PATH = '/partner/reservations/calendar';

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

function shiftYm(ym, offset) {
  const shifted = new Date(Date.UTC(ym.year, ym.month - 1 + offset, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

export function calendarGridExpectation(yearValue, monthValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || month < 1 || month > 12) {
    throw new Error(`invalid calendar year/month: ${yearValue}.${monthValue}`);
  }
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const compactCellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const acceptableCellCounts = [];
  for (let count = compactCellCount; count <= 42; count += 7) acceptableCellCounts.push(count);
  return {
    year,
    month,
    firstWeekday,
    daysInMonth,
    compactCellCount,
    acceptableCellCounts,
  };
}

function calendarTitleMonth(title) {
  const match = String(title || '').match(/(\d{4})\s*\.\s*(\d{1,2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function assessCalendarMonthGrid(snapshot, expectedYm) {
  const expected = calendarGridExpectation(expectedYm?.year, expectedYm?.month);
  const observedTitle = String(snapshot?.title || '').replace(/\s+/g, ' ').trim();
  const observedYm = calendarTitleMonth(observedTitle);
  const cellCount = Number(snapshot?.cellCount);
  const dayNumbers = Array.isArray(snapshot?.dayNumbers) ? snapshot.dayNumbers : [];
  const base = {
    ready: false,
    expected,
    observedTitle,
    observedYm,
    cellCount: Number.isFinite(cellCount) ? cellCount : 0,
  };

  if (!observedYm) return { ...base, reason: 'calendar title month not found' };
  if (observedYm.year !== expected.year || observedYm.month !== expected.month) {
    return {
      ...base,
      reason: `calendar title mismatch: observed ${observedYm.year}.${observedYm.month}`,
    };
  }
  if (!expected.acceptableCellCounts.includes(cellCount)) {
    return {
      ...base,
      reason: `calendar grid cell count ${cellCount}; expected ${expected.acceptableCellCounts.join(' or ')}`,
    };
  }
  if (dayNumbers.length !== cellCount) {
    return {
      ...base,
      reason: `calendar day sample count ${dayNumbers.length}; cell count ${cellCount}`,
    };
  }
  for (let day = 1; day <= expected.daysInMonth; day += 1) {
    const index = expected.firstWeekday + day - 1;
    if (Number(dayNumbers[index]) !== day) {
      return {
        ...base,
        reason: `calendar day sequence mismatch at cell ${index}: expected ${day}, observed ${dayNumbers[index] ?? ''}`,
      };
    }
  }
  return { ...base, ready: true, reason: '' };
}

function reservationCalendarUrl(roomKey) {
  const room = SPACECLOUD_ROOMS[roomKey];
  if (!room) throw new Error(`unknown SpaceCloud room key: ${roomKey}`);
  return `https://partner.spacecloud.kr/reservation-calendar?product=${room.productId}&space=${room.spaceId}`;
}

function isSpacecloudCalendarApiUrl(value, {
  productId,
  year = null,
  month = null,
} = {}) {
  try {
    const url = new URL(String(value || ''));
    if (url.origin !== 'https://api.spacecloud.kr' || url.pathname !== SPACECLOUD_CALENDAR_API_PATH) return false;
    if (String(url.searchParams.get('product_id') || '') !== String(productId || '')) return false;
    if (year !== null && Number(url.searchParams.get('year')) !== Number(year)) return false;
    if (month !== null && Number(url.searchParams.get('month')) !== Number(month)) return false;
    return true;
  } catch {
    return false;
  }
}

async function waitForSpacecloudCalendarApiResponse(page, expected, timeoutMs) {
  const response = await page.waitForResponse(
    (candidate) => isSpacecloudCalendarApiUrl(candidate.url(), expected),
    { timeout: timeoutMs },
  );
  const networkError = await response.finished().catch((error) => error);
  if (networkError) throw new Error(`SpaceCloud calendar API network failure: ${networkError.message || networkError}`);
  if (!response.ok()) throw new Error(`SpaceCloud calendar API returned HTTP ${response.status()}`);
  return response;
}

function hourFromSlot(value) {
  const text = String(value || '').trim();
  if (text === '24:00') return 24;
  const durationMatch = text.match(/^(\d+)\s+days?,\s*(\d{1,2}):(\d{2})(?::\d{2})?$/i);
  if (durationMatch) {
    const totalHours = Number(durationMatch[1]) * 24 + Number(durationMatch[2]);
    const minute = Number(durationMatch[3]);
    if (totalHours === 24 && minute === 0) return 24;
    throw new Error(`invalid slot duration: ${value}`);
  }
  const match = text.match(/^(\d{1,2}):(\d{2})/);
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

function parseTaskResult(task) {
  if (task.result && typeof task.result === 'object') return task.result;
  const raw = task.resultText || task.result_text || '{}';
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

async function fetchSpacecloudCalendarMonth(page, roomKey, targetDate) {
  const room = SPACECLOUD_ROOMS[roomKey];
  if (!room) throw new Error(`unknown SpaceCloud room key: ${roomKey}`);
  const { year, month } = ymFromDate(normalizeDate(targetDate));
  return page.evaluate(async ({ endpoint, productId, year: targetYear, month: targetMonth }) => {
    const rawUserInfo = window.localStorage.getItem('spacecloud__userInfo') || '{}';
    let accessToken = '';
    try {
      const userInfo = JSON.parse(rawUserInfo);
      accessToken = userInfo.accessToken || userInfo.access_token || userInfo.token || '';
    } catch {}
    if (!accessToken) {
      return {
        ok: false,
        status: 0,
        error: 'spacecloud-access-token-missing',
        productId,
        year: targetYear,
        month: targetMonth,
        days: [],
      };
    }

    const url = new URL(endpoint);
    url.searchParams.set('year', String(targetYear));
    url.searchParams.set('month', String(targetMonth).padStart(2, '0'));
    url.searchParams.set('product_id', String(productId));
    let response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        cache: 'no-store',
      });
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: `calendar-api-fetch-failed:${error?.message || error}`,
        productId,
        year: targetYear,
        month: targetMonth,
        days: [],
      };
    }

    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    const sourceDays = Array.isArray(body)
      ? body
      : Array.isArray(body?.data)
        ? body.data
        : null;
    if (!response.ok || !sourceDays) {
      return {
        ok: false,
        status: response.status,
        error: response.ok ? 'calendar-api-unexpected-response' : `calendar-api-http-${response.status}`,
        productId,
        year: targetYear,
        month: targetMonth,
        days: [],
      };
    }

    // Return only the fields required for identity verification. In particular,
    // do not move customer phone numbers out of the authenticated browser page.
    const days = sourceDays.map((day) => ({
      ymd: String(day?.ymd || ''),
      externalSchedules: (Array.isArray(day?.external_schedules) ? day.external_schedules : []).map((schedule) => ({
        id: schedule?.id ?? null,
        name: String(schedule?.name || ''),
        symd: String(schedule?.symd || ''),
        eymd: String(schedule?.eymd || ''),
        shour: schedule?.shour ?? null,
        ehour: schedule?.ehour ?? null,
        memo: String(schedule?.memo || ''),
      })),
    }));
    return {
      ok: true,
      status: response.status,
      productId,
      year: targetYear,
      month: targetMonth,
      days,
    };
  }, {
    endpoint: `https://api.spacecloud.kr${SPACECLOUD_CALENDAR_API_PATH}`,
    productId: room.productId,
    year,
    month,
  });
}

function directScheduleMemoIdentity(memo) {
  const fields = {};
  for (const segment of String(memo || '').split('/')) {
    const match = segment.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }
  return {
    taskId: String(fields.taskId || ''),
    reservationNo: String(fields.naverReservationNo || ''),
  };
}

function calendarScheduleCandidate(schedule, dayYmd) {
  const identity = directScheduleMemoIdentity(schedule?.memo);
  const startHour = Number(schedule?.shour);
  const inclusiveEndHour = Number(schedule?.ehour);
  const endHour = inclusiveEndHour + 1;
  return {
    source: 'spacecloud-calendar-api',
    scheduleId: String(schedule?.id ?? ''),
    name: String(schedule?.name || ''),
    date: String(schedule?.symd || dayYmd || ''),
    endDate: String(schedule?.eymd || schedule?.symd || dayYmd || ''),
    startTime: Number.isFinite(startHour) ? `${String(startHour).padStart(2, '0')}:00` : '',
    endTime: Number.isFinite(endHour) && endHour <= 24 ? `${String(endHour).padStart(2, '0')}:00` : '',
    taskId: identity.taskId,
    reservationNo: identity.reservationNo,
  };
}

export function verifySpacecloudCalendarIdentity(calendarResult, row) {
  const targetDate = compactDate(normalizeDate(row.date));
  const targetStartHour = hourFromSlot(row.startTime);
  const targetInclusiveEndHour = hourFromSlot(row.endTime) - 1;
  const expectedTaskId = String(row.taskId || '').trim();
  const expectedReservationNo = String(row.reservationNo || '').trim();
  const expectedName = normalizeName(row.reserverName || '');

  if (!calendarResult?.ok) {
    return {
      ok: false,
      reason: 'calendar-api-read-failed',
      source: 'spacecloud-calendar-api',
      apiStatus: Number(calendarResult?.status || 0),
      apiError: String(calendarResult?.error || 'calendar-api-read-failed'),
      productId: String(calendarResult?.productId || ''),
      candidateCount: 0,
      identityCandidateCount: 0,
      nameMatched: false,
      identityMatched: false,
      identityVerification: { ok: false, errors: ['calendar-api-read-failed'] },
      reservationNo: expectedReservationNo,
      candidates: [],
    };
  }

  const uniqueSchedules = new Map();
  for (const day of Array.isArray(calendarResult.days) ? calendarResult.days : []) {
    for (const schedule of Array.isArray(day?.externalSchedules) ? day.externalSchedules : []) {
      const scheduleDate = compactDate(schedule?.symd || day?.ymd);
      const scheduleEndDate = compactDate(schedule?.eymd || schedule?.symd || day?.ymd);
      if (
        scheduleDate !== targetDate
        || scheduleEndDate !== targetDate
        || Number(schedule?.shour) !== targetStartHour
        || Number(schedule?.ehour) !== targetInclusiveEndHour
      ) continue;
      const candidate = calendarScheduleCandidate(schedule, day?.ymd);
      const dedupeKey = candidate.scheduleId
        ? `id:${candidate.scheduleId}`
        : [candidate.date, candidate.startTime, candidate.endTime, candidate.name, candidate.taskId, candidate.reservationNo].join('|');
      uniqueSchedules.set(dedupeKey, candidate);
    }
  }

  const candidates = [...uniqueSchedules.values()];
  const evaluated = candidates.map((candidate) => {
    const errors = [];
    if (row.requireTaskId && !expectedTaskId) errors.push('expected-task-id-missing');
    if (expectedTaskId && candidate.taskId !== expectedTaskId) errors.push('task-id-mismatch');
    if (expectedReservationNo && candidate.reservationNo !== expectedReservationNo) errors.push('reservation-number-mismatch');
    if (expectedName && normalizeName(candidate.name) !== expectedName) errors.push('reserver-name-mismatch');
    if (!expectedTaskId && !expectedReservationNo && !expectedName) errors.push('expected-identity-missing');
    return { candidate, errors };
  });
  const exactMatches = evaluated.filter((entry) => entry.errors.length === 0);
  const identityMatched = exactMatches.length === 1;
  const mismatchErrors = [...new Set(evaluated.flatMap((entry) => entry.errors))];
  if (exactMatches.length > 1) mismatchErrors.push('duplicate-exact-identity');

  return {
    ok: identityMatched,
    reason: identityMatched
      ? 'calendar-api-identity-matched'
      : candidates.length > 0
        ? 'calendar-api-slot-identity-not-matched'
        : 'calendar-api-slot-not-found',
    source: 'spacecloud-calendar-api',
    apiStatus: Number(calendarResult.status || 0),
    apiError: '',
    productId: String(calendarResult.productId || ''),
    candidateCount: candidates.length,
    identityCandidateCount: exactMatches.length,
    nameMatched: expectedName
      ? candidates.some((candidate) => normalizeName(candidate.name) === expectedName)
      : false,
    identityMatched,
    identityVerification: identityMatched
      ? { ok: true, scheduleId: exactMatches[0].candidate.scheduleId }
      : { ok: false, errors: mismatchErrors.length ? mismatchErrors : ['matching-slot-not-found'] },
    reservationNo: expectedReservationNo,
    candidates: candidates.slice(0, 8),
  };
}

export async function pollForSpacecloudCalendarIdentity({
  readCalendar,
  row,
  wait,
  timeoutMs = 12000,
  intervalMs = 500,
  now = () => Date.now(),
}) {
  if (typeof readCalendar !== 'function') throw new Error('readCalendar is required');
  if (typeof wait !== 'function') throw new Error('wait is required');
  const started = now();
  let candidateReadCount = 0;
  let latest = null;

  while (true) {
    let calendarResult;
    try {
      calendarResult = await readCalendar();
    } catch (error) {
      calendarResult = {
        ok: false,
        status: 0,
        error: `calendar-api-read-threw:${error?.message || error}`,
        days: [],
      };
    }
    candidateReadCount += 1;
    latest = verifySpacecloudCalendarIdentity(calendarResult, row);
    if (latest.identityMatched) break;

    const terminalAuthenticationFailure = [401, 403].includes(Number(latest.apiStatus || 0))
      || latest.apiError === 'spacecloud-access-token-missing';
    const elapsedMs = Math.max(0, now() - started);
    if (terminalAuthenticationFailure || elapsedMs >= timeoutMs) break;
    await wait(Math.min(intervalMs, Math.max(1, timeoutMs - elapsedMs)));
  }

  return {
    ...latest,
    waitedMs: Math.max(0, now() - started),
    refreshCount: 0,
    candidateReadCount,
    verificationPasses: candidateReadCount,
    identityAttempts: [],
    dayCellText: '',
    visibleLinks: [],
  };
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
  const acceptedEndHours = row.endTime === '00:00' && row.startTime !== '00:00'
    ? ['0', '24']
    : [endHour];
  if (!acceptedEndHours.some((candidate) => compact.includes(`${startHour}시~${candidate}시`))) errors.push('time');
  const roomName = SPACECLOUD_ROOMS[row.roomKey]?.name || '';
  if (roomName && !compact.includes(roomName)) errors.push('room');
  return { ok: errors.length === 0, errors };
}

export function spacecloudReservationIdentityAccepted(statusCode, verification) {
  if (verification?.ok === true) return true;
  const errors = Array.isArray(verification?.errors) ? verification.errors : [];
  // SpaceCloud removes or masks the reserver name after a customer booking is
  // canceled.  The reservation detail API is still addressed by its immutable
  // reservation id, and the detail page retains the room/date/time identity.
  // Accept only that single known omission for an authoritative canceled code.
  return statusCode === 'RCCMP'
    && errors.length > 0
    && errors.every((error) => error === 'reserver-name');
}

export function spacecloudUploadEventFromTask(task) {
  const payload = parseTaskPayload(task);
  const previousResult = parseTaskResult(task);
  const roomKey = task.roomKey || task.room_key || payload.roomKey || payload.room_key || '';
  const room = SPACECLOUD_ROOMS[roomKey];
  if (!room) throw new Error(`unknown SpaceCloud room key: ${roomKey}`);

  const date = normalizeDate(task.date || task.reservation_date || payload.date);
  const startTime = slotTimeText(task.startTime || task.start_time || payload.start_time || payload.startTime);
  const endTime = slotTimeText(task.endTime || task.end_time || payload.end_time || payload.endTime);
  const reserverName = task.reserverName || task.reserver_name || payload.name || '';
  const reservationNo = task.reservationNo || task.reservation_number || payload.reservation_number || '';
  const sourceEventId = payload.sourceEventId || payload.source_event_id || (payload.emailEventId ? `email:${payload.emailEventId}` : `task:${task.id || task.taskId || ''}`);
  const event = {
    source: 'rhythmjoy-naver-email-db',
    taskId: task.id || task.taskId || null,
    emailEventId: payload.emailEventId || task.emailEventId || task.email_event_id || null,
    sourceEventId,
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
    previousResult,
    recoveredFromStaleRunning: Boolean(task.recoveredFromStaleRunning),
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

export function directUploadRetryMode(event) {
  if (Number(event?.attempts || 0) <= 0) return 'new-submit';
  if (event?.recoveredFromStaleRunning) return 'verification-only';

  const previous = event?.previousResult && typeof event.previousResult === 'object'
    ? event.previousResult
    : {};
  if (
    previous.retryMode === 'verification-only'
    || previous.resubmitBlocked === true
    || previous.submissionAttempted === true
    || previous.postSubmitVerification
    || previous.verifiedAfterSubmit
    || /post-submit|after submit|candidate did not match/i.test(String(previous.error || ''))
  ) {
    return 'verification-only';
  }
  if (
    previous.submissionAttempted === false
    && (previous.retryMode === 'new-submit' || previous.retryMode === 'safe-retry-before-submit')
  ) {
    return 'safe-retry-before-submit';
  }

  // An old or interrupted task without an explicit pre-submit checkpoint is
  // ambiguous. Re-submitting it could duplicate a reservation, so only the
  // exact reservation identity may recover it automatically.
  return 'verification-only';
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

async function loadSpacecloudCalendar(page, roomKey, {
  timeoutMs = 45000,
  forceFreshDocument = true,
} = {}) {
  const room = SPACECLOUD_ROOMS[roomKey];
  if (!room) throw new Error(`unknown SpaceCloud room key: ${roomKey}`);
  const targetUrl = reservationCalendarUrl(roomKey);

  // SpaceCloud is an SPA. Changing only the product query can leave the prior
  // room's calendar cells in the DOM long enough to look fully loaded.
  // Start from a blank document so stale room data can never be classified as
  // the requested room's calendar.
  if (forceFreshDocument) {
    await page.goto('about:blank', { waitUntil: 'load', timeout: 10000 });
  }
  if (forceFreshDocument || page.url() !== targetUrl) {
    const calendarResponse = waitForSpacecloudCalendarApiResponse(page, {
      productId: room.productId,
    }, timeoutMs);
    await Promise.all([
      calendarResponse,
      page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      }),
    ]);
  }
  await page.waitForFunction(
    ({ productId, spaceId }) => {
      const url = new URL(window.location.href);
      const title = document.querySelector('.calendar_tit.short strong')?.textContent
        || document.querySelector('.calendar_tit.short')?.textContent
        || '';
      const addButtons = [...document.querySelectorAll('a._additionalReserveLayerOpen')]
        .filter((element) => !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length));
      return url.searchParams.get('product') === productId
        && url.searchParams.get('space') === spaceId
        && /\d{4}\s*\.\s*\d{1,2}/.test(title)
        && addButtons.length === 1;
    },
    { productId: room.productId, spaceId: room.spaceId },
    { timeout: timeoutMs },
  );
  await waitForCalendarMonthReady(page, await calendarMonth(page), { timeoutMs });
  return targetUrl;
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

async function calendarMonthGridSnapshot(page) {
  return page.evaluate(() => {
    const title = document.querySelector('.calendar_tit.short strong')?.textContent
      || document.querySelector('.calendar_tit.short')?.textContent
      || '';
    const cells = [...document.querySelectorAll('.booking_wrap')];
    return {
      title: String(title),
      cellCount: cells.length,
      dayNumbers: cells.map((cell) => {
        const firstLine = String(cell?.innerText || cell?.textContent || '').split(/\r?\n/)[0].trim();
        const match = firstLine.match(/^(\d{1,2})(?:\D|$)/);
        return match ? Number(match[1]) : null;
      }),
    };
  });
}

async function waitForCalendarMonthReady(page, expectedYm, {
  timeoutMs = CALENDAR_MONTH_READY_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  let lastAssessment = null;
  let lastReadError = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const snapshot = await calendarMonthGridSnapshot(page);
      lastAssessment = assessCalendarMonthGrid(snapshot, expectedYm);
      lastReadError = '';
      if (lastAssessment.ready) return expectedYm;
    } catch (error) {
      lastReadError = String(error?.message || error);
      if (/Target (?:page, context or browser|page|context|browser) has been closed/i.test(lastReadError)) throw error;
    }
    await page.waitForTimeout(100);
  }

  const expected = calendarGridExpectation(expectedYm?.year, expectedYm?.month);
  const observed = lastAssessment
    ? `title=${lastAssessment.observedTitle || '-'}, cells=${lastAssessment.cellCount}, reason=${lastAssessment.reason}`
    : `readError=${lastReadError || 'no calendar snapshot'}`;
  throw new Error(
    `SpaceCloud calendar DOM not ready for ${expected.year}.${expected.month}; ${observed}; `
      + `expectedCells=${expected.acceptableCellCounts.join('/')}`,
  );
}

async function gotoCalendarMonth(page, targetDate) {
  const targetYm = ymFromDate(targetDate);
  const productId = new URL(page.url()).searchParams.get('product');
  if (!productId) throw new Error('SpaceCloud calendar product id is missing from the page URL');
  for (let i = 0; i < 36; i += 1) {
    const currentYm = await calendarMonth(page);
    const diff = ymIndex(targetYm) - ymIndex(currentYm);
    if (diff === 0) {
      await waitForCalendarMonthReady(page, currentYm);
      return currentYm;
    }
    const direction = diff > 0 ? 1 : -1;
    const expectedYm = shiftYm(currentYm, direction);
    const selector = diff > 0 ? '.calendar_tit.short .btn_next' : '.calendar_tit.short .btn_prev';
    const button = page.locator(selector).filter({ visible: true });
    const count = await button.count();
    if (count < 1) throw new Error(`calendar month control not found: ${selector}`);
    const calendarResponse = waitForSpacecloudCalendarApiResponse(page, {
      productId,
      year: expectedYm.year,
      month: expectedYm.month,
    }, CALENDAR_MONTH_READY_TIMEOUT_MS);
    await Promise.all([
      calendarResponse,
      button.first().click({ timeout: 5000 }),
    ]);
    await waitForCalendarMonthReady(page, expectedYm);
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
    document.querySelectorAll('[data-codex-delete-candidate]').forEach((element) => {
      element.removeAttribute('data-codex-delete-candidate');
    });
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

export async function waitForDirectEventCandidates(page, row, {
  timeoutMs = 12000,
  intervalMs = 500,
  refreshAtMs = [],
  refresh = null,
} = {}) {
  const started = Date.now();
  let latest = null;
  const refreshSchedule = (Array.isArray(refreshAtMs) ? refreshAtMs : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0 && value < timeoutMs)
    .sort((left, right) => left - right);
  let refreshIndex = 0;
  let refreshCount = 0;
  while (Date.now() - started <= timeoutMs) {
    latest = await findDirectEventCandidates(page, row);
    if ((latest.candidates || []).length > 0) {
      return {
        ...latest,
        waitedMs: Date.now() - started,
        refreshCount,
      };
    }

    const elapsedMs = Date.now() - started;
    if (
      typeof refresh === 'function'
      && refreshIndex < refreshSchedule.length
      && elapsedMs >= refreshSchedule[refreshIndex]
    ) {
      await refresh({ elapsedMs, refreshCount });
      refreshIndex += 1;
      refreshCount += 1;
      latest = await findDirectEventCandidates(page, row);
      if ((latest.candidates || []).length > 0) {
        return {
          ...latest,
          waitedMs: Date.now() - started,
          refreshCount,
        };
      }
      continue;
    }
    await page.waitForTimeout(intervalMs);
  }
  return {
    ...(latest || { candidates: [], dayCellText: '', visibleLinks: [] }),
    waitedMs: Date.now() - started,
    refreshCount,
  };
}

async function verifyDirectEventCreated(page, event, {
  timeoutMs = 90000,
  intervalMs = 1500,
  forceFreshDocument = true,
} = {}) {
  const row = directUploadVerificationTarget(event);
  await closeModalIfOpen(page).catch(() => {});
  await loadSpacecloudCalendar(page, event.roomKey, { forceFreshDocument });
  return pollForSpacecloudCalendarIdentity({
    readCalendar: () => fetchSpacecloudCalendarMonth(page, event.roomKey, event.date),
    row,
    timeoutMs,
    intervalMs,
    wait: (delayMs) => page.waitForTimeout(delayMs),
  });
}

export function classifyDirectUploadVerification(hidden, verification) {
  const result = verification || {};
  const expectedIdentityMatched = result.reservationNo
    ? result.identityMatched === true
    : result.nameMatched === true;
  if (result.ok && expectedIdentityMatched) {
    return { status: 'submitted', error: '', verified: true };
  }
  if (Number(result.candidateCount || 0) > 0) {
    return {
      status: 'needs-review',
      error: 'SpaceCloud post-submit candidate did not match the expected reservation identity',
      verified: false,
    };
  }
  if (result.reason === 'calendar-api-read-failed') {
    return {
      status: 'needs-review',
      error: 'SpaceCloud calendar API could not be read; automatic completion and resubmit are blocked',
      verified: false,
    };
  }
  return {
    status: 'needs-review',
    error: hidden
      ? 'SpaceCloud schedule was not visible after submit verification'
      : 'SpaceCloud modal remained visible and the schedule was not created',
    verified: false,
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
      await page.locator(selector).filter({ visible: true }).first().click({ timeout: 8000 });
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

  await loadSpacecloudCalendar(page, row.roomKey);
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

export function popupDeleteVerification(popupText, row) {
  const normalized = compactText(popupText);
  const errors = [];
  const room = SPACECLOUD_ROOMS[row.roomKey];
  const startHour = hourFromSlot(row.startTime);
  const endHour = hourFromSlot(row.endTime);
  const nameKey = normalizeName(row.reserverName);
  const maskedNameKey = normalizeName(displayReserverName(row.reserverName));
  const reservationNo = String(row.reservationNo || '').trim();
  const taskId = String(row.taskId || '').trim();
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
  const escapedReservationNo = reservationNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reservationNoMatched = Boolean(
    reservationNo
    && new RegExp(`(?:naverreservationno=|예약번호[:：]?)(?:\\s*)${escapedReservationNo}(?!\\d)`, 'i').test(normalized)
  );
  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskIdMatched = Boolean(
    taskId
    && new RegExp(`taskid=${escapedTaskId}(?!\\d)`, 'i').test(normalized)
  );
  const identityMode = reservationNo
    ? row.requireTaskId && taskId ? 'reservation-number-and-task-id' : 'reservation-number'
    : 'reserver-name-fallback';
  if (reservationNo) {
    if (!reservationNoMatched) errors.push(`reservation-number-mismatch:${reservationNo}`);
  } else if (nameKey) {
    if (!nameMatched) errors.push(`reserver-name-mismatch:${nameKey}`);
  } else {
    errors.push('identity-missing');
  }
  if (row.requireTaskId && taskId && !taskIdMatched) {
    errors.push(`task-id-mismatch:${taskId}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    identity: {
      mode: identityMode,
      nameMatched,
      reservationNoMatched,
      taskIdMatched,
      nameKey,
      maskedNameKey,
      reservationNo: reservationNo || '',
      taskId,
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

export function directUploadVerificationTarget(event) {
  return {
    taskId: event.taskId || null,
    requireTaskId: Boolean(event.taskId),
    roomKey: event.roomKey,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    reserverName: event.reserverNameDisplay || event.reserverName || '',
    reservationNo: event.reservationNo || '',
  };
}

export async function uploadSpacecloudDirectReservation(context, event) {
  const retryMode = directUploadRetryMode(event);
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
    submissionAttempted: false,
    retryMode,
    resubmitBlocked: retryMode === 'verification-only',
    startedAt: new Date().toISOString(),
  };
  const ui = event.spacecloudUiInput || buildSpacecloudUiInput(event);
  let page = null;

  const dialogs = [];
  const onDialog = async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.dismiss();
  };

  try {
    page = await pageForContext(context);
    page.on('dialog', onDialog);
    await loadSpacecloudCalendar(page, event.roomKey);

    await closeModalIfOpen(page);

    if (retryMode !== 'new-submit') {
      row.preflightVerification = await verifyDirectEventCreated(page, event, {
        timeoutMs: retryMode === 'verification-only' ? 90000 : 30000,
        intervalMs: 1000,
      });
      const preflightOutcome = classifyDirectUploadVerification(true, row.preflightVerification);
      if (preflightOutcome.status === 'submitted') {
        row.status = 'submitted';
        row.alreadyPresentOnRetry = true;
        row.submissionConfirmed = true;
        row.finishedAt = new Date().toISOString();
        return row;
      }
      if (retryMode === 'verification-only') {
        row.status = 'needs-review';
        row.resubmitBlocked = true;
        row.error = 'Previous upload may have reached SpaceCloud, but its exact reservation identity was not confirmed; automatic resubmit is blocked';
        row.finishedAt = new Date().toISOString();
        return row;
      }
      if (row.preflightVerification.candidateCount > 0) {
        row.status = 'needs-review';
        row.error = 'Existing SpaceCloud schedule overlaps retry slot; exact identity did not match and automatic resubmit is blocked';
        row.resubmitBlocked = true;
        row.finishedAt = new Date().toISOString();
        return row;
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
    row.submissionAttempted = true;
    row.submitClickedAt = new Date().toISOString();
    await submit.click({ timeout: 10000 });

    const hidden = await waitHidden(page, '#start_day', 45000);
    row.postSubmitVerification = await verifyDirectEventCreated(page, event, {
      timeoutMs: 90000,
      intervalMs: 1500,
    });
    row.finishedAt = new Date().toISOString();
    if (dialogs.length > 0) row.dialogs = dialogs;
    const outcome = classifyDirectUploadVerification(hidden, row.postSubmitVerification);
    row.status = outcome.status;
    if (outcome.verified) {
      row.verifiedAfterSubmit = true;
      row.submissionConfirmed = true;
      row.verificationMode = outcome.verificationMode || 'reservation-identity';
    } else {
      row.error = outcome.error;
    }
  } catch (error) {
    row.finishedAt = new Date().toISOString();
    row.status = row.status || 'failed';
    row.error = String(error?.message || error);
    try {
      const close = page?.locator('.btn_pop_close, a.btn_close, button.btn_close').filter({ visible: true });
      if (close && await close.count() === 1) await close.click({ timeout: 3000 });
    } catch {}
  } finally {
    page?.off('dialog', onDialog);
  }

  return row;
}

export async function inspectSpacecloudDirectReservation(context, task, {
  timeoutMs = 8000,
  intervalMs = 500,
  fastTimeoutMs = 1500,
} = {}) {
  const page = await pageForContext(context);
  const event = spacecloudUploadEventFromTask(task);
  const row = {
    taskId: event.taskId,
    taskType: task.taskType || task.task_type || 'upload',
    roomKey: event.roomKey,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    reservationNo: event.reservationNo,
    startedAt: new Date().toISOString(),
  };

  try {
    row.fastVerification = await verifyDirectEventCreated(page, event, {
      timeoutMs: fastTimeoutMs,
      intervalMs: Math.min(intervalMs, 250),
      forceFreshDocument: false,
    });
    if (row.fastVerification.identityMatched) {
      row.verification = row.fastVerification;
      row.verificationMode = 'fast-identity-match';
    } else {
      row.confirmationVerification = await verifyDirectEventCreated(page, event, {
        timeoutMs,
        intervalMs,
        forceFreshDocument: true,
      });
      row.verification = row.confirmationVerification;
      row.verificationMode = 'fresh-document-confirmation';
    }
    row.status = row.verification.identityMatched
      ? 'identity-matched'
      : row.verification.candidateCount > 0
        ? 'candidate-only'
        : 'absent';
  } catch (error) {
    row.status = 'failed';
    row.error = String(error?.message || error);
  } finally {
    await closeReservationPopup(page).catch(() => {});
  }
  row.finishedAt = new Date().toISOString();
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

export async function inspectSpacecloudConfirmedReservation(context, task) {
  const page = await pageForContext(context);
  const payload = parseTaskPayload(task);
  const reservationId = spacecloudReservationIdFromTask(task);
  const row = {
    taskId: task.id || task.taskId || null,
    roomKey: task.roomKey || task.room_key || payload.roomKey || payload.room_key || '',
    date: normalizeDate(task.date || task.reservation_date || payload.date),
    startTime: slotTimeText(task.startTime || task.start_time || payload.start_time || payload.startTime),
    endTime: slotTimeText(task.endTime || task.end_time || payload.end_time || payload.endTime),
    reserverName: task.reserverName || task.reserver_name || payload.name || '',
    reservationId,
  };
  if (!reservationId) {
    return { ...row, status: 'needs-review', confirmed: false, reason: 'spacecloud-reservation-id-missing' };
  }
  try {
    await page.goto(`https://partner.spacecloud.kr/reservation/${encodeURIComponent(reservationId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(700);
    const detail = await fetchSpacecloudReservationDetail(page, reservationId);
    if (!detail.ok) {
      return {
        ...row,
        status: 'needs-review',
        confirmed: false,
        reason: detail.error || `spacecloud-detail-http-${detail.status}`,
      };
    }
    const statusCode = spacecloudReservationStatus(detail);
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    const verification = verifySpacecloudReservationText(bodyText, row, reservationId);
    const identityAccepted = spacecloudReservationIdentityAccepted(statusCode, verification);
    if (!identityAccepted) {
      return {
        ...row,
        status: 'needs-review',
        confirmed: false,
        statusCode,
        verification,
        reason: `spacecloud-winner-identity-mismatch:${verification.errors.join(',')}`,
      };
    }
    return {
      ...row,
      status: statusCode === 'RSCMP' ? 'confirmed' : statusCode === 'RCCMP' ? 'canceled' : 'needs-review',
      confirmed: statusCode === 'RSCMP',
      statusCode,
      verification: {
        ...verification,
        acceptedForCanceledStatus: verification.ok !== true,
      },
      reason: statusCode === 'RSCMP' ? '' : `spacecloud-winner-status-${statusCode || 'unknown'}`,
    };
  } catch (error) {
    return {
      ...row,
      status: 'needs-review',
      confirmed: false,
      reason: String(error?.message || error),
    };
  }
}

export async function cancelSpacecloudConfirmedReservation(context, task, {
  reasonCode = 'PRSCH',
  reasonText = '',
  beforeConfirm = null,
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
    if (typeof beforeConfirm === 'function') {
      const guard = await beforeConfirm({
        taskId: row.taskId,
        reservationId,
        roomKey: row.roomKey,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
      });
      row.cancelGuard = guard?.summary || guard || {};
      if (guard?.approved !== true) {
        row.status = guard?.retryable ? 'guard-retry-pending' : 'needs-review';
        row.error = `SpaceCloud cancellation guard blocked final confirm: ${guard?.reason || 'not-approved'}`;
        row.finishedAt = new Date().toISOString();
        await page.locator('.btn_pop_close').filter({ visible: true }).first().click({ timeout: 3000 }).catch(() => {});
        return row;
      }
    }
    row.submissionAttempted = true;
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
      row.submissionConfirmed = true;
    } else {
      row.status = 'failed';
      row.submissionConfirmed = false;
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
  if (!row.reservationNo) {
    row.status = 'needs-review';
    row.error = 'reservation number missing; automatic SpaceCloud delete is blocked';
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
    await loadSpacecloudCalendar(page, row.roomKey);
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
  const expectedUrl = /^https:\/\/partner\.spacecloud\.kr\/reservation-calendar(?:[/?#]|$)/.test(currentUrl);
  const title = await page.title().catch(() => '');
  return {
    ok: expectedUrl && addVisible,
    url: currentUrl,
    title,
    reason: expectedUrl && addVisible ? '' : 'reservation calendar URL or add button not visible; login may be required',
  };
}
