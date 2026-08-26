const NAVER_BOOKING_BUSINESS_ID = '1257912';

export const NAVER_ROOMS = {
  a: { name: 'A홀' },
  b: { name: 'B홀' },
  c: { name: 'C홀' },
  d: { name: 'D홀' },
  e: { name: 'E홀' },
};

function pageForContext(context) {
  const pages = context.pages();
  return pages[0] || context.newPage();
}

function naverCalendarUrl(businessId = NAVER_BOOKING_BUSINESS_ID) {
  return `https://partner.booking.naver.com/bizes/${businessId}/booking-calendar-view`;
}

function naverBookingListUrl(businessId = NAVER_BOOKING_BUSINESS_ID, {
  date,
} = {}) {
  const params = new URLSearchParams({
    dateDropdownType: 'DIRECT',
    startDateTime: normalizeDate(date),
    endDateTime: normalizeDate(date),
    dateFilter: 'USEDATE',
    // Naver currently ignores or inconsistently applies a reservation-number
    // query in this SPA. Load the one-day list and match the booking link
    // ourselves so a false empty search can never hide a real reservation.
    searchValueCode: 'USER_NAME',
  });
  return `https://partner.booking.naver.com/bizes/${businessId}/booking-list-view?${params}`;
}

function naverBookingDetailUrl(businessId = NAVER_BOOKING_BUSINESS_ID, reservationNo) {
  return `https://partner.booking.naver.com/bizes/${businessId}/booking-list-view/bookings/${encodeURIComponent(String(reservationNo || '').trim())}`;
}

function naverBookingDetailApiUrl(businessId = NAVER_BOOKING_BUSINESS_ID, reservationNo) {
  return `https://partner.booking.naver.com/api/businesses/${encodeURIComponent(String(businessId || '').trim())}/bookings/${encodeURIComponent(String(reservationNo || '').trim())}`;
}

function isNaverLoginUrl(value, baseUrl = 'https://partner.booking.naver.com/') {
  let hostname = '';
  try {
    hostname = new URL(String(value || ''), baseUrl).hostname.toLowerCase();
  } catch {}
  return hostname === 'nid.naver.com' || hostname.endsWith('.nid.naver.com');
}

function naverBookingCancelUrl(businessId = NAVER_BOOKING_BUSINESS_ID, reservationNo) {
  return `${naverBookingDetailUrl(businessId, reservationNo)}/cancel`;
}

function normalizeDate(value) {
  const text = String(value || '').trim().replace(/\./g, '-').replace(/\/+/g, '-').replace(/-+$/, '');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) throw new Error(`invalid date: ${value}`);
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function dateParts(value) {
  const [year, month, day] = normalizeDate(value).split('-').map(Number);
  return { year, month, day };
}

function dateIndex(value) {
  const { year, month, day } = dateParts(value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function addDays(value, days) {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return ymdFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function dayIndexForDate(value) {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function parseHour(value) {
  const text = String(value || '').trim();
  if (text === '24:00' || text === '24:00:00') return 24;
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw new Error(`invalid time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute === 59 && hour < 24) return hour + 1;
  if (minute !== 0) throw new Error(`Naver availability automation only supports whole-hour times: ${value}`);
  if (hour < 0 || hour > 23) throw new Error(`invalid hour: ${value}`);
  return hour;
}

function timeLabel(value) {
  const hour = parseHour(value);
  const normalized = hour === 24 ? 0 : hour;
  const ampm = normalized < 12 ? '오전' : '오후';
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${ampm} ${hour12}:00`;
}

function timeLabelVariants(value) {
  const hour = parseHour(value);
  const labels = [timeLabel(value)];
  if (hour === 0 || hour === 24) labels.push('자정 12:00');
  return [...new Set(labels)];
}

function compactIncludesAny(compact, values) {
  return values.some((value) => compact.includes(compactText(value)));
}

function timeTextFromHour(hour) {
  if (hour === 24) return '24:00';
  if (hour < 0 || hour > 23) throw new Error(`invalid slot hour: ${hour}`);
  return `${String(hour).padStart(2, '0')}:00`;
}

function ymdFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseWeekPeriod(text) {
  const match = String(text || '').match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2}).*?~\s*(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})/);
  if (!match) throw new Error(`Naver week period not found: ${text}`);
  const startYear = Number(match[1]);
  const startMonth = Number(match[2]);
  const startDay = Number(match[3]);
  let endYear = match[4] ? Number(match[4]) : startYear;
  const endMonth = Number(match[5]);
  const endDay = Number(match[6]);
  if (!match[4] && endMonth < startMonth) endYear += 1;
  return {
    start: ymdFromParts(startYear, startMonth, startDay),
    end: ymdFromParts(endYear, endMonth, endDay),
  };
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, '');
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
  return String(value || '').replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, (phone) => maskPhone(phone));
}

function naverBookingApiRequestFailureReason(error, timeoutMs) {
  const message = String(error?.message || error || '');
  const timeout = message.match(/Timeout\s+(\d+)ms exceeded/i);
  if (timeout) return `naver-booking-api-request-failed:Timeout ${timeout[1]}ms exceeded`;
  if (error?.name === 'TimeoutError') {
    return `naver-booking-api-request-failed:Timeout ${timeoutMs}ms exceeded`;
  }
  const transport = message.match(/\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ERR_[A-Z_]+)\b/i);
  if (transport) return `naver-booking-api-request-failed:${transport[1].toUpperCase()}`;
  return `naver-booking-api-request-failed:${String(error?.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '') || 'Error'}`;
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

async function waitSidePanelClosed(page, timeoutMs = 10000) {
  try {
    await page.waitForFunction(
      () => !document.querySelector('[class*="SideLayer__visible"]'),
      undefined,
      { timeout: timeoutMs },
    );
    return true;
  } catch (error) {
    if (error?.name === 'TimeoutError' || /Timeout\s+\d+ms exceeded/i.test(String(error?.message || error))) {
      return false;
    }
    throw error;
  }
}

async function readSelectedView(page) {
  return page.evaluate(() => {
    const button = document.querySelector('button[class*="Select__btn-selected"]');
    return (button?.innerText || button?.textContent || '').replace(/\s+/g, ' ').trim();
  });
}

export async function ensureNaverWeeklyView(page, {
  timeoutMs = 10000,
} = {}) {
  const selected = await readSelectedView(page);
  if (selected.includes('주간')) return;

  const viewButton = page.locator('button[class*="Select__btn-selected"]');
  const viewCount = await viewButton.count();
  if (viewCount !== 1) throw new Error(`Naver view selector count ${viewCount}`);
  await viewButton.click({ timeout: 8000 });

  const weekly = page.locator('a.btn-option').filter({ hasText: '주간' });
  await weekly.first().waitFor({ state: 'visible', timeout: timeoutMs });
  const weeklyCount = await weekly.count();
  if (weeklyCount !== 1) throw new Error(`Naver weekly option count ${weeklyCount}`);
  await weekly.click({ timeout: 8000 });
  await page.waitForFunction((expectedView) => {
    const button = document.querySelector('button[class*="Select__btn-selected"]');
    const text = (button?.innerText || button?.textContent || '').replace(/\s+/g, ' ').trim();
    return text.includes(expectedView);
  }, '주간', { timeout: timeoutMs });

  const after = await readSelectedView(page);
  if (!after.includes('주간')) throw new Error(`Naver weekly view did not apply: ${after}`);
}

