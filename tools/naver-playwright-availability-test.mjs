import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHourlySlotRows,
  checkNaverSmartplaceLogin,
  classifyNaverSessionCheck,
  classifyNaverCancelPanelText,
  ensureNaverWeeklyView,
  fetchNaverReservationPhone,
  gotoNaverWeekContainingDate,
  inspectNaverReservationStatus,
  partitionNaverActionableSlotRows,
  saveNaverSchedule,
  scrollNaverCalendarToHour,
  selectNaverCancelPanelText,
  selectNaverRoom,
  selectNaverScheduleEditorPanel,
  waitForNaverCancelPanelIdentity,
  waitForNaverSchedulePanelIdentity,
  waitForNaverWeeklySlotStatus,
} from './naver-playwright-availability.mjs';

test('distinguishes an explicit Naver login page from a transient calendar load failure', () => {
  assert.deepEqual(classifyNaverSessionCheck({
    url: 'https://nid.naver.com/nidlogin.login?mode=form',
  }), {
    ok: false,
    status: 'login_required',
    loginRequired: true,
    reason: 'Naver authentication page is visible',
  });

  const delayed = classifyNaverSessionCheck({
    url: 'https://partner.booking.naver.com/bizes/1257912/booking-calendar-view',
    calendarVisible: false,
  });
  assert.equal(delayed.status, 'check_failed');
  assert.equal(delayed.loginRequired, false);

  const navigationTimeout = classifyNaverSessionCheck({
    url: 'https://partner.spacecloud.kr/reservation-calendar',
    navigationError: 'page.goto: Timeout 15000ms exceeded',
  });
  assert.equal(navigationTimeout.status, 'check_failed');
  assert.match(navigationTimeout.reason, /navigation failed/);

  assert.equal(classifyNaverSessionCheck({
    url: 'https://partner.booking.naver.com/bizes/1257912/booking-calendar-view',
    calendarVisible: true,
  }).status, 'ready');

  assert.equal(classifyNaverSessionCheck({
    url: 'https://partner.booking.naver.com/bizes/1257912/booking-calendar-view',
    probeStatus: 200,
  }).status, 'ready');

  const redirected = classifyNaverSessionCheck({
    url: 'https://partner.booking.naver.com/bizes/1257912/booking-calendar-view',
    probeStatus: 302,
    redirectLocation: 'https://nid.naver.com/nidlogin.login?url=redacted',
  });
  assert.equal(redirected.status, 'login_required');

  const unavailable = classifyNaverSessionCheck({
    url: 'https://partner.booking.naver.com/bizes/1257912/booking-calendar-view',
    probeStatus: 503,
    probeAttempted: true,
  });
  assert.equal(unavailable.status, 'needs_check');
  assert.match(unavailable.reason, /HTTP 503/);

  assert.equal(classifyNaverSessionCheck({
    url: 'https://partner.booking.naver.com/bizes/1257912/booking-calendar-view',
    navigationError: 'request timed out',
    probeAttempted: true,
  }).status, 'needs_check');
});

test('checks Naver authentication with a lightweight redirect probe', async () => {
  const calls = [];
  const context = {
    request: {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return {
          status: () => 200,
          headers: () => ({}),
        };
      },
    },
  };
  const result = await checkNaverSmartplaceLogin(context, {
    businessId: '1257912',
    timeoutMs: 4321,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.probe, 'head');
  assert.equal(result.probeStatus, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'HEAD');
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(calls[0].options.timeout, 4321);
});

function naverBookingApiResponse(status, body = null, headers = {}) {
  return {
    status: () => status,
    headers: () => headers,
    json: async () => body,
  };
}

const phoneLookupTask = {
  id: 842,
  roomKey: 'e',
  date: '2026-09-01',
  startTime: '13:00',
  endTime: '15:00',
  reservationNo: '9876543210',
};

