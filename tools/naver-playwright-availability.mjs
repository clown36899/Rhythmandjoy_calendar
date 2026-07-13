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
  reservationNo,
} = {}) {
  const params = new URLSearchParams({
    dateDropdownType: 'DIRECT',
    startDateTime: normalizeDate(date),
    endDateTime: normalizeDate(date),
    dateFilter: 'USEDATE',
    searchValueCode: 'BOOKING_ID',
    searchValue: String(reservationNo || '').trim(),
  });
  return `https://partner.booking.naver.com/bizes/${businessId}/booking-list-view?${params}`;
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
  const startTexts = timeLabelVariants(row.startTime);
  const endTexts = timeLabelVariants(row.endTime);
  const panel = await page.evaluate(() => {
    const side = document.querySelector('[class*="SideLayer__visible"]');
    return (side?.innerText || side?.textContent || '').replace(/\s+/g, ' ').trim();
  });
  const compact = compactText(panel);
  const errors = [];
  if (!compact.includes(compactText(room.name))) errors.push(`room:${room.name}`);
  if (!compact.includes(compactText(dateText))) errors.push(`date:${dateText}`);
  if (!compactIncludesAny(compact, startTexts)) errors.push(`start:${startTexts[0]}`);
  if (!compactIncludesAny(compact, endTexts)) errors.push(`end:${endTexts[0]}`);
  if (expectedStatus && !compact.includes(compactText(expectedStatus))) errors.push(`status:${expectedStatus}`);
  return { ok: errors.length === 0, errors, textPreview: panel.slice(0, 500) };
}

async function selectScheduleFormButton(page, groupLabel, buttonIndex, targetText) {
  const targetTexts = Array.isArray(targetText) ? targetText : [targetText];
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
  if (targetTexts.includes(current.text)) return { changed: false, value: current.text };

  const button = page.locator(`button[data-rhythmjoy-form-target="${marker}"]`);
  const buttonCount = await button.count();
  if (buttonCount !== 1) throw new Error(`form target button count ${buttonCount}`);
  await button.click({ timeout: 8000 });
  await page.waitForTimeout(300);

  let selected = null;
  for (const optionText of targetTexts) {
    const option = page.locator('div.selectbox-list button.btn-select').filter({ hasText: optionText });
    const optionCount = await option.count();
    if (optionCount === 1) {
      await option.click({ timeout: 8000 });
      selected = optionText;
      break;
    }
    if (optionCount > 1) throw new Error(`select option count ${optionCount} for ${optionText}`);
  }
  if (!selected) throw new Error(`select option count 0 for ${targetTexts.join(' | ')}`);
  await page.waitForTimeout(300);
  return { changed: true, value: selected };
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

function buildHourlySlotRows(row) {
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
  await ensureWeeklyView(page);
  await selectRoom(page, row.roomKey);
  await gotoWeekContainingDate(page, row.date);
  await scrollCalendarToHour(page, parseHour(row.startTime));
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
  await page.waitForTimeout(900);

  const verification = await verifySchedulePanel(page, slotRow, meta.expectedPanelStatus);
  result.panelVerification = verification;
  if (!verification.ok) {
    result.status = 'needs-review';
    result.error = `Naver panel verification failed: ${verification.errors.join(', ')}`;
    return result;
  }

  await selectScheduleFormButton(page, '적용시간', 0, timeLabelVariants(slotRow.startTime));
  await selectScheduleFormButton(page, '적용시간', 1, timeLabelVariants(slotRow.endTime));
  await selectScheduleFormButton(page, '예약상태', 0, meta.formStatus);
  result.save = await saveSchedule(page);
  await scrollCalendarToHour(page, parseHour(slotRow.startTime));
  slot = await findWeeklySlot(page, slotRow);
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
    const slotRows = buildHourlySlotRows(row);
    row.slotRows = slotRows.map((slotRow) => ({
      date: slotRow.date,
      startTime: slotRow.startTime,
      endTime: slotRow.endTime,
      slotIndex: slotRow.slotIndex,
    }));
    row.slotCount = slotRows.length;
    row.beforeSlots = [];

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

export async function fetchNaverReservationPhone(context, task, {
  businessId = NAVER_BOOKING_BUSINESS_ID,
  timeoutMs = 15000,
} = {}) {
  const page = await pageForContext(context);
  const row = taskRow(task);
  const reservationNo = row.reservationNo || task.reservation_number || '';
  if (!reservationNo) {
    return { status: 'not_found', reason: 'naver-reservation-number-missing', phone: '', maskedPhone: '' };
  }
  if (!row.date) {
    return { status: 'not_found', reason: 'naver-reservation-date-missing', phone: '', maskedPhone: '' };
  }

  const targetUrl = naverBookingListUrl(businessId, {
    date: row.date,
    reservationNo,
  });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((wantedReservationNo) => {
      const text = document.body?.innerText || '';
      const phones = [...text.matchAll(/01[016789][^0-9]{0,3}[0-9]{3,4}[^0-9]{0,3}[0-9]{4}/g)].map((match) => match[0]);
      return {
        hasReservation: text.includes(wantedReservationNo),
        noResults: text.includes('검색된 예약내역이 없습니다'),
        phones,
      };
    }, String(reservationNo));
    if (last.hasReservation && last.phones.length) {
      const phone = normalizePhone(last.phones[0]);
      return {
        status: 'found',
        phone,
        maskedPhone: maskPhone(phone),
        source: 'naver-list',
        reservationNo,
      };
    }
    await page.waitForTimeout(500);
  }

  return {
    status: 'not_found',
    reason: last?.hasReservation ? 'naver-phone-not-visible' : 'naver-reservation-not-found',
    phone: '',
    maskedPhone: '',
    source: 'naver-list',
    reservationNo,
  };
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