export async function selectNaverRoom(page, roomKey, {
  timeoutMs = 10000,
} = {}) {
  const room = NAVER_ROOMS[roomKey];
  if (!room) throw new Error(`unknown Naver room key: ${roomKey}`);
  const roomButton = page.locator('button[class*="BizItemsTab__product"]').filter({ hasText: room.name });
  const count = await roomButton.count();
  if (count !== 1) throw new Error(`Naver room tab count ${count} for ${roomKey}`);
  await roomButton.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const className = await roomButton.getAttribute('class', { timeout: 5000 }).catch(() => '');
  if (!String(className || '').includes('active')) {
    await roomButton.click({ timeout: 8000 });
    await page.waitForFunction((expectedRoom) => {
      const active = document.querySelector('button[class*="BizItemsTab__active"]');
      const text = (active?.innerText || active?.textContent || '').replace(/\s+/g, ' ').trim();
      return text.includes(expectedRoom);
    }, room.name, { timeout: timeoutMs });
  }
  const activeText = await page.evaluate(() => {
    const active = document.querySelector('button[class*="BizItemsTab__active"]');
    return (active?.innerText || active?.textContent || '').replace(/\s+/g, ' ').trim();
  });
  if (!activeText.includes(room.name)) throw new Error(`Naver room did not become active: ${activeText}`);
}

async function readWeekPeriod(page) {
  const text = await page.evaluate(() => {
    const el = document.querySelector('[class*="DatePeriodCalendar__date-info"]');
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  });
  return { ...parseWeekPeriod(text), text };
}

export async function gotoNaverWeekContainingDate(page, targetDate, {
  timeoutMs = 10000,
} = {}) {
  const target = normalizeDate(targetDate);
  const targetIdx = dateIndex(target);
  for (let i = 0; i < 80; i += 1) {
    const period = await readWeekPeriod(page);
    if (dateIndex(period.start) <= targetIdx && targetIdx <= dateIndex(period.end)) return period;

    const selector = targetIdx < dateIndex(period.start)
      ? 'button[class*="DatePeriodCalendar__prev"]'
      : 'button[class*="DatePeriodCalendar__next"]';
    const button = page.locator(selector);
    const count = await button.count();
    if (count !== 1) throw new Error(`Naver week navigation button count ${count}: ${selector}`);
    await button.click({ timeout: 8000 });
    await page.waitForFunction((previousText) => {
      const el = document.querySelector('[class*="DatePeriodCalendar__date-info"]');
      const currentText = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      return Boolean(currentText && currentText !== previousText);
    }, period.text, { timeout: timeoutMs });
  }
  throw new Error(`Naver week navigation failed for ${target}`);
}

