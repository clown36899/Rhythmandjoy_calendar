import fs from 'node:fs/promises';

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

export async function createSpacecloudBrowserUploader({
  browser,
  planPath,
  resultsPath,
  roomOrder = ['a', 'b', 'e', 'c', 'd'],
}) {
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  let results = [];
  try {
    results = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
  } catch {
    results = [];
  }

  async function writeResults() {
    await fs.writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  }

  async function tab() {
    const selected = await browser.tabs.selected();
    if (!selected) throw new Error('No selected in-app browser tab');
    return selected;
  }

  async function visible(page, selector) {
    return page.playwright.evaluate((sel) => {
      const el = document.querySelector(sel);
      return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }, selector, { timeoutMs: 5000 });
  }

  async function waitVisible(page, selector, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await visible(page, selector)) return true;
      await page.playwright.waitForTimeout(250);
    }
    return false;
  }

  async function waitHidden(page, selector, timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!(await visible(page, selector))) return true;
      await page.playwright.waitForTimeout(250);
    }
    return false;
  }

  async function closeModalIfOpen(page) {
    if (!(await visible(page, '#start_day'))) return;
    const close = page.playwright.locator('.btn_pop_close, a.btn_close, button.btn_close').filter({ visible: true });
    if (await close.count() === 1) {
      await close.click({ timeoutMs: 5000 });
      await waitHidden(page, '#start_day', 5000);
    }
  }

  async function pickerMonth(page) {
    const text = await page.playwright.evaluate(() => {
      const root = document.querySelector('#_dpicker1');
      const title = root?.querySelector('.calendar_tit') || root;
      return title?.innerText || '';
    }, undefined, { timeoutMs: 5000 });
    const match = String(text).match(/(\d{4})\s*\.\s*(\d{1,2})/);
    if (!match) throw new Error(`datepicker title month not found: ${String(text).slice(0, 80)}`);
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  async function setDate(page, targetDate) {
    const targetCompact = compactDate(targetDate);
    const isTarget = async () => {
      const current = await page.playwright.evaluate(() => document.querySelector('#start_day')?.value || '', undefined, {
        timeoutMs: 5000,
      });
      return {
        current,
        ok: String(current).replace(/[^0-9]/g, '').slice(0, 8) === targetCompact,
      };
    };

    const before = await isTarget();
    if (before.ok) return { method: 'already-default', current: before.current };

    await page.playwright.locator('#start_day').click({ timeoutMs: 5000 });
    if (!(await waitVisible(page, '#_dpicker1', 8000))) throw new Error('datepicker did not open');

    const targetYm = ymFromDate(targetDate);
    for (let i = 0; i < 24; i += 1) {
      const currentYm = await pickerMonth(page);
      const diff = ymIndex(targetYm) - ymIndex(currentYm);
      if (diff === 0) break;

      const selector = diff > 0 ? '#_dpicker1 .btn_month_next' : '#_dpicker1 .btn_month_prev';
      const control = page.playwright.locator(selector).filter({ visible: true });
      const count = await control.count();
      if (count !== 1) throw new Error(`datepicker ${diff > 0 ? 'next' : 'prev'} count ${count}`);
      await control.click({ timeoutMs: 5000 });
      await page.playwright.waitForTimeout(250);
    }

    const finalYm = await pickerMonth(page);
    if (ymIndex(finalYm) !== ymIndex(targetYm)) {
      throw new Error(`datepicker month not reached: ${finalYm.year}-${finalYm.month}, target=${targetDate.slice(0, 7)}`);
    }

    const day = String(Number(targetDate.slice(8, 10))).padStart(2, '0');
    const dayLocator = page.playwright.locator('#_dpicker1 a:not(.disable)').filter({ hasText: day, visible: true });
    const dayCount = await dayLocator.count();
    if (dayCount !== 1) throw new Error(`enabled datepicker day ${day} count ${dayCount}`);
    await dayLocator.click({ timeoutMs: 5000 });

    const started = Date.now();
    while (Date.now() - started < 5000) {
      const after = await isTarget();
      if (after.ok) {
        return { method: 'datepicker', current: after.current, day, month: targetDate.slice(0, 7) };
      }
      await page.playwright.waitForTimeout(200);
    }

    const finalState = await isTarget();
    throw new Error(`date did not update to ${targetDate}; current=${finalState.current}`);
  }

  async function uploadOne(event) {
    const page = await tab();
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

    try {
      const currentUrl = await page.url();
      if (currentUrl !== ui.reservationCalendarUrl) {
        await page.goto(ui.reservationCalendarUrl);
        await page.playwright.waitForLoadState({ state: 'domcontentloaded', timeoutMs: 15000 }).catch(() => {});
      }

      await closeModalIfOpen(page);

      if (!(await waitVisible(page, 'a._additionalReserveLayerOpen', 20000))) {
        throw new Error('add button not visible; login or page load may have failed');
      }
      const add = page.playwright.locator('a._additionalReserveLayerOpen').filter({ visible: true });
      const addCount = await add.count();
      if (addCount !== 1) throw new Error(`visible add button count ${addCount}`);
      await add.click({ timeoutMs: 10000 });
      if (!(await waitVisible(page, '#start_day', 12000))) throw new Error('add modal did not open');

      row.dateSet = await setDate(page, ui.values.date);
      await page.playwright.locator('#shour').selectOption(ui.values.startHourSelectValue, { timeoutMs: 10000 });
      await page.playwright.locator('#ehour').selectOption(ui.values.endHourSelectValue, { timeoutMs: 10000 });
      await page.playwright.locator('#reserve_name').fill(ui.values.name, { timeoutMs: 10000 });
      await page.playwright.locator('#reserve_tel').fill(ui.values.tel || '', { timeoutMs: 10000 });
      await page.playwright.locator('#reserve_memo').fill(ui.values.memo, { timeoutMs: 10000 });

      const filled = await page.playwright.evaluate(() => ({
        date: document.querySelector('#start_day')?.value || '',
        shour: document.querySelector('#shour')?.value || '',
        ehour: document.querySelector('#ehour')?.value || '',
        name: document.querySelector('#reserve_name')?.value || '',
      }), undefined, { timeoutMs: 5000 });

      if (
        String(filled.date).replace(/[^0-9]/g, '').slice(0, 8) !== compactDate(ui.values.date)
        || filled.shour !== ui.values.startHourSelectValue
        || filled.ehour !== ui.values.endHourSelectValue
        || filled.name !== ui.values.name
      ) {
        throw new Error(`field verification failed: ${JSON.stringify(filled)}`);
      }

      const submit = page.playwright.locator('#_addExternalSchedule').filter({ visible: true });
      const submitCount = await submit.count();
      if (submitCount !== 1) throw new Error(`visible submit count ${submitCount}`);
      await submit.click({ timeoutMs: 10000 });

      await page.playwright.waitForTimeout(700);
      let dialog = await page.getJsDialog();
      const dialogTypes = [];
      while (dialog) {
        dialogTypes.push(dialog.type);
        if (dialog.type === 'confirm') await dialog.accept();
        else await dialog.dismiss();
        await page.playwright.waitForTimeout(700);
        dialog = await page.getJsDialog();
      }

      const hidden = await waitHidden(page, '#start_day', 10000);
      row.finishedAt = new Date().toISOString();
      row.status = hidden ? 'submitted' : 'submitted-modal-still-visible';
      if (dialogTypes.length > 0) row.dialogTypes = dialogTypes;
      if (!hidden) throw new Error('modal still visible after submit');
    } catch (error) {
      row.finishedAt = new Date().toISOString();
      row.status = row.status || 'failed';
      row.error = String(error?.message || error);
      try {
        const pageAfterError = await tab();
        const dialog = await pageAfterError.getJsDialog();
        if (dialog) {
          row.dialogType = dialog.type;
          if (dialog.type === 'confirm') await dialog.dismiss();
          else await dialog.dismiss();
        }
      } catch {}
      try {
        const pageAfterError = await tab();
        const close = pageAfterError.playwright.locator('.btn_pop_close, a.btn_close, button.btn_close').filter({ visible: true });
        if (await close.count() === 1) await close.click({ timeoutMs: 3000 });
      } catch {}
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

  async function runBatch(limit = 5) {
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
      const page = await tab();
      await page.playwright.waitForTimeout(650);
    }

    return {
      attempted: rows.length,
      ...summary(),
      failed: rows
        .filter((row) => row.status !== 'submitted')
        .map((row) => ({ fingerprint: row.fingerprint, error: row.error })),
    };
  }

  return {
    plan,
    resultsPath,
    summary,
    runBatch,
  };
}
