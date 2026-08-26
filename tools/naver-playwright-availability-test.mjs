import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHourlySlotRows,
  checkNaverSmartplaceLogin,
  classifyNaverSessionCheck,
  classifyNaverCancelPanelText,
  fetchNaverReservationPhone,
  partitionNaverActionableSlotRows,
  selectNaverCancelPanelText,
  selectNaverScheduleEditorPanel,
  waitForNaverCancelPanelIdentity,
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
        throw new Error('request failed before response');
      },
    },
  };

  const result = await fetchNaverReservationPhone(context, phoneLookupTask);

  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /^naver-booking-api-request-failed:/);
  assert.equal(result.phone, '');
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