export async function scrollNaverCalendarToHour(page, hour, {
  timeoutMs = 10000,
} = {}) {
  await page.evaluate((targetHour) => {
    const rowWrap = document.querySelector('[class*="Calendar__row-wrap"]');
    const colHeader = document.querySelector('[class*="Calendar__col-header"]');
    if (!rowWrap) throw new Error('Naver calendar row wrap not found');
    const firstRow = [...rowWrap.children].find((el) => String(el.className || '').includes('Calendar__week-row'));
    const rowHeight = firstRow?.getBoundingClientRect().height || 192;
    const scrollTop = Math.max(0, (targetHour - 1) * rowHeight);
    rowWrap.scrollTop = scrollTop;
    rowWrap.dispatchEvent(new Event('scroll', { bubbles: true }));
    if (colHeader) {
      colHeader.scrollTop = scrollTop;
      colHeader.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }, hour);
  await page.waitForFunction(({ targetHour }) => {
    const rowWrap = document.querySelector('[class*="Calendar__row-wrap"]');
    if (!rowWrap) return false;
    const rows = [...rowWrap.children]
      .filter((el) => String(el.className || '').includes('Calendar__week-row'));
    const targetRow = rows[targetHour];
    if (!targetRow) return false;
    const wrapRect = rowWrap.getBoundingClientRect();
    const rowRect = targetRow.getBoundingClientRect();
    return rowRect.width > 0
      && rowRect.height > 0
      && rowRect.bottom > wrapRect.top
      && rowRect.top < wrapRect.bottom;
  }, { targetHour: hour }, { timeout: timeoutMs });
}

function readNaverWeeklySlotDom({
  wantedDay,
  wantedHour,
  wantedMarker = '',
  expectedStatus = '',
}) {
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  document.querySelectorAll('[data-rhythmjoy-target]').forEach((el) => el.removeAttribute('data-rhythmjoy-target'));
  const rowWrap = document.querySelector('[class*="Calendar__row-wrap"]');
  if (!rowWrap) {
    return expectedStatus ? false : { status: 'not_found', reason: 'row-wrap-not-found', marker: wantedMarker };
  }
  const rows = [...rowWrap.children].filter((el) => String(el.className || '').includes('Calendar__week-row'));
  const rowEl = rows[wantedHour];
  if (!rowEl) {
    return expectedStatus ? false : {
      status: 'not_found', reason: 'hour-row-not-found', marker: wantedMarker, rowCount: rows.length,
    };
  }
  const cells = [...rowEl.children].filter((el) => String(el.className || '').includes('Calendar__week-cell'));
  const cell = cells[wantedDay];
  if (!cell) {
    return expectedStatus ? false : {
      status: 'not_found', reason: 'day-cell-not-found', marker: wantedMarker, cellCount: cells.length,
    };
  }
  const domButtons = [...cell.querySelectorAll('button[class*="calendar-btn"]')];
  const buttons = domButtons.map((button, index) => {
    const rect = button.getBoundingClientRect();
    return {
      index,
      text: norm(button.innerText || button.textContent || ''),
      title: button.getAttribute('title') || '',
      className: String(button.className || ''),
      visible: rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < innerHeight
        && rect.left < innerWidth,
    };
  });
  const suspendedIndex = buttons.findIndex((button) => button.title === '예약불가' || button.className.includes('suspended'));
  const confirmedIndex = buttons.findIndex((button) => button.title === '확정' || button.className.includes('confirmed'));
  const availableIndex = buttons.findIndex((button) => button.title === '예약가능' && button.className.includes('avail'));
  const soldoutIndex = buttons.findIndex((button) => button.className.includes('soldout'));

  let status = 'unknown';
  let targetIndex = -1;
  if (confirmedIndex >= 0) {
    status = 'confirmed';
    targetIndex = confirmedIndex;
  } else if (soldoutIndex >= 0) {
    status = 'soldout';
    targetIndex = soldoutIndex;
  } else if (suspendedIndex >= 0) {
    status = 'suspended';
    targetIndex = suspendedIndex;
  } else if (availableIndex >= 0) {
    status = 'available';
    targetIndex = availableIndex;
  }

  if (expectedStatus) {
    return status === expectedStatus && targetIndex >= 0 && buttons[targetIndex]?.visible === true;
  }
  if (targetIndex >= 0 && wantedMarker) {
    domButtons[targetIndex].setAttribute('data-rhythmjoy-target', wantedMarker);
  }
  return {
    status,
    marker: wantedMarker,
    cellText: norm(cell.innerText || cell.textContent || ''),
    buttons,
  };
}

async function findWeeklySlot(page, row) {
  const date = normalizeDate(row.date);
  const wantedHour = parseHour(row.startTime);
  const wantedDay = dayIndexForDate(date);
  const wantedMarker = `rhythmjoy-target-${Date.now()}`;
  return page.evaluate(readNaverWeeklySlotDom, {
    wantedDay,
    wantedHour,
    wantedMarker,
    expectedStatus: '',
  });
}

export async function waitForNaverWeeklySlotStatus(page, row, expectedStatus, {
  timeoutMs = 12000,
} = {}) {
  const date = normalizeDate(row.date);
  const wantedHour = parseHour(row.startTime);
  const wantedDay = dayIndexForDate(date);
  await page.waitForFunction(readNaverWeeklySlotDom, {
    wantedDay,
    wantedHour,
    wantedMarker: '',
    expectedStatus,
  }, { timeout: timeoutMs });
  const slot = await findWeeklySlot(page, row);
  if (slot.status !== expectedStatus) {
    throw new Error(`Naver slot did not become ${expectedStatus}: ${JSON.stringify(compactSlot(slot))}`);
  }
  return slot;
}

export function selectNaverScheduleEditorPanel(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  return rows
    .filter((candidate) => candidate?.visible)
    .filter((candidate) => Number(candidate.formGroupCount || 0) >= 2)
    .filter((candidate) => Number(candidate.saveButtonCount || 0) === 1)
    .sort((left, right) => String(right.text || '').length - String(left.text || '').length)[0] || null;
}

async function verifySchedulePanel(page, row, expectedStatus) {
  const room = NAVER_ROOMS[row.roomKey];
  const date = normalizeDate(row.date);
  const dateText = `${dateParts(date).year}.${dateParts(date).month}.${dateParts(date).day}`;
  const startTexts = timeLabelVariants(row.startTime);
  const endTexts = timeLabelVariants(row.endTime);
  const panelCandidates = await page.evaluate(() => [...document.querySelectorAll('[class*="SideLayer__visible"]')]
    .map((side) => {
      const rect = side.getBoundingClientRect();
      const buttons = [...side.querySelectorAll('button')];
      return {
        visible: rect.width > 0 && rect.height > 0,
        text: (side.innerText || side.textContent || '').replace(/\s+/g, ' ').trim(),
        formGroupCount: side.querySelectorAll('.form-group').length,
        saveButtonCount: buttons.filter((button) => (
          (button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim() === '설정변경'
        )).length,
      };
    }));
  const selectedPanel = selectNaverScheduleEditorPanel(panelCandidates);
  const panel = selectedPanel?.text || '';
  const compact = compactText(panel);
  const errors = [];
  if (!selectedPanel) errors.push('editor-panel');
  if (!compact.includes(compactText(room.name))) errors.push(`room:${room.name}`);
  if (!compact.includes(compactText(dateText))) errors.push(`date:${dateText}`);
  if (!compactIncludesAny(compact, startTexts)) errors.push(`start:${startTexts[0]}`);
  if (!compactIncludesAny(compact, endTexts)) errors.push(`end:${endTexts[0]}`);
  if (expectedStatus && !compact.includes(compactText(expectedStatus))) errors.push(`status:${expectedStatus}`);
  return {
    ok: errors.length === 0,
    errors,
    textPreview: panel.slice(0, 500),
    panelCandidateCount: panelCandidates.length,
    selectedFormGroupCount: selectedPanel?.formGroupCount || 0,
    selectedSaveButtonCount: selectedPanel?.saveButtonCount || 0,
  };
}

export async function waitForNaverSchedulePanelIdentity(page, row, expectedStatus, {
  timeoutMs = 10000,
} = {}) {
  const room = NAVER_ROOMS[row.roomKey];
  if (!room) throw new Error(`unknown Naver room key: ${row.roomKey}`);
  const date = normalizeDate(row.date);
  const expected = {
    roomName: room.name,
    dateText: `${dateParts(date).year}.${dateParts(date).month}.${dateParts(date).day}`,
    startTexts: timeLabelVariants(row.startTime),
    endTexts: timeLabelVariants(row.endTime),
    expectedStatus: String(expectedStatus || ''),
  };
  let timedOut = false;
  try {
    await page.waitForFunction((wanted) => {
      const compact = (value) => String(value || '').replace(/\s+/g, '');
      const includesAny = (text, values) => values.some((value) => text.includes(compact(value)));
      return [...document.querySelectorAll('[class*="SideLayer__visible"]')]
        .filter((side) => {
          const rect = side.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .filter((side) => side.querySelectorAll('.form-group').length >= 2)
        .filter((side) => [...side.querySelectorAll('button')].filter((button) => (
          String(button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim() === '설정변경'
        )).length === 1)
        .some((side) => {
          const text = compact(side.innerText || side.textContent || '');
          return text.includes(compact(wanted.roomName))
            && text.includes(compact(wanted.dateText))
            && includesAny(text, wanted.startTexts)
            && includesAny(text, wanted.endTexts)
            && (!wanted.expectedStatus || text.includes(compact(wanted.expectedStatus)));
        });
    }, expected, { timeout: timeoutMs });
  } catch (error) {
    if (error?.name === 'TimeoutError' || /Timeout\s+\d+ms exceeded/i.test(String(error?.message || error))) {
      timedOut = true;
    } else {
      throw error;
    }
  }
  return {
    ...await verifySchedulePanel(page, row, expectedStatus),
    timedOut,
    waitMode: 'exact-editor-identity',
  };
}

async function inspectScheduleEditorContext(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const groups = [...document.querySelectorAll('.form-group')]
      .filter(visible)
      .map((group, index) => ({
        index,
        text: norm(group.innerText || group.textContent || '').slice(0, 300),
        buttons: [...group.querySelectorAll('button')].filter(visible).map((button) => ({
          text: norm(button.innerText || button.textContent || ''),
          className: String(button.className || ''),
          title: button.getAttribute('title') || '',
        })),
      }));
    const sideLayers = [...document.querySelectorAll('[class*="SideLayer__visible"]')]
      .filter(visible)
      .map((side) => norm(side.innerText || side.textContent || '').slice(0, 500));
    const saveButtons = [...document.querySelectorAll('button')]
      .filter((button) => visible(button) && norm(button.innerText || button.textContent || '') === '설정변경')
      .map((button) => ({
        text: norm(button.innerText || button.textContent || ''),
        className: String(button.className || ''),
      }));
    return { groups, sideLayers, saveButtons };
  });
}

function readNaverScheduleFormButtonDom({
  groupLabel,
  buttonIndex,
  marker = '',
  expectedTexts = [],
}) {
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const waitingForValue = expectedTexts.length > 0;
  if (marker) {
    document.querySelectorAll('[data-rhythmjoy-form-target]')
      .forEach((el) => el.removeAttribute('data-rhythmjoy-form-target'));
  }
  const groups = [...document.querySelectorAll('.form-group')];
  const group = groups.find((el) => norm(el.innerText || el.textContent || '').includes(groupLabel));
  if (!group) return waitingForValue ? false : { ok: false, reason: `form group not found: ${groupLabel}` };
  const buttons = [...group.querySelectorAll('button.form-control')];
  const button = buttons[buttonIndex];
  if (!button) {
    return waitingForValue ? false : {
      ok: false,
      reason: `button ${buttonIndex} not found in ${groupLabel}`,
      buttonCount: buttons.length,
    };
  }
  if (marker) button.setAttribute('data-rhythmjoy-form-target', marker);
  const text = norm(button.innerText || button.textContent || '');
  return waitingForValue ? expectedTexts.includes(text) : { ok: true, text };
}

export async function selectNaverScheduleFormButton(page, groupLabel, buttonIndex, targetText, {
  timeoutMs = 10000,
} = {}) {
  const targetTexts = Array.isArray(targetText) ? targetText : [targetText];
  const marker = `rhythmjoy-form-${Date.now()}-${buttonIndex}`;
  const current = await page.evaluate(readNaverScheduleFormButtonDom, {
    groupLabel,
    buttonIndex,
    marker,
    expectedTexts: [],
  });

  if (!current.ok) throw new Error(current.reason);
  if (targetTexts.includes(current.text)) return { changed: false, value: current.text };

  const button = page.locator(`button[data-rhythmjoy-form-target="${marker}"]`);
  const buttonCount = await button.count();
  if (buttonCount !== 1) throw new Error(`form target button count ${buttonCount}`);
  await button.click({ timeout: 8000 });
  await page.waitForFunction((wantedTexts) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('div.selectbox-list button.btn-select')]
      .filter((option) => {
        const rect = option.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .some((option) => wantedTexts.includes(norm(option.innerText || option.textContent || '')));
  }, targetTexts, { timeout: timeoutMs });

  let selected = null;
  for (const optionText of targetTexts) {
    const option = page.locator('div.selectbox-list:visible button.btn-select').filter({ hasText: optionText });
    const optionCount = await option.count();
    if (optionCount === 1) {
      await option.click({ timeout: 8000 });
      selected = optionText;
      break;
    }
    if (optionCount > 1) throw new Error(`select option count ${optionCount} for ${optionText}`);
  }
  if (!selected) throw new Error(`select option count 0 for ${targetTexts.join(' | ')}`);
  await page.waitForFunction(readNaverScheduleFormButtonDom, {
    groupLabel,
    buttonIndex,
    marker: '',
    expectedTexts: targetTexts,
  }, { timeout: timeoutMs });
  const after = await page.evaluate(readNaverScheduleFormButtonDom, {
    groupLabel,
    buttonIndex,
    marker: '',
    expectedTexts: [],
  });
  if (!after.ok || !targetTexts.includes(after.text)) {
    throw new Error(`Naver form selection did not apply for ${groupLabel}[${buttonIndex}]: ${after.text || after.reason || ''}`);
  }
  return { changed: true, value: after.text };
}

export async function saveNaverSchedule(page, {
  timeoutMs = 12000,
} = {}) {
  const dialogTypes = [];
  const onDialog = async (dialog) => {
    dialogTypes.push(dialog.type());
    if (dialog.type() === 'confirm' || dialog.type() === 'alert') await dialog.accept();
    else await dialog.dismiss();
  };
  page.on('dialog', onDialog);
  try {
    const save = page.locator('button').filter({ hasText: '설정변경' });
    const saveCount = await save.count();
    if (saveCount !== 1) throw new Error(`Naver save button count ${saveCount}`);
    await save.click({ timeout: 10000 });
    const panelClosed = await waitSidePanelClosed(page, timeoutMs);
    if (!panelClosed) {
      throw new Error('Naver schedule editor did not close after save; modal still visible after submit');
    }
    return { dialogTypes, panelClosed };
  } finally {
    page.off('dialog', onDialog);
  }
}

function taskRow(task) {
  return {
    taskId: task.id || task.taskId || null,
    roomKey: task.roomKey || task.room_key,
    date: normalizeDate(task.date || task.reservation_date),
    startTime: task.startTime || task.start_time,
    endTime: task.endTime || task.end_time,
    reserverName: task.reserverName || task.reserver_name || '',
    reservationNo: task.reservationNo || task.reservation_number || '',
    product: task.product || '',
  };
}

export function buildHourlySlotRows(row) {
  const startHour = parseHour(row.startTime);
  const endHour = parseHour(row.endTime);
  const rows = [];
  const pushHours = (date, fromHour, toHour) => {
    for (let hour = fromHour; hour < toHour; hour += 1) {
      rows.push({
        ...row,
        date,
        startTime: timeTextFromHour(hour),
        endTime: timeTextFromHour(hour + 1),
        slotIndex: rows.length + 1,
      });
    }
  };

  if (startHour === endHour) {
    if (startHour !== 0) {
      throw new Error(`zero-duration Naver availability range is not supported: ${row.startTime}-${row.endTime}`);
    }
    pushHours(row.date, 0, 24);
  } else if (endHour > startHour) {
    pushHours(row.date, startHour, endHour);
  } else {
    pushHours(row.date, startHour, 24);
    if (endHour > 0) pushHours(addDays(row.date, 1), 0, endHour);
  }

  if (rows.length === 0) {
    throw new Error(`empty Naver availability slot range: ${row.date} ${row.startTime}-${row.endTime}`);
  }
  if (rows.length > 48) {
    throw new Error(`Naver availability range is too large for one automatic task: ${rows.length} hours`);
  }
  return rows;
}

function naverSlotStartMs(slotRow) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(slotRow?.date || ''));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(slotRow?.startTime || ''));
  if (!dateMatch || !timeMatch) {
    throw new Error(`invalid Naver slot start: ${slotRow?.date || '-'} ${slotRow?.startTime || '-'}`);
  }
  return Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]) - 9,
    Number(timeMatch[2]),
  );
}

