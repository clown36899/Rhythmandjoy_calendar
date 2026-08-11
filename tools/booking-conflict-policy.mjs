const REAL_PLATFORMS = new Set(['naver', 'spacecloud']);

function text(value) {
  return String(value ?? '').trim();
}

function id(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function platform(row) {
  return text(row?.sourcePlatform || row?.source_platform).toLowerCase();
}

function sourceMode(row) {
  return text(row?.sourceMode || row?.source_mode).toLowerCase();
}

function currentStatus(row) {
  return text(row?.currentStatus || row?.current_status).toLowerCase();
}

function confirmedAt(row) {
  return text(
    row?.confirmedAt
    || row?.confirmed_at
    || row?.confirmedEmailReceivedAt
    || row?.confirmed_email_received_at,
  );
}

function confirmedEmailEventId(row) {
  return id(row?.confirmedEmailEventId || row?.confirmed_email_event_id);
}

function normalizeDate(value) {
  return text(value).slice(0, 10);
}

function normalizeTime(value) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

function sameSlot(left, right) {
  return text(left?.roomKey || left?.room_key).toLowerCase() === text(right?.roomKey || right?.room_key).toLowerCase()
    && normalizeDate(left?.date || left?.reservationDate || left?.reservation_date) === normalizeDate(right?.date || right?.reservationDate || right?.reservation_date)
    && normalizeTime(left?.startTime || left?.start_time) === normalizeTime(right?.startTime || right?.start_time)
    && normalizeTime(left?.endTime || left?.end_time) === normalizeTime(right?.endTime || right?.end_time);
}

function validConfirmedAt(value) {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text(value));
}

export function isAutomaticPriorityBooking(row) {
  const rowPlatform = platform(row);
  if (!REAL_PLATFORMS.has(rowPlatform)) return false;
  if (currentStatus(row) !== 'confirmed') return false;
  if (!confirmedEmailEventId(row) || !validConfirmedAt(confirmedAt(row))) return false;
  const mode = sourceMode(row);
  if (rowPlatform === 'naver') return mode === '' || mode === 'naver_email';
  return mode === 'spacecloud_email';
}

function compactBooking(row) {
  if (!row) return null;
  return {
    ...row,
    id: id(row.id),
    sourcePlatform: platform(row),
    sourceMode: sourceMode(row),
    currentStatus: currentStatus(row),
    confirmedAt: confirmedAt(row),
    confirmedEmailEventId: confirmedEmailEventId(row),
    roomKey: text(row.roomKey || row.room_key).toLowerCase(),
    date: normalizeDate(row.date || row.reservationDate || row.reservation_date),
    startTime: normalizeTime(row.startTime || row.start_time),
    endTime: normalizeTime(row.endTime || row.end_time),
    reservationNumber: text(row.reservationNumber || row.reservation_number),
    spacecloudReservationId: text(row.spacecloudReservationId || row.spacecloud_reservation_id),
  };
}

