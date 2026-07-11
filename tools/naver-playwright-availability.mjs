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
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await page.evaluate(() => !!document.querySelector('[class*="SideLayer__visible"]')).catch(() => false);
    if (!open) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function readSelectedView(page) {
  return page.evaluate(() => {
    const button = document.querySelector('button[class*="Select__btn-selected"]');
    return (button?.innerText || button?.textContent || '').replace(/\s+/g, ' ').trim();
  });
}

async function ensureWeeklyView(page) {
  const selected = await readSelectedView(page);
  if (selected.includes('주간')) return;

  const viewButton = page.locator('button[class*="Select__btn-selected"]');
  const viewCount = await viewButton.count();
  if (viewCount !== 1) throw new Error(`Naver view selector count ${viewCount}`);
  await viewButton.click({ timeout: 8000 });
  await page.waitForTimeout(300);

  const weekly = page.locator('a.btn-option').filter({ hasText: '주간' });
  const weeklyCount = await weekly.count();
  if (weeklyCount !== 1) throw new Error(`Naver weekly option count ${weeklyCount}`);
  await weekly.click({ timeout: 8000 });
  await page.waitForTimeout(1000);

  const after = await readSelectedView(page);
  if (!after.includes('주간')) throw new Error(`Naver weekly view did not apply: ${after}`);
}

async function selectRoom(page, roomKey) {
  const room = NAVER_ROOMS[roomKey];
  if (!room) throw new Error(`unknown Naver room key: ${roomKey}`);
  const roomButton = page.locator('button[class*="BizItemsTab__product"]').filter({ hasText: room.name });
  const count = await roomButton.count();
  if (count !== 1) throw new Error(`Naver room tab count ${count} for ${roomKey}`);
  await roomButton.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const className = await roomButton.getAttribute('class', { timeout: 5000 }).catch(() => '');
  if (!String(className || '').includes('active')) {
    await roomButton.click({ timeout: 8000 });
    await page.waitForTimeout(1000);
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
  return parseWeekPeriod(text);
}

async function gotoWeekContainingDate(page, targetDate) {
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
    await page.waitForTimeout(1000);
  }
  throw new Error(`Naver week navigation failed for ${target}`);
}

async function scrollCalendarToHour(page, hour) {
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
  await page.waitForTimeout(700);
}

async function findWeeklySlot(page, row) {
  const date = normalizeDate(row.date);
  const startHour = parseHour(row.startTime);
  const dayIndex = dayIndexForDate(date);
  const marker = `rhythmjoy-target-${Date.now()}`;
  return page.evaluate(({ dayIndex: wantedDay, startHour: wantedHour, marker: wantedMarker }) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    document.querySelectorAll('[data-rhythmjoy-target]').forEach((el) => el.removeAttribute('data-rhythmjoy-target'));
    const rowWrap = document.querySelector('[class*="Calendar__row-wrap"]');
    if (!rowWrap) return { status: 'not_found', reason: 'row-wrap-not-found', marker: wantedMarker };
    const rows = [...rowWrap.children].filter((el) => String(el.className || '').includes('Calendar__week-row'));
    const rowEl = rows[wantedHour];
    if (!rowEl) return { status: 'not_found', reason: 'hour-row-not-found', marker: wantedMarker, rowCount: rows.length };
    const cells = [...rowEl.children].filter((el) => String(el.className || '').includes('Calendar__week-cell'));
    const cell = cells[wantedDay];
    if (!cell) return { status: 'not_found', reason: 'day-cell-not-found', marker: wantedMarker, cellCount: cells.length };
    const buttons = [...cell.querySelectorAll('button[class*="calendar-btn"]')].map((button, index) => {
      const rect = button.getBoundingClientRect();
      return {
        index,
        text: norm(button.innerText || button.textContent || ''),
        title: button.getAttribute('title') || '',
        className: String(button.className || ''),
        visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
      };
    });
    const suspendedIndex = buttons.findIndex((button) => button.title === '예약불가' || button.className.includes('suspended'));
    const confirmedIndex = buttons.findIndex((button) => button.title === '확정' || button.className.includes('confirmed'));
    const availableIndex = buttons.findIndex((button) => button.title === '예약가능' && button.className.includes('avail'));
    const soldoutIndex = buttons.findIndex((button) => button.className.includes('soldout'));

    let status = 'unknown';
    let targetIndex = -1;
    if (suspendedIndex >= 0) {
      status = 'suspended';
      targetIndex = suspendedIndex;
    } else if (confirmedIndex >= 0) {
      status = 'confirmed';
      targetIndex = confirmedIndex;
    } else if (availableIndex >= 0) {
      status = 'available';
      targetIndex = availableIndex;
    } else if (soldoutIndex >= 0) {
      status = 'soldout';
      targetIndex = soldoutIndex;
    }

    if (targetIndex >= 0) {
      const button = cell.querySelectorAll('button[class*="calendar-btn"]')[targetIndex];
      button.setAttribute('data-rhythmjoy-target', wantedMarker);
    }
    return {
      status,
      marker: wantedMarker,
      cellText: norm(cell.innerText || cell.textContent || ''),
      buttons,
    };
  }, { dayIndex, startHour, marker });
}