test('reads an exact Naver booking phone through the authenticated detail API', async () => {
  const calls = [];
  const context = {
    request: {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return naverBookingApiResponse(200, {
          bookingId: 9876543210,
          businessId: 1257912,
          startDate: '2026-09-01T13:00:00+09:00',
          phone: '010-1234-5678',
        });
      },
    },
  };

  const result = await fetchNaverReservationPhone(context, phoneLookupTask, {
    businessId: '1257912',
    timeoutMs: 4321,
  });

  assert.deepEqual(result, {
    status: 'found',
    phone: '01012345678',
    maskedPhone: '010-****-5678',
    source: 'naver-booking-api',
    reservationNo: '9876543210',
    apiStatus: 200,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://partner.booking.naver.com/api/businesses/1257912/bookings/9876543210');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(calls[0].options.timeout, 4321);
  assert.equal(calls[0].options.headers['X-Booking-Naver-Role'], 'OWNER');
});

test('never returns a phone when any Naver booking identity field does not exactly match', async () => {
  for (const mismatch of [
    { bookingId: '1111111111' },
    { businessId: '9999999' },
    { startDate: '2026-09-02' },
  ]) {
    const context = {
      request: {
        fetch: async () => naverBookingApiResponse(200, {
          bookingId: '9876543210',
          businessId: '1257912',
          startDate: '2026-09-01',
          phone: '010-9999-8888',
          ...mismatch,
        }),
      },
    };

    const result = await fetchNaverReservationPhone(context, phoneLookupTask);

    assert.equal(result.status, 'not_found');
    assert.equal(result.reason, 'naver-booking-api-identity-mismatch');
    assert.equal(result.phone, '');
    assert.equal(result.maskedPhone, '');
  }
});

test('classifies Naver booking API authentication and transient failures without rendering the SPA', async () => {
  const loginContext = {
    request: {
      fetch: async () => naverBookingApiResponse(302, null, {
        location: 'https://nid.naver.com/nidlogin.login?url=redacted',
      }),
    },
  };
  const unavailableContext = {
    request: {
      fetch: async () => naverBookingApiResponse(503),
    },
  };

  const login = await fetchNaverReservationPhone(loginContext, phoneLookupTask);
  const unavailable = await fetchNaverReservationPhone(unavailableContext, phoneLookupTask);

  assert.equal(login.status, 'login_required');
  assert.equal(login.reason, 'naver-login-required');
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.reason, 'naver-booking-api-http-503');
  assert.equal(unavailable.phone, '');
});

test('returns a retryable Naver API result when the exact request cannot complete', async () => {
  const context = {
    request: {
      fetch: async () => {
        throw new Error('apiRequestContext.fetch: Timeout 15000ms exceeded.\n- cookie: NID_SES=must-not-leak');
      },
    },
  };

  const result = await fetchNaverReservationPhone(context, phoneLookupTask);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'naver-booking-api-request-failed:Timeout 15000ms exceeded');
  assert.doesNotMatch(result.reason, /cookie|NID_SES|must-not-leak/i);
  assert.equal(result.phone, '');
});

test('reads every supported Naver reservation status from the exact booking API without opening the SPA', async () => {
  const expectedByCode = new Map([
    ['RC02', { status: '신청', exists: true }],
    ['RC03', { status: '확정', exists: true }],
    ['RC04', { status: '취소', exists: false }],
    ['RC05', { status: '노쇼', exists: true }],
    ['RC06', { status: '취소', exists: false }],
    ['RC08', { status: '완료', exists: true }],
  ]);

  for (const [bookingStatusCode, expected] of expectedByCode) {
    const calls = [];
    const context = {
      pages: () => {
        throw new Error('reservation status inspection must not open the Naver SPA');
      },
      request: {
        fetch: async (url, options) => {
          calls.push({ url, options });
          return naverBookingApiResponse(200, {
            bookingId: 9876543210,
            businessId: 1257912,
            startDate: '2026-09-01T13:00:00+09:00',
            bookingStatusCode,
          });
        },
      },
    };

    const result = await inspectNaverReservationStatus(context, phoneLookupTask, {
      businessId: '1257912',
      timeoutMs: 4321,
    });

    assert.equal(result.status, expected.status);
    assert.equal(result.exists, expected.exists);
    assert.equal(result.reason, '');
    assert.equal(result.source, 'naver-booking-api');
    assert.equal(result.bookingStatusCode, bookingStatusCode);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://partner.booking.naver.com/api/businesses/1257912/bookings/9876543210');
    assert.equal(calls[0].options.timeout, 4321);
  }
});

