import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDirectUploadVerification,
  directUploadRetryMode,
  directUploadVerificationTarget,
  pollForVerifiedDirectCandidate,
  popupDeleteVerification,
  spacecloudUploadEventFromTask,
  waitForDirectEventCandidates,
} from './spacecloud-playwright-uploader.mjs';

test('post-submit verification refreshes the calendar before giving up', async () => {
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

test('stale same-time candidate is retried until exact identity matches', async () => {
  let clock = 0;
  let reads = 0;
  let refreshes = 0;
  const stale = { index: '0', text: '추20~22,신*람님', directHint: true };
  const exact = { index: '0', text: '추20~22,김*미님', directHint: true };

  const result = await pollForVerifiedDirectCandidate({
    readCandidates: async () => {
      reads += 1;
      const candidate = reads >= 3 ? exact : stale;
      return { candidates: [candidate], dayCellText: candidate.text, visibleLinks: [candidate] };
    },
    verifyCandidates: async (candidates) => {
      const candidate = candidates[0];
      const matched = candidate === exact;
      return {
        candidate: matched ? candidate : null,
        verification: matched ? { ok: true } : null,
        error: matched ? '' : 'date-mismatch|reservation-number-mismatch',
        attempts: [{ candidate, status: matched ? 'verified' : 'verification-failed' }],
      };
    },
    refresh: async () => { refreshes += 1; },
    wait: async (delayMs) => { clock += delayMs; },
    now: () => clock,
    timeoutMs: 100,
    intervalMs: 10,
    refreshAtMs: [5],
  });

  assert.equal(result.matched, true);
  assert.equal(result.selection.candidate, exact);
  assert.equal(result.verificationPasses, 3);
  assert.equal(result.refreshCount, 1);
  assert.equal(refreshes, 1);
});

test('candidate mismatch never becomes a successful verification', async () => {
  let clock = 0;
  const stale = { index: '0', text: '추20~22,신*람님', directHint: true };
  const result = await pollForVerifiedDirectCandidate({
    readCandidates: async () => ({ candidates: [stale] }),
    verifyCandidates: async () => ({
      candidate: null,
      error: 'reservation-number-mismatch',
      attempts: [{ candidate: stale, status: 'verification-failed' }],
    }),
    wait: async (delayMs) => { clock += delayMs; },
    now: () => clock,
    timeoutMs: 30,
    intervalMs: 10,
  });

  assert.equal(result.matched, false);
  assert.equal(result.verificationPasses, 4);
  assert.equal(result.selection.error, 'reservation-number-mismatch');
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

test('ambiguous upload retries are verification-only and never auto-resubmit', () => {
  assert.equal(directUploadRetryMode({ attempts: 0 }), 'new-submit');
  assert.equal(directUploadRetryMode({
    attempts: 1,
    previousResult: { submissionAttempted: false, error: 'add button not visible' },
  }), 'safe-retry-before-submit');
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
