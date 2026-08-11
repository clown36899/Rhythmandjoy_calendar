#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  assessCancellationGuard,
  assessLaterReservationConflict,
  cancellationPairForConflict,
  isAutomaticPriorityBooking,
} from './booking-conflict-policy.mjs';

function booking(id, sourcePlatform, confirmedAt, overrides = {}) {
  return {
    id,
    sourcePlatform,
    sourceMode: sourcePlatform === 'naver' ? '' : 'spacecloud_email',
    currentStatus: 'confirmed',
    confirmedAt,
    confirmedEmailEventId: id + 100,
    roomKey: 'a',
    date: '2026-08-19',
    startTime: '20:00',
    endTime: '22:00',
    reservationNumber: sourcePlatform === 'naver' ? `N${id}` : '',
    spacecloudReservationId: sourcePlatform === 'spacecloud' ? `S${id}` : '',
    ...overrides,
  };
}

const naver = booking(1, 'naver', '2026-08-11 12:00:01');
const spacecloud = booking(2, 'spacecloud', '2026-08-11 12:00:02');
assert.equal(isAutomaticPriorityBooking(naver), true);
assert.equal(isAutomaticPriorityBooking(spacecloud), true);
assert.equal(isAutomaticPriorityBooking({ ...naver, sourceMode: 'platform-export' }), false);
assert.equal(isAutomaticPriorityBooking({ ...spacecloud, confirmedEmailEventId: null }), false);

const later = assessLaterReservationConflict({
  overlaps: [spacecloud, naver],
  currentLedgerId: 2,
  currentPlatform: 'spacecloud',
});
assert.equal(later.decision, 'later');
assert.equal(later.winner.id, 1);
assert.deepEqual(
  [cancellationPairForConflict(later).winner.id, cancellationPairForConflict(later).loser.id],
  [1, 2],
);

const winnerWhenMailboxesArriveOutOfOrder = assessLaterReservationConflict({
  overlaps: [spacecloud, naver],
  currentLedgerId: 1,
  currentPlatform: 'naver',
});
assert.equal(winnerWhenMailboxesArriveOutOfOrder.decision, 'winner');
assert.deepEqual(winnerWhenMailboxesArriveOutOfOrder.losers.map((row) => row.id), [2]);
assert.deepEqual(
  [cancellationPairForConflict(winnerWhenMailboxesArriveOutOfOrder).winner.id, cancellationPairForConflict(winnerWhenMailboxesArriveOutOfOrder).loser.id],
  [1, 2],
);

assert.equal(assessLaterReservationConflict({
  overlaps: [naver],
  currentLedgerId: 1,
  currentPlatform: 'naver',
}).decision, 'clear');

assert.equal(assessLaterReservationConflict({
  overlaps: [naver, { ...spacecloud, confirmedAt: naver.confirmedAt }],
  currentLedgerId: 2,
  currentPlatform: 'spacecloud',
}).reason, 'earliest-booking-time-tie');
assert.equal(cancellationPairForConflict(assessLaterReservationConflict({
  overlaps: [naver, { ...spacecloud, confirmedAt: naver.confirmedAt }],
  currentLedgerId: 2,
  currentPlatform: 'spacecloud',
})), null);

assert.equal(assessLaterReservationConflict({
  overlaps: [naver, { ...spacecloud, sourceMode: 'spacecloud-settlement-api', confirmedEmailEventId: null }],
  currentLedgerId: 1,
  currentPlatform: 'naver',
}).reason, 'overlap-has-non-email-or-unknown-priority-booking');

assert.equal(assessLaterReservationConflict({
  overlaps: [naver, booking(3, 'naver', '2026-08-11 12:00:03')],
  currentLedgerId: 3,
  currentPlatform: 'naver',
}).reason, 'same-platform-overlap-is-not-auto-cancelable');
assert.equal(assessLaterReservationConflict({
  overlaps: [naver, booking(3, 'naver', '2026-08-11 12:00:03')],
  currentLedgerId: 1,
  currentPlatform: 'naver',
}).reason, 'same-platform-overlap-is-not-auto-cancelable');
assert.equal(assessLaterReservationConflict({
  overlaps: [naver, spacecloud, booking(4, 'spacecloud', '2026-08-11 12:00:04')],
  currentLedgerId: 1,
  currentPlatform: 'naver',
}).reason, 'multiple-confirmed-overlaps-require-review');

const child = {
  id: 50,
  status: 'running',
  claimToken: 'claim',
  taskType: 'spacecloud_cancel',
  ledgerId: 2,
  emailEventId: 102,
  roomKey: 'a',
  date: '2026-08-19',
  startTime: '20:00',
  endTime: '22:00',
  payload: {
    source: 'spacecloud-later-reservation-conflict',
    action: 'cancel-spacecloud-confirmed-reservation',
    sourceTaskId: 40,
    sourceTaskType: 'naver_block',
    priorityRule: 'first-email-confirmed-real-platform-wins-strict',
    winningBooking: { id: 1 },
    losingBooking: { id: 2 },
    spacecloud_reservation_id: 'S2',
  },
};
const sourceTask = {
  id: 40,
  taskType: 'naver_block',
  emailEventId: 102,
  roomKey: 'a',
  date: '2026-08-19',
  startTime: '20:00',
  endTime: '22:00',
};
const approved = assessCancellationGuard({ child, sourceTask, loser: spacecloud, winner: naver, overlaps: [naver, spacecloud] });
assert.equal(approved.approved, true);
assert.equal(approved.winner.id, 1);

assert.equal(assessCancellationGuard({
  child: { ...child, payload: { ...child.payload, winningBooking: { id: 999 } } },
  sourceTask,
  loser: spacecloud,
  winner: { ...naver, id: 999 },
  overlaps: [naver, spacecloud],
}).reason, 'winning-ledger-changed-since-queue');

assert.equal(assessCancellationGuard({
  child,
  sourceTask,
  loser: { ...spacecloud, currentStatus: 'canceled' },
  winner: naver,
  overlaps: [naver],
}).decision, 'already-canceled');

const clearedGuard = assessCancellationGuard({
  child,
  sourceTask,
  loser: spacecloud,
  winner: naver,
  overlaps: [spacecloud],
});
assert.equal(clearedGuard.decision, 'conflict-cleared');
assert.equal(clearedGuard.sourceTaskId, 40);
assert.equal(clearedGuard.winner.id, 1);

console.log('booking conflict policy tests passed');