async function verifySchedulePanel(page, row, expectedStatus) {
  const room = NAVER_ROOMS[row.roomKey];
  const date = normalizeDate(row.date);
  const dateText = `${dateParts(date).year}.${dateParts(date).month}.${dateParts(date).day}`;
  const startText = timeLabel(row.startTime);
  const endText = timeLabel(row.endTime);
  const panel = await page.evaluate(() => {
    const side = document.querySelector('[class*="SideLayer__visible"]');
    return (side?.innerText || side?.textContent || '').replace(/\s+/g, ' ').trim();
  });
  const compact = compactText(panel);
  const errors = [];
  if (!compact.includes(compactText(room.name))) errors.push(`room:${room.name}`);
  if (!compact.includes(compactText(dateText))) errors.push(`date:${dateText}`);
  if (!compact.includes(compactText(startText))) errors.push(`start:${startText}`);
  if (!compact.includes(compactText(endText))) errors.push(`end:${endText}`);
  if (expectedStatus && !compact.includes(compactText(expectedStatus))) errors.push(`status:${expectedStatus}`);
  return { ok: errors.length === 0, errors, textPreview: panel.slice(0, 500) };
}

async function selectScheduleFormButton(page, groupLabel, buttonIndex, targetText) {
  const marker = `rhythmjoy-form-${Date.now()}-${buttonIndex}`;
  const current = await page.evaluate(({ groupLabel: wantedGroup, buttonIndex: wantedIndex, marker: wantedMarker }) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    document.querySelectorAll('[data-rhythmjoy-form-target]').forEach((el) => el.removeAttribute('data-rhythmjoy-form-target'));
    const groups = [...document.querySelectorAll('.form-group')];
    const group = groups.find((el) => norm(el.innerText || el.textContent || '').includes(wantedGroup));
    if (!group) return { ok: false, reason: `form group not found: ${wantedGroup}` };
    const buttons = [...group.querySelectorAll('button.form-control')];
    const button = buttons[wantedIndex];
    if (!button) return { ok: false, reason: `button ${wantedIndex} not found in ${wantedGroup}`, buttonCount: buttons.length };
    button.setAttribute('data-rhythmjoy-form-target', wantedMarker);
    return { ok: true, text: norm(button.innerText || button.textContent || '') };
  }, { groupLabel, buttonIndex, marker });

  if (!current.ok) throw new Error(current.reason);
  if (current.text === targetText) return { changed: false, value: current.text };

  const button = page.locator(`button[data-rhythmjoy-form-target="${marker}"]`);
  const buttonCount = await button.count();
  if (buttonCount !== 1) throw new Error(`form target button count ${buttonCount}`);
  await button.click({ timeout: 8000 });
  await page.waitForTimeout(300);

  const option = page.locator('div.selectbox-list button.btn-select').filter({ hasText: targetText });
  const optionCount = await option.count();
  if (optionCount !== 1) throw new Error(`select option count ${optionCount} for ${targetText}`);
  await option.click({ timeout: 8000 });
  await page.waitForTimeout(300);
  return { changed: true, value: targetText };
}