export function partitionNaverActionableSlotRows(slotRows, { now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error(`invalid current time: ${now}`);

  const actionable = [];
  const inactiveStarted = [];
  for (const slotRow of slotRows) {
    if (naverSlotStartMs(slotRow) <= nowMs) inactiveStarted.push(slotRow);
    else actionable.push(slotRow);
  }
  return { actionable, inactiveStarted };
}

function compactSlot(slot) {
  return {
    status: slot?.status || 'unknown',
    reason: slot?.reason || '',
    cellText: String(slot?.cellText || '').slice(0, 160),
    buttons: (slot?.buttons || []).map((button) => ({
      text: String(button.text || '').slice(0, 40),
      title: button.title || '',
      visible: !!button.visible,
    })),
  };
}

function verifyNaverReservationText(text, row, reservationNo) {
  const room = NAVER_ROOMS[row.roomKey];
  const date = normalizeDate(row.date);
  const { year, month, day } = dateParts(date);
  const dateText = `${year}.${month}.${day}`;
  const compact = compactText(text);
  const errors = [];
  if (reservationNo && !compact.includes(compactText(reservationNo))) errors.push(`reservation-number:${reservationNo}`);
  if (room?.name && !compact.includes(compactText(room.name))) errors.push(`room:${room.name}`);
  if (!compact.includes(compactText(dateText))) errors.push(`date:${dateText}`);
  if (!compactIncludesAny(compact, timeLabelVariants(row.startTime))) errors.push(`start:${timeLabel(row.startTime)}`);
  if (!compactIncludesAny(compact, timeLabelVariants(row.endTime))) errors.push(`end:${timeLabel(row.endTime)}`);
  return { ok: errors.length === 0, errors, textPreview: redactPhone(text).replace(/\s+/g, ' ').slice(0, 500) };
}

export function classifyNaverCancelPanelText(text, row, reservationNo) {
  const verification = verifyNaverReservationText(text, row, reservationNo);
  const compact = compactText(text);
  const loading = /로딩(?:중)?|불러오는중|loading/i.test(compact);
  const ready = verification.ok && !loading;
  return {
    ...verification,
    identityOk: verification.ok,
    ok: ready,
    loading,
    state: loading ? 'loading' : (ready ? 'ready' : 'mismatch'),
  };
}

export function selectNaverCancelPanelText(snapshot, reservationNo) {
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const wanted = norm(reservationNo);
  const longest = (values) => values
    .map(norm)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || '';
  const sideLayers = Array.isArray(snapshot?.sideLayers) ? snapshot.sideLayers : [];
  const matchingSideLayers = sideLayers.filter((text) => norm(text).includes(wanted));
  if (matchingSideLayers.length) return longest(matchingSideLayers);
  if (sideLayers.length) return longest(sideLayers);

  const reservationContainers = Array.isArray(snapshot?.reservationContainers)
    ? snapshot.reservationContainers
    : [];
  const matchingContainers = reservationContainers.filter((text) => norm(text).includes(wanted));
  if (matchingContainers.length) return longest(matchingContainers);
  return norm(snapshot?.bodyText);
}

async function readNaverBookingPanelText(page, reservationNo) {
  const snapshot = await page.evaluate((wantedReservationNo) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visibleText = (selector) => Array.from(document.querySelectorAll(selector))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: norm(el.innerText || el.textContent || ''),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((item) => item.visible && item.text)
      .map((item) => item.text);
    return {
      sideLayers: visibleText('[class*="SideLayer__visible"]'),
      reservationContainers: visibleText('div,section,article,aside,form')
        .filter((text) => text.includes(wantedReservationNo)),
      bodyText: norm(document.body?.innerText || document.body?.textContent || ''),
    };
  }, String(reservationNo || '').trim());
  return selectNaverCancelPanelText(snapshot, reservationNo);
}