export function assessLaterReservationConflict({
  overlaps = [],
  currentLedgerId,
  currentPlatform,
} = {}) {
  const wantedLedgerId = id(currentLedgerId);
  const wantedPlatform = text(currentPlatform).toLowerCase();
  const confirmedReal = overlaps
    .map(compactBooking)
    .filter((row) => row?.id && REAL_PLATFORMS.has(row.sourcePlatform) && row.currentStatus === 'confirmed');
  const current = confirmedReal.find((row) => row.id === wantedLedgerId) || null;

  if (!wantedLedgerId || !REAL_PLATFORMS.has(wantedPlatform)) {
    return { decision: 'invalid', reason: 'current-booking-identity-missing', current: null, winner: null };
  }
  if (!current || current.sourcePlatform !== wantedPlatform) {
    return { decision: 'invalid', reason: 'current-ledger-not-found', current, winner: null };
  }

  const unknownPriorityBookings = confirmedReal.filter((row) => !isAutomaticPriorityBooking(row));
  if (unknownPriorityBookings.length > 0) {
    return {
      decision: 'ambiguous',
      reason: 'overlap-has-non-email-or-unknown-priority-booking',
      current,
      winner: null,
      unknownPriorityBookings,
    };
  }

  const ordered = [...confirmedReal].sort((left, right) => {
    const timeOrder = left.confirmedAt.localeCompare(right.confirmedAt);
    return timeOrder || left.id - right.id;
  });
  if (ordered.length === 1) {
    return { decision: 'clear', reason: 'no-other-confirmed-overlap', current, winner: current, ordered };
  }

  const firstTime = ordered[0].confirmedAt;
  const firstAtSameSecond = ordered.filter((row) => row.confirmedAt === firstTime);
  if (firstAtSameSecond.length !== 1) {
    return {
      decision: 'ambiguous',
      reason: 'earliest-booking-time-tie',
      current,
      winner: null,
      tiedBookings: firstAtSameSecond,
      ordered,
    };
  }

  if (ordered.length !== 2) {
    return {
      decision: 'ambiguous',
      reason: 'multiple-confirmed-overlaps-require-review',
      current,
      winner: null,
      ordered,
    };
  }

  const winner = ordered[0];
  const other = ordered.find((row) => row.id !== current.id) || null;
  if (!other) return { decision: 'invalid', reason: 'other-overlap-missing', current, winner, ordered };
  if (other.sourcePlatform === current.sourcePlatform) {
    return {
      decision: 'ambiguous',
      reason: 'same-platform-overlap-is-not-auto-cancelable',
      current,
      winner,
      ordered,
    };
  }
  if (winner.id === current.id) {
    return {
      decision: 'winner',
      reason: 'current-booking-is-strictly-earliest',
      current,
      winner,
      losers: [other],
      ordered,
    };
  }
  return { decision: 'later', reason: 'current-booking-is-strictly-later', current, winner, ordered };
}

export function cancellationPairForConflict(policy = {}) {
  let winner = null;
  let loser = null;
  if (policy.decision === 'later') {
    winner = compactBooking(policy.winner);
    loser = compactBooking(policy.current);
  } else if (policy.decision === 'winner' && Array.isArray(policy.losers) && policy.losers.length === 1) {
    winner = compactBooking(policy.winner);
    loser = compactBooking(policy.losers[0]);
  }
  if (!winner?.id || !loser?.id) return null;
  if (!isAutomaticPriorityBooking(winner) || !isAutomaticPriorityBooking(loser)) return null;
  if (winner.sourcePlatform === loser.sourcePlatform) return null;
  if (winner.confirmedAt >= loser.confirmedAt) return null;
  return {
    winner,
    loser,
    currentIsLoser: policy.decision === 'later',
  };
}

function childPayload(child) {
  const value = child?.payload;
  return value && typeof value === 'object' ? value : {};
}

function payloadBookingId(payload, key) {
  return id(payload?.[key]?.id || payload?.[`${key}Id`]);
}

