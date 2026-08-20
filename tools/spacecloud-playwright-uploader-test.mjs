import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessCalendarMonthGrid,
  calendarGridExpectation,
  classifyDirectUploadVerification,
  directUploadRetryMode,
  directUploadVerificationTarget,
  pollForSpacecloudCalendarAbsence,
  pollForSpacecloudCalendarIdentity,
  popupDeleteVerification,
  spacecloudReservationIdentityAccepted,
  spacecloudUploadEventFromTask,
  summarizeDeleteCandidateIdentityEvidence,
  verifySpacecloudCalendarIdentity,
  waitForDirectEventCandidates,
} from './spacecloud-playwright-uploader.mjs';

function calendarSnapshot(year, month, cellCount) {
  const expected = calendarGridExpectation(year, month);
  const dayNumbers = Array(cellCount).fill(null);
  for (let day = 1; day <= expected.daysInMonth; day += 1) {
    dayNumbers[expected.firstWeekday + day - 1] = day;
  }
  return {
    title: `${year}.${month}`,
    cellCount,
    dayNumbers,
  };
}

test('calendar grid accepts the month-specific 35 or 42 cell layout', () => {
  assert.deepEqual(calendarGridExpectation(2026, 9), {
    year: 2026,
    month: 9,
    firstWeekday: 2,
    daysInMonth: 30,
    compactCellCount: 35,
    acceptableCellCounts: [35, 42],
  });
  assert.equal(assessCalendarMonthGrid(calendarSnapshot(2026, 9, 35), { year: 2026, month: 9 }).ready, true);
  assert.equal(assessCalendarMonthGrid(calendarSnapshot(2026, 9, 42), { year: 2026, month: 9 }).ready, true);

  const august = calendarGridExpectation(2026, 8);
  assert.equal(august.compactCellCount, 42);
  assert.deepEqual(august.acceptableCellCounts, [42]);
  assert.equal(assessCalendarMonthGrid(calendarSnapshot(2026, 8, 42), { year: 2026, month: 8 }).ready, true);
});

test('calendar grid supports compact February and rejects stale or malformed DOM', () => {
  assert.deepEqual(calendarGridExpectation(2026, 2).acceptableCellCounts, [28, 35, 42]);
  assert.equal(assessCalendarMonthGrid(calendarSnapshot(2026, 2, 28), { year: 2026, month: 2 }).ready, true);

  const staleMonth = assessCalendarMonthGrid(calendarSnapshot(2026, 8, 42), { year: 2026, month: 9 });
  assert.equal(staleMonth.ready, false);
  assert.match(staleMonth.reason, /title mismatch/);

  const wrongCount = assessCalendarMonthGrid(calendarSnapshot(2026, 9, 28), { year: 2026, month: 9 });
  assert.equal(wrongCount.ready, false);
  assert.match(wrongCount.reason, /cell count 28/);

  const brokenSequence = calendarSnapshot(2026, 9, 35);
  brokenSequence.dayNumbers[2] = null;
  const broken = assessCalendarMonthGrid(brokenSequence, { year: 2026, month: 9 });
  assert.equal(broken.ready, false);
  assert.match(broken.reason, /day sequence mismatch/);
});

test('canceled detail accepts only the known post-cancel name omission', () => {
  assert.equal(spacecloudReservationIdentityAccepted('RSCMP', { ok: true, errors: [] }), true);
  assert.equal(spacecloudReservationIdentityAccepted('RCCMP', { ok: false, errors: ['reserver-name'] }), true);
  assert.equal(spacecloudReservationIdentityAccepted('RSCMP', { ok: false, errors: ['reserver-name'] }), false);
  assert.equal(spacecloudReservationIdentityAccepted('RCCMP', { ok: false, errors: ['date'] }), false);
  assert.equal(spacecloudReservationIdentityAccepted('RCCMP', { ok: false, errors: ['reserver-name', 'time'] }), false);
});

test('UI candidate search can refresh before a delete inspection gives up', async () => {
  let reads = 0;
  let refreshes = 0;
  const page = {
    evaluate: async () => {
      reads += 1;
      if (reads === 1) {
        return { candidates: [], dayCellText: '20', visibleLinks: [] };
      }
      return {
        candidates: [{ text: '추20~22,최*환님', directHint: true }],
        dayCellText: '20 추20~22,최*환님',
        visibleLinks: [{ text: '추20~22,최*환님' }],
      };
    },
    waitForTimeout: async () => {},
  };

  const result = await waitForDirectEventCandidates(page, {
    date: '2026-08-20',
    startTime: '20:00',
    endTime: '22:00',
  }, {
    timeoutMs: 1000,
    intervalMs: 1,
    refreshAtMs: [0],
    refresh: async () => {
      refreshes += 1;
    },
  });

  assert.equal(refreshes, 1);
  assert.equal(result.refreshCount, 1);
  assert.equal(result.candidates.length, 1);
});