export async function waitForNaverCancelPanelIdentity(page, row, reservationNo, {
  timeoutMs = 20000,
  pollMs = 300,
} = {}) {
  const started = Date.now();
  let loadingObserved = false;
  let panelText = '';
  let verification = classifyNaverCancelPanelText(panelText, row, reservationNo);

  while (true) {
    panelText = await readNaverBookingPanelText(page, reservationNo);
    verification = classifyNaverCancelPanelText(panelText, row, reservationNo);
    loadingObserved = loadingObserved || verification.loading;
    const waitedMs = Date.now() - started;
    if (verification.ok) {
      return {
        panelText,
        verification,
        state: 'ready',
        loadingObserved,
        timedOut: false,
        waitedMs,
      };
    }
    if (waitedMs >= timeoutMs) {
      return {
        panelText,
        verification,
        state: verification.loading ? 'loading-timeout' : 'mismatch',
        loadingObserved,
        timedOut: true,
        waitedMs,
      };
    }
    await page.waitForTimeout(Math.min(pollMs, Math.max(1, timeoutMs - waitedMs)));
  }
}

async function readNaverReservationStatusFromList(page, reservationNo) {
  return page.evaluate((wantedReservationNo) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const anchors = Array.from(document.querySelectorAll('a[href*="booking-list-view/bookings/"]'));
    const anchor = anchors.find((a) => {
      const href = a.getAttribute('href') || '';
      const text = norm(a.innerText || a.textContent || '');
      return href.includes(`/bookings/${wantedReservationNo}`) || text.includes(wantedReservationNo);
    });
    if (!anchor) return { status: 'not_found', text: '' };
    const text = norm(anchor.innerText || anchor.textContent || '');
    const status = text.match(/^(확정|취소|완료|신청|노쇼)/)?.[1] || '';
    return { status: status || 'unknown', text };
  }, String(reservationNo || '').trim());
}

// Naver's owner SPA defines these bookingStatusCode values. RC06 is a
// cancellation caused by changing a booking and must keep the same destructive
// side-effect guard as an ordinary cancellation (RC04).
const NAVER_RESERVATION_STATUS_BY_CODE = Object.freeze({
  RC02: '신청',
  RC03: '확정',
  RC04: '취소',
  RC05: '노쇼',
  RC06: '취소',
  RC08: '완료',
});

async function fetchExactNaverBookingDetail(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  timeoutMs = 15000,
} = {}) {
  const row = taskRow(task);
  const reservationNo = String(row.reservationNo || task.reservation_number || '').trim();
  const normalizedBusinessId = String(businessId || '').trim();
  const base = {
    source: 'naver-booking-api',
    reservationNo,
  };
  if (!reservationNo) {
    return { ...base, status: 'not_found', reason: 'naver-reservation-number-missing' };
  }
  if (!row.date) {
    return { ...base, status: 'not_found', reason: 'naver-reservation-date-missing' };
  }
  if (!normalizedBusinessId) {
    return { ...base, status: 'not_found', reason: 'naver-business-id-missing' };
  }

  let response;
  try {
    response = await context.request.fetch(
      naverBookingDetailApiUrl(normalizedBusinessId, reservationNo),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json; charset=UTF-8',
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Booking-Naver-Role': 'OWNER',
        },
        failOnStatusCode: false,
        maxRedirects: 0,
        timeout: timeoutMs,
      },
    );
  } catch (error) {
    return {
      ...base,
      status: 'unavailable',
      reason: naverBookingApiRequestFailureReason(error, timeoutMs),
    };
  }

  const apiStatus = response.status();
  const redirectLocation = response.headers().location || '';
  const finish = async (result) => {
    if (typeof response.dispose === 'function') await response.dispose().catch(() => {});
    return result;
  };
  if ([401, 403].includes(apiStatus)
    || ([301, 302, 303, 307, 308].includes(apiStatus) && isNaverLoginUrl(redirectLocation))) {
    return finish({
      ...base,
      status: 'login_required',
      reason: 'naver-login-required',
      source: 'naver-login',
      apiStatus,
    });
  }
  if (apiStatus === 404) {
    return finish({
      ...base,
      status: 'not_found',
      reason: 'naver-reservation-not-found',
      apiStatus,
    });
  }
  if (apiStatus < 200 || apiStatus >= 300) {
    return finish({
      ...base,
      status: 'unavailable',
      reason: `naver-booking-api-http-${apiStatus}`,
      apiStatus,
    });
  }

  let detail;
  try {
    detail = await response.json();
  } catch {
    return finish({
      ...base,
      status: 'unavailable',
      reason: 'naver-booking-api-invalid-json',
      apiStatus,
    });
  }

  const detailReservationNo = String(detail?.bookingId || '').trim();
  const detailBusinessId = String(detail?.businessId || '').trim();
  const detailDate = String(detail?.startDate || '').trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
  if (detailReservationNo !== reservationNo
    || detailBusinessId !== normalizedBusinessId
    || detailDate !== row.date) {
    return finish({
      ...base,
      status: 'not_found',
      reason: 'naver-booking-api-identity-mismatch',
      apiStatus,
    });
  }

  return finish({
    ...base,
    status: 'found',
    reason: '',
    apiStatus,
    detail,
  });
}