test('keeps Naver API identity, authentication, transport, and unknown-status failures non-destructive', async () => {
  const cases = [
    {
      response: naverBookingApiResponse(200, {
        bookingId: 1111111111,
        businessId: 1257912,
        startDate: '2026-09-01',
        bookingStatusCode: 'RC04',
      }),
      expected: { status: 'not_found', exists: false, reason: 'naver-booking-api-identity-mismatch' },
    },
    {
      response: naverBookingApiResponse(302, null, {
        location: 'https://nid.naver.com/nidlogin.login?url=redacted',
      }),
      expected: { status: 'login_required', exists: false, reason: 'naver-login-required' },
    },
    {
      response: naverBookingApiResponse(503),
      expected: { status: 'unavailable', exists: false, reason: 'naver-booking-api-http-503' },
    },
    {
      response: naverBookingApiResponse(200, {
        bookingId: 9876543210,
        businessId: 1257912,
        startDate: '2026-09-01',
        bookingStatusCode: 'RC99',
      }),
      expected: { status: 'needs_review', exists: true, reason: 'naver-booking-status-unsupported:RC99' },
    },
  ];

  for (const { response, expected } of cases) {
    const context = {
      pages: () => {
        throw new Error('reservation status failure handling must not open the Naver SPA');
      },
      request: { fetch: async () => response },
    };
    const result = await inspectNaverReservationStatus(context, phoneLookupTask);
    assert.equal(result.status, expected.status);
    assert.equal(result.exists, expected.exists);
    assert.equal(result.reason, expected.reason);
    assert.notEqual(result.status, '취소', 'an uncertain read must never authorize canceled side effects');
  }
});

test('selects the Naver weekly view by rendered state without blind elapsed waits', async () => {
  let selectedView = '월간';
  let viewClicks = 0;
  let weeklyClicks = 0;
  const waitCalls = [];
  const weeklyOption = {
    first: () => weeklyOption,
    waitFor: async (options) => { waitCalls.push({ type: 'option', options }); },
    count: async () => 1,
    click: async () => {
      weeklyClicks += 1;
      selectedView = '주간';
    },
  };
  const viewButton = {
    count: async () => 1,
    click: async () => { viewClicks += 1; },
  };
  const page = {
    evaluate: async () => selectedView,
    locator: (selector) => (selector === 'button[class*="Select__btn-selected"]'
      ? viewButton
      : { filter: () => weeklyOption }),
    waitForFunction: async (predicate, expected, options) => {
      waitCalls.push({ type: 'selected-view', predicate, expected, options });
    },
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden while selecting the Naver weekly view');
    },
  };

  await ensureNaverWeeklyView(page, { timeoutMs: 4321 });

  assert.equal(viewClicks, 1);
  assert.equal(weeklyClicks, 1);
  assert.equal(waitCalls.length, 2);
  assert.deepEqual(waitCalls[0].options, { state: 'visible', timeout: 4321 });
  assert.equal(waitCalls[1].expected, '주간');
  assert.equal(waitCalls[1].options.timeout, 4321);
});