test('verification target keeps the exact reservation identity', () => {
  assert.deepEqual(directUploadVerificationTarget({
    taskId: 557,
    roomKey: 'c',
    date: '2026-08-20',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '최종환',
    reserverNameDisplay: '최*환님',
    reservationNo: '1312465263',
  }), {
    taskId: 557,
    requireTaskId: true,
    roomKey: 'c',
    date: '2026-08-20',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '최*환님',
    reservationNo: '1312465263',
  });

  assert.equal(classifyDirectUploadVerification(true, {
    ok: true,
    reservationNo: '1312465263',
    nameMatched: true,
    identityMatched: false,
    candidateCount: 1,
    candidates: [{ directHint: true }],
  }).status, 'needs-review');

  assert.deepEqual(classifyDirectUploadVerification(true, {
    ok: true,
    reservationNo: '1312465263',
    nameMatched: true,
    identityMatched: false,
    candidateCount: 1,
    candidates: [{ directHint: true }],
  }), {
    status: 'needs-review',
    error: 'SpaceCloud post-submit candidate did not match the expected reservation identity',
    verified: false,
  });

  assert.deepEqual(classifyDirectUploadVerification(true, {
    ok: false,
    reservationNo: '',
    nameMatched: true,
    identityMatched: false,
    candidateCount: 1,
    candidates: [{ directHint: true }],
  }), {
    status: 'needs-review',
    error: 'SpaceCloud post-submit candidate did not match the expected reservation identity',
    verified: false,
  });

  assert.equal(classifyDirectUploadVerification(false, {
    ok: true,
    reservationNo: '1312465263',
    nameMatched: true,
    identityMatched: false,
    candidateCount: 1,
    candidates: [{ directHint: true }],
  }).status, 'needs-review');

  assert.equal(classifyDirectUploadVerification(true, {
    ok: true,
    reservationNo: '1312465263',
    nameMatched: true,
    identityMatched: true,
    candidateCount: 1,
  }).status, 'submitted');
});

test('post-submit identity requires both reservation number and task id', () => {
  const popup = '직접 추가한 예약 건입니다. A홀 20평형-외부신발금지 예약자명 : 김*미님 예약내용 : 2026.11.26(목), 20:00~22:00, 2시간 메모 : Rhythmjoy Naver email DB sync / taskId=557 / naverReservationNo=1319633241';
  const row = {
    taskId: 557,
    requireTaskId: true,
    roomKey: 'a',
    date: '2026-11-26',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '김*미님',
    reservationNo: '1319633241',
  };

  assert.equal(popupDeleteVerification(popup, row).ok, true);
  const wrongTask = popupDeleteVerification(popup, { ...row, taskId: 558 });
  assert.equal(wrongTask.ok, false);
  assert.ok(wrongTask.errors.includes('task-id-mismatch:558'));
});

test('explicitly linked legacy mirrors use reservation, slot, room, and name when taskId is absent', () => {
  const popup = '직접 추가한 예약 건입니다. B홀 16평형-외부신발금지 예약자명 : 황*연님 예약내용 : 2026.09.04(금), 20:00~22:00, 2시간 메모 : Rhythmjoy Google Calendar sync / room=B홀 / googleEventId=c64e81k7ask174v14vanc864n0 / naverReservationNo=1289402981';
  const row = {
    taskId: 332,
    requireTaskId: true,
    allowLegacyTasklessIdentity: true,
    roomKey: 'b',
    date: '2026-09-04',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '황*연님',
    reservationNo: '1289402981',
  };

  const exact = popupDeleteVerification(popup, row);
  assert.equal(exact.ok, true);
  assert.equal(exact.identity.mode, 'legacy-reservation-number-and-name');
  assert.equal(exact.identity.legacyTasklessIdentityMatched, true);
  assert.deepEqual(exact.identity.observedTaskIds, []);
  assert.equal(popupDeleteVerification(popup, { ...row, allowLegacyTasklessIdentity: false }).ok, false);
  assert.equal(popupDeleteVerification(popup, { ...row, reserverName: '김*연님' }).ok, false);
  const conflictingTask = popupDeleteVerification(`${popup} / taskId=999`, row);
  assert.equal(conflictingTask.ok, false);
  assert.ok(conflictingTask.errors.includes('task-id-mismatch:332'));
});