export async function inspectNaverReservationStatus(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  timeoutMs = 15000,
} = {}) {
  const booking = await fetchExactNaverBookingDetail(context, task, { businessId, timeoutMs });
  if (booking.status !== 'found') {
    return {
      status: booking.status,
      exists: false,
      reservationNo: booking.reservationNo,
      reason: booking.reason || '',
      source: booking.source,
      ...(booking.apiStatus ? { apiStatus: booking.apiStatus } : {}),
    };
  }

  const bookingStatusCode = String(booking.detail?.bookingStatusCode || '').trim();
  const status = NAVER_RESERVATION_STATUS_BY_CODE[bookingStatusCode] || 'needs_review';
  const reason = status === 'needs_review'
    ? (bookingStatusCode
      ? `naver-booking-status-unsupported:${bookingStatusCode}`
      : 'naver-booking-status-missing')
    : '';
  return {
    status,
    exists: status !== '취소',
    reservationNo: booking.reservationNo,
    reason,
    source: booking.source,
    apiStatus: booking.apiStatus,
    bookingStatusCode,
  };
}

function successStatusesForTarget(targetStatus) {
  if (targetStatus === 'unavailable') return {
    desired: 'suspended',
    already: 'already-blocked',
    changed: 'blocked',
    expectedPanelStatus: '예약가능',
    formStatus: '예약불가',
  };
  if (targetStatus === 'available') return {
    desired: 'available',
    already: 'already-available',
    changed: 'restored',
    expectedPanelStatus: '예약불가',
    formStatus: '예약가능',
  };
  throw new Error(`unsupported target status: ${targetStatus}`);
}

async function prepareCalendar(page, row, { businessId = NAVER_BOOKING_BUSINESS_ID } = {}) {
  const url = naverCalendarUrl(businessId);
  if (!page.url().startsWith(url)) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  if (!(await waitVisible(page, 'button[class*="Select__btn-selected"]', 20000))) {
    throw new Error('Naver SmartPlace calendar not visible; login may be required');
  }
  await ensureNaverWeeklyView(page);
  await selectNaverRoom(page, row.roomKey);
  await gotoNaverWeekContainingDate(page, row.date);
  await scrollNaverCalendarToHour(page, parseHour(row.startTime));
}

async function applyOneNaverAvailabilitySlot(page, slotRow, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  targetStatus = 'unavailable',
} = {}) {
  const meta = successStatusesForTarget(targetStatus);
  const result = {
    date: slotRow.date,
    startTime: slotRow.startTime,
    endTime: slotRow.endTime,
    slotIndex: slotRow.slotIndex,
  };

  await prepareCalendar(page, slotRow, { businessId });
  let slot = await findWeeklySlot(page, slotRow);
  result.beforeSlot = compactSlot(slot);

  if (targetStatus === 'unavailable') {
    if (slot.status === meta.desired) {
      result.status = meta.already;
      return result;
    }
    if (slot.status === 'confirmed' || slot.status === 'soldout') {
      result.status = 'naver-conflict';
      result.error = `Naver slot is ${slot.status}; Naver reservation takes priority`;
      return result;
    }
    if (slot.status !== 'available') {
      result.status = 'needs-review';
      result.error = `Naver slot is not available: ${JSON.stringify(compactSlot(slot))}`;
      return result;
    }
  } else if (targetStatus === 'available') {
    if (slot.status === meta.desired) {
      result.status = meta.already;
      return result;
    }
    if (slot.status !== 'suspended') {
      result.status = 'needs-review';
      result.error = `Naver slot is ${slot.status}; automatic restore only changes 예약불가 slots`;
      return result;
    }
  }

  const target = page.locator(`button[data-rhythmjoy-target="${slot.marker}"]`);
  const targetCount = await target.count();
  if (targetCount !== 1) throw new Error(`Naver target button count ${targetCount}`);
  await target.click({ timeout: 10000 });

  const verification = await waitForNaverSchedulePanelIdentity(page, slotRow, meta.expectedPanelStatus);
  result.panelVerification = verification;
  if (!verification.ok) {
    result.status = 'needs-review';
    result.error = `Naver panel verification failed: ${verification.errors.join(', ')}`;
    return result;
  }

  await selectNaverScheduleFormButton(page, '적용시간', 0, timeLabelVariants(slotRow.startTime));
  await selectNaverScheduleFormButton(page, '적용시간', 1, timeLabelVariants(slotRow.endTime));
  await selectNaverScheduleFormButton(page, '예약상태', 0, meta.formStatus);
  result.save = await saveNaverSchedule(page);
  await scrollNaverCalendarToHour(page, parseHour(slotRow.startTime));
  slot = await waitForNaverWeeklySlotStatus(page, slotRow, meta.desired);
  result.afterSlot = compactSlot(slot);

  if (slot.status !== meta.desired) {
    throw new Error(`Naver slot did not become ${meta.formStatus}: ${JSON.stringify(compactSlot(slot))}`);
  }

  result.status = meta.changed;
  return result;
}

export async function setNaverAvailability(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  targetStatus = 'unavailable',
} = {}) {
  const page = await pageForContext(context);
  const row = {
    ...taskRow(task),
    targetStatus,
    startedAt: new Date().toISOString(),
  };

  if (!NAVER_ROOMS[row.roomKey]) {
    row.status = 'needs-review';
    row.error = `unknown room key: ${row.roomKey}`;
    row.finishedAt = new Date().toISOString();
    return row;
  }

  try {
    const meta = successStatusesForTarget(targetStatus);
    const requestedSlotRows = buildHourlySlotRows(row);
    const { actionable: slotRows, inactiveStarted } = partitionNaverActionableSlotRows(requestedSlotRows);
    row.requestedSlotCount = requestedSlotRows.length;
    row.skippedStartedSlotCount = inactiveStarted.length;
    row.skippedStartedSlots = inactiveStarted.map((slotRow) => ({
      date: slotRow.date,
      startTime: slotRow.startTime,
      endTime: slotRow.endTime,
      slotIndex: slotRow.slotIndex,
      status: 'skipped-started-slot',
      reason: 'Naver disables availability editing after the slot start time',
    }));
    row.slotRows = slotRows.map((slotRow) => ({
      date: slotRow.date,
      startTime: slotRow.startTime,
      endTime: slotRow.endTime,
      slotIndex: slotRow.slotIndex,
    }));
    row.slotCount = slotRows.length;
    row.beforeSlots = [];

    if (slotRows.length === 0) {
      row.appliedSlots = [];
      row.changedSlotCount = 0;
      row.alreadySlotCount = 0;
      row.status = 'elapsed-no-action';
      row.reason = 'All requested Naver slots already started and are no longer editable';
      row.finishedAt = new Date().toISOString();
      return row;
    }

    for (const slotRow of slotRows) {
      await prepareCalendar(page, slotRow, { businessId });
      const slot = await findWeeklySlot(page, slotRow);
      const inspection = {
        date: slotRow.date,
        startTime: slotRow.startTime,
        endTime: slotRow.endTime,
        slotIndex: slotRow.slotIndex,
        slot: compactSlot(slot),
      };
      row.beforeSlots.push(inspection);

      if (targetStatus === 'unavailable') {
        if (slot.status === 'confirmed' || slot.status === 'soldout') {
          row.status = 'naver-conflict';
          row.error = `Naver slot is ${slot.status}; Naver reservation takes priority: ${slotRow.date} ${slotRow.startTime}-${slotRow.endTime}`;
          row.finishedAt = new Date().toISOString();
          return row;
        }
        if (!['available', meta.desired].includes(slot.status)) {
          row.status = 'needs-review';
          row.error = `Naver slot is not available or already blocked: ${slotRow.date} ${slotRow.startTime}-${slotRow.endTime} ${JSON.stringify(compactSlot(slot))}`;
          row.finishedAt = new Date().toISOString();
          return row;
        }
      } else if (targetStatus === 'available') {
        if (!['suspended', meta.desired].includes(slot.status)) {
          row.status = 'needs-review';
          row.error = `Naver slot is ${slot.status}; automatic restore only changes 예약불가 slots: ${slotRow.date} ${slotRow.startTime}-${slotRow.endTime}`;
          row.finishedAt = new Date().toISOString();
          return row;
        }
      }
    }

    row.appliedSlots = [];
    for (const slotRow of slotRows) {
      const result = await applyOneNaverAvailabilitySlot(page, slotRow, { businessId, targetStatus });
      row.appliedSlots.push(result);
      if (result.status === 'naver-conflict' || result.status === 'needs-review') {
        row.status = result.status;
        row.error = result.error;
        row.finishedAt = new Date().toISOString();
        return row;
      }
    }

    row.changedSlotCount = row.appliedSlots.filter((slot) => slot.status === meta.changed).length;
    row.alreadySlotCount = row.appliedSlots.filter((slot) => slot.status === meta.already).length;
    row.status = row.changedSlotCount > 0 ? meta.changed : meta.already;
    row.finishedAt = new Date().toISOString();
    return row;
  } catch (error) {
    row.status = row.status || 'failed';
    row.error = String(error?.message || error);
    row.finishedAt = new Date().toISOString();
    return row;
  }
}