export function assessCancellationGuard(snapshot = {}) {
  const child = snapshot.child || null;
  const sourceTask = snapshot.sourceTask || null;
  const loser = compactBooking(snapshot.loser);
  const queuedWinner = compactBooking(snapshot.winner);
  const payload = childPayload(child);
  const childId = id(child?.id);
  const childType = text(child?.taskType || child?.task_type);
  const expected = childType === 'naver_cancel'
    ? {
      losingPlatform: 'naver',
      sourceTaskType: 'upload',
      source: 'naver-later-reservation-conflict',
      action: 'cancel-naver-confirmed-reservation',
    }
    : childType === 'spacecloud_cancel'
      ? {
        losingPlatform: 'spacecloud',
        sourceTaskType: 'naver_block',
        source: 'spacecloud-later-reservation-conflict',
        action: 'cancel-spacecloud-confirmed-reservation',
      }
      : null;

  const reject = (reason, extra = {}) => ({ approved: false, decision: 'needs-review', reason, ...extra });
  if (!childId || !expected || text(child?.status) !== 'running' || !text(child?.claimToken || child?.claim_token)) {
    return reject('cancel-task-claim-or-type-invalid');
  }
  if (text(payload.source) !== expected.source || text(payload.action) !== expected.action) {
    return reject('cancel-task-action-invalid');
  }
  if (text(payload.priorityRule) !== 'first-email-confirmed-real-platform-wins-strict') {
    return reject('cancel-task-priority-policy-invalid');
  }

  const sourceTaskId = id(payload.sourceTaskId);
  if (!sourceTaskId || sourceTaskId !== id(sourceTask?.id)) return reject('source-task-identity-mismatch');
  if (text(payload.sourceTaskType) !== expected.sourceTaskType || text(sourceTask?.taskType || sourceTask?.task_type) !== expected.sourceTaskType) {
    return reject('source-task-type-mismatch');
  }

  const losingId = payloadBookingId(payload, 'losingBooking');
  const winningId = payloadBookingId(payload, 'winningBooking');
  if (!loser || !losingId || loser.id !== losingId || id(child?.ledgerId || child?.ledger_id) !== losingId) {
    return reject('losing-ledger-identity-mismatch');
  }
  if (!winningId) return reject('winning-ledger-identity-missing');
  if (!queuedWinner || queuedWinner.id !== winningId) return reject('winning-ledger-identity-mismatch');
  if (loser.sourcePlatform !== expected.losingPlatform) return reject('losing-platform-mismatch');
  if (!sameSlot(child, loser) || !sameSlot(sourceTask, loser)) return reject('cancel-source-ledger-slot-mismatch');

  const childEmailEventId = id(child?.emailEventId || child?.email_event_id);
  if (!childEmailEventId
    || childEmailEventId !== id(sourceTask?.emailEventId || sourceTask?.email_event_id)
    || childEmailEventId !== loser.confirmedEmailEventId) {
    return reject('cancel-source-ledger-email-event-mismatch');
  }

  if (expected.losingPlatform === 'naver') {
    const childReservation = text(child?.reservationNo || child?.reservation_number);
    if (!childReservation || childReservation !== loser.reservationNumber) return reject('naver-reservation-number-mismatch');
  } else {
    const childReservationId = text(payload.spacecloud_reservation_id || payload.spacecloudReservationId);
    if (!childReservationId || childReservationId !== loser.spacecloudReservationId) {
      return reject('spacecloud-reservation-id-mismatch');
    }
  }

  if (loser.currentStatus === 'canceled') {
    return {
      approved: false,
      decision: 'already-canceled',
      reason: 'losing-ledger-already-canceled',
      childId,
      sourceTaskId,
      winner: queuedWinner,
      loser,
    };
  }
  if (loser.currentStatus !== 'confirmed') return reject('losing-ledger-not-confirmed');

  const conflict = assessLaterReservationConflict({
    overlaps: snapshot.overlaps || [],
    currentLedgerId: losingId,
    currentPlatform: expected.losingPlatform,
  });
  if (conflict.decision === 'clear' || conflict.decision === 'winner') {
    return {
      approved: false,
      decision: 'conflict-cleared',
      reason: conflict.reason,
      childId,
      sourceTaskId,
      winner: queuedWinner,
      loser,
      conflict,
    };
  }
  if (conflict.decision !== 'later') return reject(`conflict-${conflict.reason}`, { conflict, loser });
  if (conflict.winner?.id !== winningId) return reject('winning-ledger-changed-since-queue', { conflict, loser });
  if (conflict.winner.sourcePlatform === loser.sourcePlatform) return reject('winner-platform-not-opposite', { conflict, loser });

  return {
    approved: true,
    decision: 'approved',
    reason: 'strict-email-order-and-identities-verified',
    childId,
    sourceTaskId,
    winner: conflict.winner,
    loser,
    conflict,
  };
}

export function conflictGuardSummary(guard = {}) {
  return {
    approved: guard.approved === true,
    decision: guard.decision || 'needs-review',
    reason: guard.reason || '',
    winnerLedgerId: id(guard.winner?.id || guard.conflict?.winner?.id),
    loserLedgerId: id(guard.loser?.id || guard.conflict?.current?.id),
    winnerPlatform: platform(guard.winner || guard.conflict?.winner),
    loserPlatform: platform(guard.loser || guard.conflict?.current),
    winnerConfirmedAt: confirmedAt(guard.winner || guard.conflict?.winner),
    loserConfirmedAt: confirmedAt(guard.loser || guard.conflict?.current),
  };
}