test('waits for the exact Naver room to become active without a fixed delay', async () => {
  let activeRoom = 'B홀';
  let roomClicks = 0;
  const waitCalls = [];
  const roomButton = {
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => {},
    getAttribute: async () => 'BizItemsTab__product',
    click: async () => {
      roomClicks += 1;
      activeRoom = 'A홀';
    },
  };
  const page = {
    locator: () => ({ filter: () => roomButton }),
    evaluate: async () => activeRoom,
    waitForFunction: async (predicate, expected, options) => {
      waitCalls.push({ predicate, expected, options });
    },
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden while selecting a Naver room');
    },
  };

  await selectNaverRoom(page, 'a', { timeoutMs: 4321 });

  assert.equal(roomClicks, 1);
  assert.equal(waitCalls.length, 1);
  assert.equal(waitCalls[0].expected, 'A홀');
  assert.equal(waitCalls[0].options.timeout, 4321);
});

test('does not click or wait when the requested Naver room is already active', async () => {
  let roomClicks = 0;
  let waitCount = 0;
  const roomButton = {
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => {},
    getAttribute: async () => 'BizItemsTab__product BizItemsTab__active',
    click: async () => { roomClicks += 1; },
  };
  const page = {
    locator: () => ({ filter: () => roomButton }),
    evaluate: async () => 'A홀',
    waitForFunction: async () => { waitCount += 1; },
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden while selecting a Naver room');
    },
  };

  await selectNaverRoom(page, 'a', { timeoutMs: 4321 });

  assert.equal(roomClicks, 0);
  assert.equal(waitCount, 0);
});

test('moves Naver weeks only after each rendered period actually changes', async () => {
  let periodText = '2026. 8. 23. ~ 2026. 8. 29.';
  let clicks = 0;
  const selectors = [];
  const transitions = [
    '2026. 8. 30. ~ 2026. 9. 5.',
    '2026. 9. 6. ~ 2026. 9. 12.',
  ];
  const waitCalls = [];
  const button = {
    count: async () => 1,
    click: async () => { clicks += 1; },
  };
  const page = {
    evaluate: async () => periodText,
    locator: (selector) => {
      selectors.push(selector);
      return button;
    },
    waitForFunction: async (predicate, previousText, options) => {
      waitCalls.push({ predicate, previousText, options });
      periodText = transitions[waitCalls.length - 1];
    },
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden while navigating Naver weeks');
    },
  };

  const period = await gotoNaverWeekContainingDate(page, '2026-09-08', { timeoutMs: 4321 });

  assert.deepEqual(period, {
    start: '2026-09-06',
    end: '2026-09-12',
    text: '2026. 9. 6. ~ 2026. 9. 12.',
  });
  assert.equal(clicks, 2);
  assert.equal(waitCalls.length, 2);
  assert.deepEqual(waitCalls.map((call) => call.previousText), [
    '2026. 8. 23. ~ 2026. 8. 29.',
    '2026. 8. 30. ~ 2026. 9. 5.',
  ]);
  assert.ok(selectors.every((selector) => selector.includes('DatePeriodCalendar__next')));
  assert.ok(waitCalls.every((call) => call.options.timeout === 4321));
});

test('never clicks the next Naver week again when the prior transition is uncertain', async () => {
  let clicks = 0;
  const timeout = new Error('page.waitForFunction: Timeout 4321ms exceeded');
  timeout.name = 'TimeoutError';
  const button = {
    count: async () => 1,
    click: async () => { clicks += 1; },
  };
  const page = {
    evaluate: async () => '2026. 8. 23. ~ 2026. 8. 29.',
    locator: () => button,
    waitForFunction: async () => { throw timeout; },
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden while navigating Naver weeks');
    },
  };

  await assert.rejects(
    gotoNaverWeekContainingDate(page, '2026-09-01', { timeoutMs: 4321 }),
    /Timeout 4321ms exceeded/,
  );
  assert.equal(clicks, 1);
});