export async function inspectNaverAvailability(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
} = {}) {
  const page = await pageForContext(context);
  const row = {
    ...taskRow(task),
    taskType: task.taskType || task.task_type || 'naver_block',
    startedAt: new Date().toISOString(),
    slots: [],
  };

  try {
    const requestedSlotRows = buildHourlySlotRows(row);
    const { actionable: slotRows, inactiveStarted } = partitionNaverActionableSlotRows(requestedSlotRows);
    row.requestedSlotCount = requestedSlotRows.length;
    row.skippedStartedSlotCount = inactiveStarted.length;
    row.skippedStartedSlots = inactiveStarted.map((slotRow) => ({
      date: slotRow.date,
      startTime: slotRow.startTime,
      endTime: slotRow.endTime,
      slotIndex: slotRow.slotIndex,
      status: 'skipped-started-slot',
      reason: 'Naver disables availability inspection after the slot start time',
    }));
    if (slotRows.length === 0) {
      row.status = 'elapsed-no-action';
      row.reason = 'All requested Naver slots already started and are no longer inspectable';
      return row;
    }
    for (const slotRow of slotRows) {
      await prepareCalendar(page, slotRow, { businessId });
      const slot = await findWeeklySlot(page, slotRow);
      row.slots.push({
        date: slotRow.date,
        startTime: slotRow.startTime,
        endTime: slotRow.endTime,
        status: slot.status,
        slot: compactSlot(slot),
      });
    }
    row.status = 'inspected';
  } catch (error) {
    row.status = 'failed';
    row.error = String(error?.message || error);
  }
  row.finishedAt = new Date().toISOString();
  return row;
}

export async function inspectNaverAvailabilityEditor(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
} = {}) {
  const page = await pageForContext(context);
  const row = taskRow(task);
  const slots = buildHourlySlotRows(row);
  if (slots.length !== 1) throw new Error(`editor inspection requires one hourly slot, got ${slots.length}`);
  const slotRow = slots[0];
  await prepareCalendar(page, slotRow, { businessId });
  const slot = await findWeeklySlot(page, slotRow);
  const target = page.locator(`button[data-rhythmjoy-target="${slot.marker}"]`);
  const targetCount = await target.count();
  if (targetCount !== 1) throw new Error(`Naver target button count ${targetCount}`);
  await target.click({ timeout: 10000 });
  const expectedStatus = slot.status === 'suspended' ? '예약불가' : '예약가능';
  return {
    taskId: row.taskId,
    roomKey: row.roomKey,
    date: slotRow.date,
    startTime: slotRow.startTime,
    endTime: slotRow.endTime,
    slot: compactSlot(slot),
    panelVerification: await waitForNaverSchedulePanelIdentity(page, slotRow, expectedStatus),
    editor: await inspectScheduleEditorContext(page),
  };
}

export async function fetchNaverReservationPhone(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  timeoutMs = 15000,
} = {}) {
  const booking = await fetchExactNaverBookingDetail(context, task, { businessId, timeoutMs });
  if (booking.status !== 'found') {
    return {
      status: booking.status,
      reason: booking.reason || '',
      phone: '',
      maskedPhone: '',
      source: booking.source,
      reservationNo: booking.reservationNo,
      ...(booking.apiStatus ? { apiStatus: booking.apiStatus } : {}),
    };
  }

  const phone = normalizePhone(booking.detail?.phone);
  if (/^01[016789]\d{7,8}$/.test(phone)) {
    return {
      status: 'found',
      phone,
      maskedPhone: maskPhone(phone),
      source: booking.source,
      reservationNo: booking.reservationNo,
      apiStatus: booking.apiStatus,
    };
  }
  return {
    status: 'not_found',
    reason: 'naver-phone-not-visible',
    phone: '',
    maskedPhone: '',
    source: booking.source,
    reservationNo: booking.reservationNo,
    apiStatus: booking.apiStatus,
  };
}