test('delete verification reports the different reservation number occupying a rebooked slot', () => {
  const popup = '직접 추가한 예약 건입니다. A홀 20평형-외부신발금지 예약자명 : 이*지님 예약내용 : 2026.10.03(토), 12:00~14:00, 2시간 메모 : Rhythmjoy Naver email DB sync / taskId=649 / naverReservationNo=1323404722';
  const result = popupDeleteVerification(popup, {
    roomKey: 'a',
    date: '2026-10-03',
    startTime: '12:00',
    endTime: '14:00',
    reserverName: '이*지님',
    reservationNo: '1312804595',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['reservation-number-mismatch:1312804595']);
  assert.deepEqual(result.identity.observedReservationNos, ['1323404722']);
  assert.equal(result.identity.reservationNoMatched, false);
  assert.deepEqual(summarizeDeleteCandidateIdentityEvidence([{
    status: 'verification-failed',
    verification: result,
  }], 1, '1312804595'), {
    observedReservationNos: ['1323404722'],
    allCandidatesVerifiedAsDifferentReservations: true,
  });
  assert.equal(summarizeDeleteCandidateIdentityEvidence([{
    status: 'popup-not-opened',
  }], 1, '1312804595').allCandidatesVerifiedAsDifferentReservations, false);
});

test('calendar API verifies the exact task, reservation, date, time, and masked name', () => {
  const schedule = {
    id: 9665321,
    name: '김*미님',
    symd: '20261126',
    eymd: '20261126',
    shour: 20,
    ehour: 21,
    memo: 'Rhythmjoy Naver email DB sync / room=A홀 / emailEventId=596 / taskId=557 / naverReservationNo=1319633241',
  };
  const calendar = {
    ok: true,
    status: 200,
    productId: '108673',
    days: [
      { ymd: '20261126', externalSchedules: [schedule] },
      // The live endpoint can repeat the same schedule object. Its stable id
      // must deduplicate it without weakening identity checks.
      { ymd: '20261127', externalSchedules: [{ ...schedule }] },
    ],
  };
  const row = {
    taskId: 557,
    requireTaskId: true,
    roomKey: 'a',
    date: '2026-11-26',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '김*미님',
    reservationNo: '1319633241',
  };

  const exact = verifySpacecloudCalendarIdentity(calendar, row);
  assert.equal(exact.ok, true);
  assert.equal(exact.identityMatched, true);
  assert.equal(exact.candidateCount, 1);
  assert.equal(exact.candidates[0].scheduleId, '9665321');
  assert.equal(exact.candidates[0].endTime, '22:00');

  for (const changed of [
    { taskId: 558 },
    { reservationNo: '1319634015' },
    { date: '2026-11-27' },
    { startTime: '19:00' },
    { endTime: '23:00' },
  ]) {
    assert.equal(verifySpacecloudCalendarIdentity(calendar, { ...row, ...changed }).identityMatched, false);
  }
  assert.equal(
    verifySpacecloudCalendarIdentity(calendar, { ...row, reserverName: '표시형식 변경' }).identityMatched,
    true,
    'durable task/reservation identity must not be invalidated by a masked display-name change',
  );
});

test('calendar API rejects two distinct schedules with the same exact memo identity', () => {
  const schedule = {
    id: 9665321,
    name: '김*미님',
    symd: '20261126',
    eymd: '20261126',
    shour: 20,
    ehour: 21,
    memo: 'taskId=557 / naverReservationNo=1319633241',
  };
  const result = verifySpacecloudCalendarIdentity({
    ok: true,
    status: 200,
    productId: '108673',
    days: [{ ymd: '20261126', externalSchedules: [schedule, { ...schedule, id: 9665999 }] }],
  }, {
    taskId: 557,
    requireTaskId: true,
    date: '2026-11-26',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '김*미님',
    reservationNo: '1319633241',
  });
  assert.equal(result.identityMatched, false);
  assert.equal(result.identityCandidateCount, 2);
  assert.ok(result.identityVerification.errors.includes('duplicate-exact-identity'));
});

test('calendar API accepts only explicitly linked legacy taskless mirror identity', () => {
  const schedule = {
    id: 9448534,
    name: '황*연님',
    symd: '20260904',
    eymd: '20260904',
    shour: 20,
    ehour: 21,
    memo: 'Rhythmjoy Google Calendar sync / room=B홀 / googleEventId=c64e81k7ask174v14vanc864n0 / naverReservationNo=1289402981',
  };
  const calendar = {
    ok: true,
    status: 200,
    productId: '108674',
    days: [{ ymd: '20260904', externalSchedules: [schedule] }],
  };
  const row = {
    taskId: 332,
    requireTaskId: true,
    allowLegacyTasklessIdentity: true,
    date: '2026-09-04',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '황*연님',
    reservationNo: '1289402981',
  };

  const exact = verifySpacecloudCalendarIdentity(calendar, row);
  assert.equal(exact.identityMatched, true);
  assert.equal(exact.identityVerification.scheduleId, '9448534');
  assert.equal(exact.absenceBlockingCandidateCount, 1);
  assert.equal(exact.differentReservationCandidateCount, 0);
  assert.equal(verifySpacecloudCalendarIdentity(calendar, { ...row, allowLegacyTasklessIdentity: false }).identityMatched, false);
  assert.equal(verifySpacecloudCalendarIdentity(calendar, { ...row, reservationNo: '1289402982' }).identityMatched, false);
  assert.equal(verifySpacecloudCalendarIdentity(calendar, { ...row, reserverName: '김*연님' }).identityMatched, false);
  const conflictingTaskCalendar = {
    ...calendar,
    days: [{ ymd: '20260904', externalSchedules: [{ ...schedule, memo: `${schedule.memo} / taskId=999` }] }],
  };
  assert.equal(verifySpacecloudCalendarIdentity(conflictingTaskCalendar, row).identityMatched, false);
});

test('calendar API polling waits for the authoritative schedule instead of reading stale DOM', async () => {
  let clock = 0;
  let reads = 0;
  const row = {
    taskId: 557,
    requireTaskId: true,
    date: '2026-11-26',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '김*미님',
    reservationNo: '1319633241',
  };
  const result = await pollForSpacecloudCalendarIdentity({
    row,
    readCalendar: async () => {
      reads += 1;
      return {
        ok: true,
        status: 200,
        productId: '108673',
        days: reads < 3 ? [] : [{
          ymd: '20261126',
          externalSchedules: [{
            id: 9665321,
            name: '김*미님',
            symd: '20261126',
            eymd: '20261126',
            shour: 20,
            ehour: 21,
            memo: 'taskId=557 / naverReservationNo=1319633241',
          }],
        }],
      };
    },
    wait: async (delayMs) => { clock += delayMs; },
    now: () => clock,
    timeoutMs: 100,
    intervalMs: 10,
  });
  assert.equal(result.identityMatched, true);
  assert.equal(result.candidateReadCount, 3);
  assert.equal(result.waitedMs, 20);
});

test('calendar API absence requires consecutive authoritative reads and never treats API failure as absence', async () => {
  let clock = 0;
  let reads = 0;
  const row = {
    taskId: 557,
    requireTaskId: true,
    date: '2026-11-26',
    startTime: '20:00',
    endTime: '22:00',
    reservationNo: '1319633241',
  };
  const result = await pollForSpacecloudCalendarAbsence({
    row,
    readCalendar: async () => {
      reads += 1;
      if (reads === 1) return { ok: false, status: 503, error: 'calendar-api-http-503', days: [] };
      return { ok: true, status: 200, productId: '108673', days: [] };
    },
    wait: async (delayMs) => { clock += delayMs; },
    now: () => clock,
    timeoutMs: 100,
    intervalMs: 10,
    requiredConsecutiveReads: 2,
  });
  assert.equal(result.absenceConfirmed, true);
  assert.equal(result.candidateReadCount, 3);
  assert.equal(result.consecutiveAbsentReads, 2);

  const failed = await pollForSpacecloudCalendarAbsence({
    row,
    readCalendar: async () => ({ ok: false, status: 503, error: 'calendar-api-http-503', days: [] }),
    wait: async (delayMs) => { clock += delayMs; },
    now: () => clock,
    timeoutMs: 20,
    intervalMs: 10,
  });
  assert.equal(failed.absenceConfirmed, false);
  assert.equal(failed.reason, 'calendar-api-read-failed');
});

test('calendar API never treats a same-reservation taskId mismatch as absence', async () => {
  let clock = 0;
  const row = {
    taskId: 332,
    requireTaskId: true,
    date: '2026-09-04',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '황*연님',
    reservationNo: '1289402981',
  };
  const result = await pollForSpacecloudCalendarAbsence({
    row,
    readCalendar: async () => ({
      ok: true,
      status: 200,
      productId: '108674',
      days: [{
        ymd: '20260904',
        externalSchedules: [{
          id: 9448534,
          name: '황*연님',
          symd: '20260904',
          eymd: '20260904',
          shour: 20,
          ehour: 21,
          memo: 'naverReservationNo=1289402981',
        }],
      }],
    }),
    wait: async (delayMs) => { clock += delayMs; },
    now: () => clock,
    timeoutMs: 20,
    intervalMs: 10,
    requiredConsecutiveReads: 2,
  });

  assert.equal(result.candidateCount, 1);
  assert.equal(result.identityCandidateCount, 0);
  assert.equal(result.absenceBlockingCandidateCount, 1);
  assert.equal(result.differentReservationCandidateCount, 0);
  assert.equal(result.absenceConfirmed, false);
  assert.equal(result.consecutiveAbsentReads, 0);
});

test('calendar API absence preserves a proven different-reservation same-slot successor', async () => {
  let clock = 0;
  const result = await pollForSpacecloudCalendarAbsence({
    row: {
      taskId: 332,
      requireTaskId: true,
      date: '2026-09-04',
      startTime: '20:00',
      endTime: '22:00',
      reserverName: '황*연님',
      reservationNo: '1289402981',
    },
    readCalendar: async () => ({
      ok: true,
      status: 200,
      productId: '108674',
      days: [{
        ymd: '20260904',
        externalSchedules: [{
          id: 9550001,
          name: '김*희님',
          symd: '20260904',
          eymd: '20260904',
          shour: 20,
          ehour: 21,
          memo: 'taskId=901 / naverReservationNo=1399999999',
        }],
      }],
    }),
    wait: async (delayMs) => { clock += delayMs; },
    now: () => clock,
    timeoutMs: 20,
    intervalMs: 10,
    requiredConsecutiveReads: 2,
  });

  assert.equal(result.candidateCount, 1);
  assert.equal(result.identityCandidateCount, 0);
  assert.equal(result.absenceBlockingCandidateCount, 0);
  assert.equal(result.differentReservationCandidateCount, 1);
  assert.equal(result.absenceConfirmed, true);
  assert.equal(result.consecutiveAbsentReads, 2);
});

test('ambiguous upload retries are verification-only and never auto-resubmit', () => {
  assert.equal(directUploadRetryMode({ attempts: 4, sideEffectState: 'ready' }), 'safe-retry-before-submit');
  assert.equal(directUploadRetryMode({ attempts: 1, sideEffectState: 'armed' }), 'verification-only');
  assert.equal(directUploadRetryMode({ attempts: 1, sideEffectState: 'finalized' }), 'verification-only');
  assert.equal(directUploadRetryMode({ attempts: 1, sideEffectState: 'skipped' }), 'verification-only');
  assert.equal(directUploadRetryMode({ attempts: 0 }), 'new-submit');
  assert.equal(directUploadRetryMode({
    attempts: 1,
    previousResult: { retryMode: 'new-submit', submissionAttempted: false, error: 'add button not visible' },
  }), 'safe-retry-before-submit');
  assert.equal(directUploadRetryMode({
    attempts: 2,
    previousResult: { retryMode: 'safe-retry-before-submit', submissionAttempted: false },
  }), 'safe-retry-before-submit');
  assert.equal(directUploadRetryMode({
    attempts: 2,
    previousResult: { retryMode: 'verification-only', submissionAttempted: false },
  }), 'verification-only');
  assert.equal(directUploadRetryMode({
    attempts: 2,
    previousResult: { resubmitBlocked: true, submissionAttempted: false },
  }), 'verification-only');
  assert.equal(directUploadRetryMode({
    attempts: 1,
    previousResult: { submissionAttempted: false, error: 'unknown legacy failure' },
  }), 'verification-only');
  assert.equal(directUploadRetryMode({
    attempts: 1,
    previousResult: { submissionAttempted: true },
  }), 'verification-only');
  assert.equal(directUploadRetryMode({
    attempts: 2,
    recoveredFromStaleRunning: true,
    previousResult: {},
  }), 'verification-only');
  assert.equal(directUploadRetryMode({ attempts: 1, previousResult: {} }), 'verification-only');
});

test('DB timedelta midnight is normalized to 24:00', () => {
  const event = spacecloudUploadEventFromTask({
    id: 476,
    task_type: 'upload',
    room_key: 'd',
    reservation_date: '2026-08-05',
    start_time: '22:00:00',
    end_time: '1 day, 0:00:00',
    reservation_number: '1310000000',
    reserver_name: '홍*동님',
  });
  assert.equal(event.startTime, '22:00');
  assert.equal(event.endTime, '24:00');
});