test('waits for the requested Naver hour row to be visible after scrolling', async () => {
  const evaluateCalls = [];
  const waitCalls = [];
  const page = {
    evaluate: async (operation, argument) => {
      evaluateCalls.push({ operation, argument });
    },
    waitForFunction: async (predicate, expected, options) => {
      waitCalls.push({ predicate, expected, options });
    },
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden after scrolling the Naver calendar');
    },
  };

  await scrollNaverCalendarToHour(page, 13, { timeoutMs: 4321 });

  assert.equal(evaluateCalls.length, 1);
  assert.equal(evaluateCalls[0].argument, 13);
  assert.equal(waitCalls.length, 1);
  assert.deepEqual(waitCalls[0].expected, { targetHour: 13 });
  assert.equal(waitCalls[0].options.timeout, 4321);
});

test('waits for the exact Naver weekly slot status and then re-reads it authoritatively', async () => {
  const waitCalls = [];
  const slot = {
    status: 'suspended',
    marker: 'rhythmjoy-target-test',
    cellText: '예약불가',
    buttons: [{ title: '예약불가', className: 'calendar-btn suspended', visible: true }],
  };
  const page = {
    waitForFunction: async (predicate, expected, options) => {
      waitCalls.push({ predicate, expected, options });
    },
    evaluate: async () => slot,
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden while confirming a Naver slot status');
    },
  };

  const result = await waitForNaverWeeklySlotStatus(page, {
    date: '2026-09-03',
    startTime: '13:00',
  }, 'suspended', { timeoutMs: 4321 });

  assert.equal(result, slot);
  assert.equal(waitCalls.length, 1);
  assert.equal(waitCalls[0].expected.wantedHour, 13);
  assert.equal(waitCalls[0].expected.wantedDay, 4);
  assert.equal(waitCalls[0].expected.expectedStatus, 'suspended');
  assert.equal(waitCalls[0].options.timeout, 4321);
});

test('rejects a Naver slot status when the final authoritative read disagrees', async () => {
  const page = {
    waitForFunction: async () => {},
    evaluate: async () => ({
      status: 'available',
      marker: 'rhythmjoy-target-test',
      cellText: '예약가능',
      buttons: [{ title: '예약가능', className: 'calendar-btn avail', visible: true }],
    }),
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden while confirming a Naver slot status');
    },
  };

  await assert.rejects(
    waitForNaverWeeklySlotStatus(page, {
      date: '2026-09-03',
      startTime: '13:00',
    }, 'suspended', { timeoutMs: 4321 }),
    /did not become suspended/,
  );
});

test('selects the full Naver schedule editor instead of the visible header shell', () => {
  const selected = selectNaverScheduleEditorPanel([
    {
      visible: true,
      text: '예약정보 닫기',
      formGroupCount: 0,
      saveButtonCount: 0,
    },
    {
      visible: true,
      text: '예약정보 닫기 예약가능 설정 상품 C홀 적용날짜 2026. 8. 12. 적용시간 오후 7:00 오후 8:00 예약상태 예약가능 설정변경',
      formGroupCount: 6,
      saveButtonCount: 1,
    },
  ]);

  assert.match(selected.text, /C홀/);
  assert.equal(selected.formGroupCount, 6);
  assert.equal(selected.saveButtonCount, 1);
});

test('does not accept a header-only side layer as the schedule editor', () => {
  assert.equal(selectNaverScheduleEditorPanel([{
    visible: true,
    text: '예약정보 닫기',
    formGroupCount: 0,
    saveButtonCount: 0,
  }]), null);
});

