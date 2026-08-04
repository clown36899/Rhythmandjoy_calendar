import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDirectUploadVerification,
  directUploadVerificationTarget,
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
    roomKey: 'c',
    date: '2026-08-20',
    startTime: '20:00',
    endTime: '22:00',
    reserverName: '최종환',
    reserverNameDisplay: '최*환님',
    reservationNo: '1312465263',
  }), {
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
  }).status, 'needs-review');

  assert.equal(classifyDirectUploadVerification(true, {
    ok: true,
    reservationNo: '1312465263',
    nameMatched: true,
    identityMatched: true,
    candidateCount: 1,
  }).status, 'submitted');
});