async function saveSchedule(page) {
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
    await page.waitForTimeout(1200);
    await waitSidePanelClosed(page, 12000);
    return { dialogTypes };
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

async function prepareCalendar(page, row, { businessId = NAVER_BOOKING_BUSINESS_ID } = {}) {
  const url = naverCalendarUrl(businessId);
  if (!page.url().startsWith(url)) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  if (!(await waitVisible(page, 'button[class*="Select__btn-selected"]', 20000))) {
    throw new Error('Naver SmartPlace calendar not visible; login may be required');
  }
  await ensureWeeklyView(page);
  await selectRoom(page, row.roomKey);
  await gotoWeekContainingDate(page, row.date);
  await scrollCalendarToHour(page, parseHour(row.startTime));
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
  if (!row.reservationNo) {
    row.status = 'needs-review';
    row.error = 'SpaceCloud reservation number missing; Naver availability change requires a durable reservation id';
    row.finishedAt = new Date().toISOString();
    return row;
  }

  try {
    await prepareCalendar(page, row, { businessId });
    let slot = await findWeeklySlot(page, row);
    row.beforeSlot = slot;

    if (targetStatus === 'unavailable') {
      if (slot.status === 'suspended') {
        row.status = 'already-blocked';
        row.finishedAt = new Date().toISOString();
        return row;
      }
      if (slot.status === 'confirmed' || slot.status === 'soldout') {
        row.status = 'naver-conflict';
        row.error = `Naver slot is ${slot.status}; Naver reservation takes priority`;
        row.finishedAt = new Date().toISOString();
        return row;
      }
      if (slot.status !== 'available') {
        throw new Error(`target Naver slot is not available: ${JSON.stringify(slot)}`);
      }
    } else if (targetStatus === 'available') {
      if (slot.status === 'available') {
        row.status = 'already-available';
        row.finishedAt = new Date().toISOString();
        return row;
      }
      if (slot.status !== 'suspended') {
        row.status = 'needs-review';
        row.error = `Naver slot is ${slot.status}; automatic restore only changes 예약불가 slots`;
        row.finishedAt = new Date().toISOString();
        return row;
      }
    } else {
      throw new Error(`unsupported target status: ${targetStatus}`);
    }

    const target = page.locator(`button[data-rhythmjoy-target="${slot.marker}"]`);
    const targetCount = await target.count();
    if (targetCount !== 1) throw new Error(`Naver target button count ${targetCount}`);
    await target.click({ timeout: 10000 });
    await page.waitForTimeout(900);

    const verification = await verifySchedulePanel(
      page,
      row,
      targetStatus === 'unavailable' ? '예약가능' : '예약불가',
    );
    row.panelVerification = verification;
    if (!verification.ok) {
      row.status = 'needs-review';
      row.error = `Naver panel verification failed: ${verification.errors.join(', ')}`;
      row.finishedAt = new Date().toISOString();
      return row;
    }

    await selectScheduleFormButton(page, '적용시간', 0, timeLabel(row.startTime));
    await selectScheduleFormButton(page, '적용시간', 1, timeLabel(row.endTime));
    await selectScheduleFormButton(
      page,
      '예약상태',
      0,
      targetStatus === 'unavailable' ? '예약불가' : '예약가능',
    );
    row.save = await saveSchedule(page);
    await scrollCalendarToHour(page, parseHour(row.startTime));
    slot = await findWeeklySlot(page, row);
    row.afterSlot = slot;

    if (targetStatus === 'unavailable' && slot.status !== 'suspended') {
      throw new Error(`Naver slot did not become 예약불가: ${JSON.stringify(slot)}`);
    }
    if (targetStatus === 'available' && slot.status !== 'available') {
      throw new Error(`Naver slot did not become 예약가능: ${JSON.stringify(slot)}`);
    }

    row.status = targetStatus === 'unavailable' ? 'blocked' : 'restored';
    row.finishedAt = new Date().toISOString();
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
  const page = await pageForContext(context);
  await page.goto(naverCalendarUrl(businessId), { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
  const ok = await waitVisible(page, 'button[class*="Select__btn-selected"]', timeoutMs);
  return {
    ok,
    url: page.url(),
    title: await page.title().catch(() => ''),
    reason: ok ? '' : 'Naver SmartPlace calendar not visible; login may be required',
  };
}