test('waits for the exact Naver schedule editor identity instead of an elapsed delay', async () => {
  const waitCalls = [];
  const page = {
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden for the Naver schedule editor');
    },
    waitForFunction: async (predicate, expected, options) => {
      waitCalls.push({ predicate, expected, options });
    },
    evaluate: async () => [{
      visible: true,
      text: 'A홀 2026.9.3 오후 1:00 오후 2:00 예약가능 설정변경',
      formGroupCount: 2,
      saveButtonCount: 1,
    }],
  };

  const result = await waitForNaverSchedulePanelIdentity(page, {
    roomKey: 'a',
    date: '2026-09-03',
    startTime: '13:00',
    endTime: '14:00',
  }, '예약가능', { timeoutMs: 4321 });

  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
  assert.equal(waitCalls.length, 1);
  assert.equal(waitCalls[0].expected.roomName, 'A홀');
  assert.equal(waitCalls[0].expected.dateText, '2026.9.3');
  assert.deepEqual(waitCalls[0].expected.startTexts, ['오후 1:00']);
  assert.deepEqual(waitCalls[0].expected.endTexts, ['오후 2:00']);
  assert.equal(waitCalls[0].expected.expectedStatus, '예약가능');
  assert.equal(waitCalls[0].options.timeout, 4321);
});

test('keeps a loaded wrong Naver schedule panel blocked after the identity wait cap', async () => {
  const timeout = new Error('page.waitForFunction: Timeout 4321ms exceeded');
  timeout.name = 'TimeoutError';
  const page = {
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden for the Naver schedule editor');
    },
    waitForFunction: async () => {
      throw timeout;
    },
    evaluate: async () => [{
      visible: true,
      text: 'B홀 2026.9.4 오후 3:00 오후 4:00 예약가능 설정변경',
      formGroupCount: 2,
      saveButtonCount: 1,
    }],
  };

  const result = await waitForNaverSchedulePanelIdentity(page, {
    roomKey: 'a',
    date: '2026-09-03',
    startTime: '13:00',
    endTime: '14:00',
  }, '예약가능', { timeoutMs: 4321 });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.ok(result.errors.includes('room:A홀'));
  assert.ok(result.errors.includes('date:2026.9.3'));
});

test('saves a Naver schedule once and waits for the editor to actually close', async () => {
  let saveClicks = 0;
  const waitCalls = [];
  const save = {
    count: async () => 1,
    click: async () => { saveClicks += 1; },
  };
  const page = {
    on: () => {},
    off: () => {},
    locator: () => ({ filter: () => save }),
    waitForTimeout: async () => {
      throw new Error('blind elapsed waits are forbidden after Naver schedule save');
    },
    waitForFunction: async (predicate, argument, options) => {
      waitCalls.push({ predicate, argument, options });
    },
  };

  const result = await saveNaverSchedule(page, { timeoutMs: 4321 });

  assert.equal(saveClicks, 1);
  assert.equal(result.panelClosed, true);
  assert.equal(waitCalls.length, 1);
  assert.equal(waitCalls[0].options.timeout, 4321);
});

test('never repeats a Naver save when the editor close result is uncertain', async () => {
  let saveClicks = 0;
  const timeout = new Error('page.waitForFunction: Timeout 4321ms exceeded');
  timeout.name = 'TimeoutError';
  const save = {
    count: async () => 1,
    click: async () => { saveClicks += 1; },
  };
  const page = {
    on: () => {},
    off: () => {},
    locator: () => ({ filter: () => save }),
    waitForFunction: async () => { throw timeout; },
  };

  await assert.rejects(
    saveNaverSchedule(page, { timeoutMs: 4321 }),
    /did not close after save/,
  );
  assert.equal(saveClicks, 1);
});

test('skips started Naver slots and keeps later slots actionable in Korea time', () => {
  const slots = buildHourlySlotRows({
    date: '2026-08-14',
    startTime: '12:00',
    endTime: '16:00',
  });
  const partition = partitionNaverActionableSlotRows(slots, {
    now: new Date('2026-08-14T12:15:00+09:00'),
  });

  assert.deepEqual(
    partition.inactiveStarted.map((slot) => `${slot.startTime}-${slot.endTime}`),
    ['12:00-13:00'],
  );
  assert.deepEqual(
    partition.actionable.map((slot) => `${slot.startTime}-${slot.endTime}`),
    ['13:00-14:00', '14:00-15:00', '15:00-16:00'],
  );
});