export async function cancelNaverConfirmedReservation(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  refundType = 'ALL',
  beforeConfirm = null,
} = {}) {
  const page = await pageForContext(context);
  const row = {
    ...taskRow(task),
    taskType: task.taskType || task.task_type || 'naver_cancel',
    startedAt: new Date().toISOString(),
  };
  const reservationNo = row.reservationNo || task.reservation_number || '';
  if (!reservationNo) {
    row.status = 'needs-review';
    row.error = 'Naver reservation number missing; cannot cancel confirmed reservation';
    row.finishedAt = new Date().toISOString();
    return row;
  }

  try {
    const phoneLookup = await fetchNaverReservationPhone(context, task, { businessId });
    row.maskedPhone = phoneLookup.maskedPhone || '';
    if (phoneLookup.status !== 'found' || !/^01[016789]\d{7,8}$/.test(phoneLookup.phone || '')) {
      row.status = 'needs-review';
      row.error = phoneLookup.reason || phoneLookup.status || 'recipient phone missing; cancellation blocked before Naver cancel click';
      row.finishedAt = new Date().toISOString();
      return row;
    }
    Object.defineProperty(row, 'phone', { value: phoneLookup.phone, enumerable: false });

    const listStatus = await readNaverReservationStatusFromList(page, reservationNo).catch(() => null);
    if (listStatus?.status === '취소') {
      row.status = 'already-canceled';
      row.finishedAt = new Date().toISOString();
      return row;
    }

    await page.goto(naverBookingCancelUrl(businessId, reservationNo), { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!(await waitVisible(page, '[class*="SideLayer__visible"]', 20000))) {
      throw new Error('Naver cancel panel not visible; login may be required');
    }
    const panelRead = await waitForNaverCancelPanelIdentity(page, row, reservationNo, { timeoutMs: 20000 });
    const panelText = panelRead.panelText;
    row.cancelPanelVerification = {
      ...panelRead.verification,
      state: panelRead.state,
      loadingObserved: panelRead.loadingObserved,
      timedOut: panelRead.timedOut,
      waitedMs: panelRead.waitedMs,
    };
    if (!row.cancelPanelVerification.ok) {
      if (panelRead.state === 'loading-timeout') {
        row.status = 'failed';
        row.error = 'Naver cancel panel load Timeout 20000ms exceeded while still loading; no cancel click attempted';
      } else {
        row.status = 'needs-review';
        row.error = `Naver cancel panel verification failed after loading completed: ${row.cancelPanelVerification.errors.join(', ')}`;
      }
      row.finishedAt = new Date().toISOString();
      return row;
    }
    if (!compactText(panelText).includes(compactText('확정'))) {
      row.status = compactText(panelText).includes(compactText('취소')) ? 'already-canceled' : 'needs-review';
      row.error = row.status === 'needs-review' ? 'Naver reservation is not confirmed in cancel panel' : '';
      row.finishedAt = new Date().toISOString();
      return row;
    }

    if (refundType === 'ALL') {
      const refundAll = page.locator('#refundTypeAll').filter({ visible: true });
      if (await refundAll.count() !== 1) throw new Error('Naver full-refund radio not visible');
      await refundAll.first().check({ timeout: 8000 });
      const checked = await refundAll.first().isChecked({ timeout: 3000 });
      if (!checked) throw new Error('Naver full-refund radio did not become checked');
      row.refundType = 'ALL';
    }

    const dialogTypes = [];
    const onDialog = async (dialog) => {
      dialogTypes.push(dialog.type());
      if (dialog.type() === 'confirm' || dialog.type() === 'alert') await dialog.accept();
      else await dialog.dismiss();
    };
    page.on('dialog', onDialog);
    try {
      const cancelButton = page.locator('[class*="SideLayer__visible"] button').filter({ hasText: /^예약 취소$/ });
      const count = await cancelButton.count();
      if (count !== 1) throw new Error(`Naver final cancel button count ${count}`);
      if (typeof beforeConfirm === 'function') {
        const guard = await beforeConfirm({
          taskId: row.taskId,
          reservationNo,
          roomKey: row.roomKey,
          date: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
        });
        row.cancelGuard = guard?.summary || guard || {};
        if (guard?.approved !== true) {
          row.status = guard?.retryable ? 'guard-retry-pending' : 'needs-review';
          row.error = `Naver cancellation guard blocked final confirm: ${guard?.reason || 'not-approved'}`;
          row.finishedAt = new Date().toISOString();
          return row;
        }
      }
      row.submissionAttempted = true;
      await cancelButton.first().click({ timeout: 10000 });
      await page.waitForTimeout(1500);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const modalConfirm = page.locator('[role="dialog"] button, [class*="Modal"] button, [class*="modal"] button, [class*="Popup"] button, [class*="Alert"] button')
          .filter({ hasText: /확인|예약 취소/ });
        const modalCount = await modalConfirm.count().catch(() => 0);
        if (modalCount === 1) {
          await modalConfirm.first().click({ timeout: 5000 });
          await page.waitForTimeout(1000);
        }
        const status = await readNaverReservationStatusFromList(page, reservationNo).catch(() => null);
        if (status?.status === '취소') {
          row.afterStatus = '취소';
          break;
        }
        await page.goto(naverBookingListUrl(businessId, { date: row.date, reservationNo }), { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(800);
        const refreshed = await readNaverReservationStatusFromList(page, reservationNo).catch(() => null);
        if (refreshed?.status === '취소') {
          row.afterStatus = '취소';
          break;
        }
      }
    } finally {
      page.off('dialog', onDialog);
    }
    if (dialogTypes.length) row.dialogTypes = dialogTypes;

    row.finishedAt = new Date().toISOString();
    if (row.afterStatus === '취소') {
      row.status = 'canceled';
      row.submissionConfirmed = true;
    } else {
      row.status = 'failed';
      row.submissionConfirmed = false;
      row.error = 'Naver reservation status did not become canceled after confirm';
    }
    return row;
  } catch (error) {
    row.status = row.status || 'failed';
    row.error = String(error?.message || error);
    row.finishedAt = new Date().toISOString();
    return row;
  }
}

export async function checkNaverSmartplaceLogin(context, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  timeoutMs = 20000,
} = {}) {
  const targetUrl = naverCalendarUrl(businessId);
  let navigationError = '';
  let probeStatus = null;
  let redirectLocation = '';
  try {
    const response = await context.request.fetch(targetUrl, {
      method: 'HEAD',
      timeout: timeoutMs,
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    probeStatus = response.status();
    redirectLocation = response.headers().location || '';
  } catch (error) {
    navigationError = String(error?.message || error).replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  const classification = classifyNaverSessionCheck({
    url: targetUrl,
    navigationError,
    probeStatus,
    redirectLocation,
    probeAttempted: true,
  });
  let finalUrl = targetUrl;
  if (redirectLocation) {
    try {
      finalUrl = new URL(redirectLocation, targetUrl).toString();
    } catch {}
  }
  return {
    ...classification,
    url: finalUrl,
    title: '',
    navigationError,
    probe: 'head',
    probeStatus,
  };
}

export function classifyNaverSessionCheck({
  url,
  calendarVisible = false,
  navigationError = '',
  probeStatus = null,
  redirectLocation = '',
  probeAttempted = false,
} = {}) {
  const currentUrl = String(url || '');
  let effectiveUrl = currentUrl;
  if (redirectLocation) {
    try {
      effectiveUrl = new URL(String(redirectLocation), currentUrl).toString();
    } catch {}
  }
  const loginRequired = isNaverLoginUrl(effectiveUrl);
  if (loginRequired) {
    return {
      ok: false,
      status: 'login_required',
      loginRequired: true,
      reason: 'Naver authentication page is visible',
    };
  }

  const expectedUrl = /^https:\/\/partner\.booking\.naver\.com\/bizes\/[^/]+\/booking-calendar-view(?:[/?#]|$)/.test(currentUrl);
  if ([401, 403].includes(Number(probeStatus))) {
    return {
      ok: false,
      status: 'login_required',
      loginRequired: true,
      reason: `Naver SmartPlace session probe returned HTTP ${probeStatus}`,
    };
  }
  if (probeStatus !== null) {
    if (expectedUrl && Number(probeStatus) >= 200 && Number(probeStatus) < 300) {
      return { ok: true, status: 'ready', loginRequired: false, reason: '' };
    }
    return {
      ok: false,
      status: probeAttempted ? 'needs_check' : 'check_failed',
      loginRequired: false,
      reason: `Naver SmartPlace session probe could not verify authentication: HTTP ${probeStatus}`,
    };
  }
  if (probeAttempted) {
    return {
      ok: false,
      status: 'needs_check',
      loginRequired: false,
      reason: navigationError
        ? `Naver SmartPlace session probe unavailable: ${navigationError}`
        : 'Naver SmartPlace session probe returned no authoritative response',
    };
  }
  if (expectedUrl && calendarVisible) {
    return { ok: true, status: 'ready', loginRequired: false, reason: '' };
  }
  if (navigationError) {
    return {
      ok: false,
      status: 'check_failed',
      loginRequired: false,
      reason: `Naver SmartPlace navigation failed: ${navigationError}`,
    };
  }
  return {
    ok: false,
    status: 'check_failed',
    loginRequired: false,
    reason: expectedUrl
      ? 'Naver SmartPlace calendar controls were not visible before timeout'
      : 'Naver SmartPlace navigation did not reach the expected calendar',
  };
}
