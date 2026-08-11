import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDirectUploadVerification,
  directUploadRetryMode,
  directUploadVerificationTarget,
  pollForSpacecloudCalendarIdentity,
  popupDeleteVerification,
  spacecloudUploadEventFromTask,
  verifySpacecloudCalendarIdentity,
  waitForDirectEventCandidates,
} from './spacecloud-playwright-uploader.mjs';

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
    { reserverName: '박*수님' },
  ]) {
    assert.equal(verifySpacecloudCalendarIdentity(calendar, { ...row, ...changed }).identityMatched, false);
  }
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

test('ambiguous upload retries are verification-only and never auto-resubmit', () => {
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