test('treats a slot as inactive exactly at its start time', () => {
  const slots = buildHourlySlotRows({
    date: '2026-08-14',
    startTime: '12:00',
    endTime: '13:00',
  });
  const partition = partitionNaverActionableSlotRows(slots, {
    now: new Date('2026-08-14T12:00:00+09:00'),
  });

  assert.equal(partition.inactiveStarted.length, 1);
  assert.equal(partition.actionable.length, 0);
});

const cancelTask = {
  roomKey: 'c',
  date: '2026-08-20',
  startTime: '13:00',
  endTime: '14:00',
};

test('selects the complete visible Naver side layer instead of its reservation-number node', () => {
  const completePanel = '예약 취소 닫기 확정 예약번호 1327441965 C홀 이용일 2026. 8. 20. 오후 1:00 ~ 오후 2:00';
  const selected = selectNaverCancelPanelText({
    sideLayers: ['1327441965', completePanel],
    reservationContainers: ['1327441965'],
    bodyText: `예약 0건 ${completePanel}`,
  }, '1327441965');

  assert.equal(selected, completePanel);
});

test('selects a loading Naver side layer instead of unrelated booking-list body text', () => {
  const selected = selectNaverCancelPanelText({
    sideLayers: ['예약 취소 닫기 로딩중'],
    reservationContainers: [],
    bodyText: '예약 0건 조회된 예약내역이 없습니다',
  }, '1327441965');

  assert.equal(selected, '예약 취소 닫기 로딩중');
});

test('classifies a visible but still-loading Naver cancel panel as transient', () => {
  const result = classifyNaverCancelPanelText(
    '예약 취소 닫기 로딩중',
    cancelTask,
    '1327441965',
  );

  assert.equal(result.ok, false);
  assert.equal(result.loading, true);
  assert.equal(result.state, 'loading');
});

test('waits through Naver cancel-panel loading until the exact reservation is visible', async () => {
  const snapshots = [
    '예약 취소 닫기 로딩중',
    '확정 예약번호 1327441965 C홀 이용일 2026. 8. 20. 오후 1:00 ~ 오후 2:00',
  ];
  let readIndex = 0;
  const page = {
    evaluate: async () => ({
      sideLayers: [snapshots[Math.min(readIndex++, snapshots.length - 1)]],
      reservationContainers: [],
      bodyText: '예약 0건 조회된 예약내역이 없습니다',
    }),
    waitForTimeout: async () => {},
  };

  const result = await waitForNaverCancelPanelIdentity(page, cancelTask, '1327441965', {
    timeoutMs: 100,
    pollMs: 1,
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.verification.ok, true);
  assert.equal(result.loadingObserved, true);
  assert.equal(readIndex, 2);
});

test('returns a retryable loading timeout before any cancel-panel identity is accepted', async () => {
  const page = {
    evaluate: async () => ({
      sideLayers: ['예약 취소 닫기 로딩중'],
      reservationContainers: [],
      bodyText: '예약 0건 조회된 예약내역이 없습니다',
    }),
    waitForTimeout: async () => {},
  };

  const result = await waitForNaverCancelPanelIdentity(page, cancelTask, '1327441965', {
    timeoutMs: 0,
  });

  assert.equal(result.state, 'loading-timeout');
  assert.equal(result.verification.ok, false);
  assert.equal(result.timedOut, true);
});

test('keeps a fully loaded wrong Naver reservation as an identity mismatch', async () => {
  const page = {
    evaluate: async () => ({
      sideLayers: ['확정 예약번호 9999999999 A홀 이용일 2026. 8. 21. 오후 3:00 ~ 오후 4:00'],
      reservationContainers: [],
      bodyText: '',
    }),
    waitForTimeout: async () => {},
  };

  const result = await waitForNaverCancelPanelIdentity(page, cancelTask, '1327441965', {
    timeoutMs: 0,
  });

  assert.equal(result.state, 'mismatch');
  assert.equal(result.verification.ok, false);
  assert.equal(result.verification.loading, false);
});
