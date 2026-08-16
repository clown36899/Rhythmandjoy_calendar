import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WATCH_SOURCE = readFileSync(new URL('./spacecloud-watch.mjs', import.meta.url), 'utf8');
const UPLOADER_SOURCE = readFileSync(new URL('./spacecloud-playwright-uploader.mjs', import.meta.url), 'utf8');
const VERIFICATION_RETRY_BUDGET = 6;

const SIDE_EFFECT_TRANSITIONS = {
  ready: new Set(['armed', 'skipped']),
  armed: new Set(['finalized', 'skipped']),
  finalized: new Set(),
  skipped: new Set(),
};

function exactIdentity(taskId, reservationNo) {
  return {
    taskId: Number(taskId),
    reservationNo: String(reservationNo),
  };
}

function identityKey(identity) {
  return `${identity.taskId}|${identity.reservationNo}`;
}

class FakeDb {
  constructor() {
    this.ledgers = new Map();
    this.tasks = new Map();
    this.smsDeliveries = new Map();
  }

  createGeneration({ ledgerId, emailEventId, reservationNo, slot }) {
    const ledger = {
      id: ledgerId,
      confirmed_email_event_id: emailEventId,
      canceled_email_event_id: null,
      current_status: 'confirmed',
      reservation_number: reservationNo,
      slot: { ...slot },
    };
    this.ledgers.set(ledgerId, ledger);
    return ledger;
  }

  createUploadTask({ taskId, ledgerId }) {
    const ledger = this.ledger(ledgerId);
    const task = {
      id: taskId,
      task_type: 'upload',
      booking_ledger_id: ledgerId,
      email_event_id: ledger.confirmed_email_event_id,
      reservation_number: ledger.reservation_number,
      slot: { ...ledger.slot },
      status: 'pending',
      side_effect_state: 'ready',
      side_effect_history: ['ready'],
      claim_token: '',
      verification_attempts: 0,
      confirmation_sms_required: true,
    };
    this.tasks.set(taskId, task);
    this.smsDeliveries.set(taskId, {
      source_task_id: taskId,
      status: 'pending',
    });
    return task;
  }

  createDeleteTask({ taskId, ledgerId, targetUploadTaskId }) {
    const ledger = this.ledger(ledgerId);
    const upload = this.task(targetUploadTaskId);
    assert.equal(upload.booking_ledger_id, ledgerId);
    const task = {
      id: taskId,
      task_type: 'delete',
      booking_ledger_id: ledgerId,
      email_event_id: ledger.canceled_email_event_id,
      reservation_number: upload.reservation_number,
      target_upload_task_id: targetUploadTaskId,
      slot: { ...ledger.slot },
      status: 'pending',
      side_effect_state: 'ready',
      side_effect_history: ['ready'],
      claim_token: '',
    };
    this.tasks.set(taskId, task);
    return task;
  }

  createUnlinkedDeleteTask({ taskId, ledgerId, reservationNo }) {
    const ledger = this.ledger(ledgerId);
    const task = {
      id: taskId,
      task_type: 'delete',
      booking_ledger_id: ledgerId,
      email_event_id: ledger.canceled_email_event_id,
      reservation_number: reservationNo,
      target_upload_task_id: null,
      slot: { ...ledger.slot },
      status: 'pending',
      side_effect_state: 'ready',
      side_effect_history: ['ready'],
      claim_token: '',
    };
    this.tasks.set(taskId, task);
    return task;
  }

  ledger(id) {
    const row = this.ledgers.get(id);
    assert.ok(row, `ledger ${id} must exist`);
    return row;
  }

  task(id) {
    const row = this.tasks.get(id);
    assert.ok(row, `task ${id} must exist`);
    return row;
  }

  delivery(uploadTaskId) {
    const row = this.smsDeliveries.get(uploadTaskId);
    assert.ok(row, `SMS delivery for upload task ${uploadTaskId} must exist`);
    return row;
  }

  transition(taskId, nextState) {
    const task = this.task(taskId);
    const allowed = SIDE_EFFECT_TRANSITIONS[task.side_effect_state];
    assert.ok(allowed?.has(nextState), `${task.side_effect_state} -> ${nextState} is not allowed`);
    task.side_effect_state = nextState;
    task.side_effect_history.push(nextState);
    return task;
  }

  arm(taskId, claimToken = `claim-${taskId}-1`) {
    const task = this.transition(taskId, 'armed');
    task.status = 'running';
    task.claim_token = claimToken;
    return task;
  }

  finalize(taskId) {
    const task = this.transition(taskId, 'finalized');
    task.status = 'done';
    task.claim_token = '';
    return task;
  }

  skip(taskId) {
    const task = this.transition(taskId, 'skipped');
    task.status = task.task_type === 'delete' ? 'already_gone' : 'done';
    task.claim_token = '';
    if (task.task_type === 'upload') task.confirmation_sms_required = false;
    return task;
  }

  suppressConfirmationSms(uploadTaskId) {
    const task = this.task(uploadTaskId);
    task.confirmation_sms_required = false;
    const delivery = this.delivery(uploadTaskId);
    if (delivery.status !== 'sent') delivery.status = 'skipped';
  }

  cancelGeneration(ledgerId, { canceledEmailEventId, deleteTaskId }) {
    const ledger = this.ledger(ledgerId);
    ledger.current_status = 'canceled';
    ledger.canceled_email_event_id = canceledEmailEventId;

    const upload = [...this.tasks.values()].find((task) => (
      task.task_type === 'upload'
      && task.booking_ledger_id === ledgerId
      && task.email_event_id === ledger.confirmed_email_event_id
    ));
    assert.ok(upload, `upload task for ledger ${ledgerId} generation ${ledger.confirmed_email_event_id} must exist`);

    if (upload.side_effect_state === 'ready') this.skip(upload.id);
    this.suppressConfirmationSms(upload.id);
    return this.createDeleteTask({
      taskId: deleteTaskId,
      ledgerId,
      targetUploadTaskId: upload.id,
    });
  }
}

class FakeSpaceCloud {
  constructor() {
    this.schedules = new Map();
    this.createClicks = 0;
    this.deleteClicks = 0;
    this.deleteTargets = [];
  }

  hasExact(identity) {
    return this.schedules.has(identityKey(identity));
  }

  clickCreate(identity, slot) {
    const key = identityKey(identity);
    assert.equal(this.schedules.has(key), false, `duplicate create click for ${key}`);
    this.createClicks += 1;
    this.schedules.set(key, { ...identity, slot: { ...slot } });
  }

  clickDeleteExact(identity) {
    const key = identityKey(identity);
    assert.equal(this.schedules.has(key), true, `delete target ${key} must exist`);
    this.deleteClicks += 1;
    this.deleteTargets.push({ ...identity });
    this.schedules.delete(key);
  }

  snapshot() {
    return [...this.schedules.keys()].sort();
  }
}

class FakeSmsProvider {
  constructor() {
    this.calls = [];
  }

  send(identity) {
    this.calls.push({ ...identity });
  }
}

class UploadDeleteSaga {
  constructor({ db, spacecloud, smsProvider }) {
    this.db = db;
    this.spacecloud = spacecloud;
    this.smsProvider = smsProvider;
  }

  uploadIdentity(taskId) {
    const task = this.db.task(taskId);
    assert.equal(task.task_type, 'upload');
    return exactIdentity(task.id, task.reservation_number);
  }

  deleteTargetIdentity(taskId) {
    const task = this.db.task(taskId);
    assert.equal(task.task_type, 'delete');
    const upload = this.db.task(task.target_upload_task_id);
    return exactIdentity(upload.id, upload.reservation_number);
  }

  armUpload(taskId) {
    const task = this.db.task(taskId);
    const ledger = this.db.ledger(task.booking_ledger_id);
    assert.equal(ledger.current_status, 'confirmed', 'only the exact confirmed generation may arm');
    const unfinishedPriorDeletes = [...this.db.tasks.values()].filter((candidate) => (
      candidate.task_type === 'delete'
      && candidate.booking_ledger_id === task.booking_ledger_id
      && Number(candidate.email_event_id || 0) < Number(task.email_event_id || 0)
      && !(
        ['done', 'already_gone'].includes(candidate.status)
        && ['finalized', 'skipped'].includes(candidate.side_effect_state)
      )
    ));
    assert.deepEqual(
      unfinishedPriorDeletes.map((candidate) => candidate.id),
      [],
      'every earlier cancellation cleanup must finish before a later upload may arm',
    );
    this.db.arm(taskId);
  }

  clickUpload(taskId) {
    const task = this.db.task(taskId);
    assert.equal(task.side_effect_state, 'armed');
    this.spacecloud.clickCreate(this.uploadIdentity(taskId), task.slot);
  }

  recoverUpload(taskId, { apiAvailable = true } = {}) {
    const task = this.db.task(taskId);
    if (task.side_effect_state !== 'armed') return task;

    if (!apiAvailable) {
      task.verification_attempts += 1;
      task.status = 'running';
      task.recovery_status = 'upload-verification-pending';
      return task;
    }

    const identity = this.uploadIdentity(taskId);
    if (this.spacecloud.hasExact(identity)) return this.db.finalize(taskId);

    const ledger = this.db.ledger(task.booking_ledger_id);
    if (ledger.current_status === 'canceled') return this.db.skip(taskId);
    throw new Error('armed confirmed upload is still ambiguous and must remain verification-only');
  }

  completeUpload(taskId) {
    this.armUpload(taskId);
    this.clickUpload(taskId);
    return this.recoverUpload(taskId);
  }

  armDelete(taskId) {
    const task = this.db.task(taskId);
    const ledger = this.db.ledger(task.booking_ledger_id);
    const currentOrHistoricalCancellation = ledger.current_status === 'canceled'
      || Number(ledger.confirmed_email_event_id || 0) > Number(task.email_event_id || 0);
    assert.equal(currentOrHistoricalCancellation, true);
    this.db.arm(taskId);
  }

  clickDelete(taskId) {
    const task = this.db.task(taskId);
    assert.equal(task.side_effect_state, 'armed');
    this.spacecloud.clickDeleteExact(this.deleteTargetIdentity(taskId));
  }

  recoverDelete(taskId) {
    const task = this.db.task(taskId);
    if (task.side_effect_state !== 'armed') return task;
    const target = this.deleteTargetIdentity(taskId);
    if (this.spacecloud.hasExact(target)) this.spacecloud.clickDeleteExact(target);
    assert.equal(this.spacecloud.hasExact(target), false);
    return this.db.finalize(taskId);
  }

  reconcileDelete(taskId) {
    const task = this.db.task(taskId);
    if (!task.target_upload_task_id) {
      task.status = 'needs_review';
      task.blocked_reason = 'exact-prior-upload-generation-missing';
      return task;
    }
    if (task.side_effect_state === 'ready') {
      const upload = this.db.task(task.target_upload_task_id);
      const exactExists = this.spacecloud.hasExact(this.deleteTargetIdentity(taskId));
      if (upload.side_effect_state === 'skipped' && !exactExists) return this.db.skip(taskId);
      this.armDelete(taskId);
    }
    return this.recoverDelete(taskId);
  }

  dispatchConfirmationSms(uploadTaskId) {
    const task = this.db.task(uploadTaskId);
    const ledger = this.db.ledger(task.booking_ledger_id);
    const delivery = this.db.delivery(uploadTaskId);
    if (delivery.status === 'sent' || delivery.status === 'skipped') return delivery;

    const eligible = task.task_type === 'upload'
      && task.side_effect_state === 'finalized'
      && task.confirmation_sms_required === true
      && ledger.current_status === 'confirmed'
      && task.email_event_id === ledger.confirmed_email_event_id
      && task.reservation_number === ledger.reservation_number;
    if (!eligible) {
      this.db.suppressConfirmationSms(uploadTaskId);
      return delivery;
    }

    this.smsProvider.send(this.uploadIdentity(uploadTaskId));
    delivery.status = 'sent';
    task.confirmation_sms_required = false;
    return delivery;
  }
}

function setupGeneration({
  ledgerId = 1,
  emailEventId = 101,
  uploadTaskId = 501,
  reservationNo = 'R-001',
  slot = { roomKey: 'b', date: '2026-08-17', startTime: '18:00', endTime: '21:00' },
} = {}) {
  const db = new FakeDb();
  const spacecloud = new FakeSpaceCloud();
  const smsProvider = new FakeSmsProvider();
  db.createGeneration({ ledgerId, emailEventId, reservationNo, slot });
  db.createUploadTask({ taskId: uploadTaskId, ledgerId });
  return {
    db,
    spacecloud,
    smsProvider,
    saga: new UploadDeleteSaga({ db, spacecloud, smsProvider }),
    ledgerId,
    uploadTaskId,
  };
}

test('cancel-before-arm fences upload and delete without platform or SMS side effects', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, saga, ledgerId, uploadTaskId } = fixture;

  const deletion = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 601,
  });
  saga.reconcileDelete(deletion.id);
  saga.dispatchConfirmationSms(uploadTaskId);

  assert.deepEqual(db.task(uploadTaskId).side_effect_history, ['ready', 'skipped']);
  assert.equal(db.task(uploadTaskId).side_effect_state, 'skipped');
  assert.deepEqual(db.task(deletion.id).side_effect_history, ['ready', 'skipped']);
  assert.equal(db.task(deletion.id).side_effect_state, 'skipped');
  assert.deepEqual(spacecloud.snapshot(), []);
  assert.equal(spacecloud.createClicks, 0);
  assert.equal(spacecloud.deleteClicks, 0);
  assert.equal(db.delivery(uploadTaskId).status, 'skipped');
  assert.equal(smsProvider.calls.length, 0);
});

test('cancel-after-arm-before-click proves absence and closes both generations as skipped', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, ledgerId, uploadTaskId } = fixture;
  let saga = fixture.saga;

  saga.armUpload(uploadTaskId);
  const deletion = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 601,
  });

  // A new process has only the durable armed state and authoritative platform set.
  saga = new UploadDeleteSaga({ db, spacecloud, smsProvider });
  saga.recoverUpload(uploadTaskId);
  saga.reconcileDelete(deletion.id);
  saga.dispatchConfirmationSms(uploadTaskId);

  assert.deepEqual(db.task(uploadTaskId).side_effect_history, ['ready', 'armed', 'skipped']);
  assert.equal(db.task(uploadTaskId).side_effect_state, 'skipped');
  assert.deepEqual(db.task(deletion.id).side_effect_history, ['ready', 'skipped']);
  assert.equal(db.task(deletion.id).side_effect_state, 'skipped');
  assert.deepEqual(spacecloud.snapshot(), []);
  assert.equal(spacecloud.createClicks, 0);
  assert.equal(spacecloud.deleteClicks, 0);
  assert.equal(smsProvider.calls.length, 0);
});

test('crash-after-click-before-finalize recovers exact upload without a duplicate click', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, uploadTaskId } = fixture;
  let saga = fixture.saga;

  saga.armUpload(uploadTaskId);
  saga.clickUpload(uploadTaskId);
  assert.equal(db.task(uploadTaskId).side_effect_state, 'armed');

  saga = new UploadDeleteSaga({ db, spacecloud, smsProvider });
  saga.recoverUpload(uploadTaskId);
  saga.dispatchConfirmationSms(uploadTaskId);
  saga.dispatchConfirmationSms(uploadTaskId);

  assert.deepEqual(db.task(uploadTaskId).side_effect_history, ['ready', 'armed', 'finalized']);
  assert.equal(db.task(uploadTaskId).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.snapshot(), [`${uploadTaskId}|R-001`]);
  assert.equal(spacecloud.createClicks, 1);
  assert.equal(spacecloud.deleteClicks, 0);
  assert.deepEqual(smsProvider.calls, [exactIdentity(uploadTaskId, 'R-001')]);
});

test('delete-click-after-crash compensates the exact armed upload and preserves no mirror', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, ledgerId, uploadTaskId } = fixture;
  let saga = fixture.saga;

  saga.armUpload(uploadTaskId);
  saga.clickUpload(uploadTaskId);
  assert.equal(db.task(uploadTaskId).side_effect_state, 'armed');

  const deletion = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 601,
  });
  saga = new UploadDeleteSaga({ db, spacecloud, smsProvider });
  saga.recoverUpload(uploadTaskId);
  saga.reconcileDelete(deletion.id);
  saga.dispatchConfirmationSms(uploadTaskId);

  assert.deepEqual(db.task(uploadTaskId).side_effect_history, ['ready', 'armed', 'finalized']);
  assert.equal(db.task(uploadTaskId).side_effect_state, 'finalized');
  assert.deepEqual(db.task(deletion.id).side_effect_history, ['ready', 'armed', 'finalized']);
  assert.equal(db.task(deletion.id).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.snapshot(), []);
  assert.equal(spacecloud.createClicks, 1);
  assert.equal(spacecloud.deleteClicks, 1);
  assert.deepEqual(spacecloud.deleteTargets, [exactIdentity(uploadTaskId, 'R-001')]);
  assert.equal(smsProvider.calls.length, 0);
});

test('delete crash after click finalizes from exact absence without a second click', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, ledgerId, uploadTaskId } = fixture;
  let saga = fixture.saga;

  saga.completeUpload(uploadTaskId);
  const deletion = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 601,
  });
  saga.armDelete(deletion.id);
  saga.clickDelete(deletion.id);
  assert.equal(db.task(deletion.id).side_effect_state, 'armed');

  saga = new UploadDeleteSaga({ db, spacecloud, smsProvider });
  saga.recoverDelete(deletion.id);
  saga.dispatchConfirmationSms(uploadTaskId);

  assert.equal(db.task(uploadTaskId).side_effect_state, 'finalized');
  assert.deepEqual(db.task(deletion.id).side_effect_history, ['ready', 'armed', 'finalized']);
  assert.equal(db.task(deletion.id).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.snapshot(), []);
  assert.equal(spacecloud.createClicks, 1);
  assert.equal(spacecloud.deleteClicks, 1);
  assert.deepEqual(spacecloud.deleteTargets, [exactIdentity(uploadTaskId, 'R-001')]);
  assert.equal(smsProvider.calls.length, 0);
});

test('same-slot successor survives deletion by exact taskId and reservationNo identity', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, ledgerId, uploadTaskId } = fixture;
  const saga = fixture.saga;
  saga.completeUpload(uploadTaskId);
  const deletion = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 601,
  });

  const successorSlot = { ...db.ledger(ledgerId).slot };
  db.createGeneration({
    ledgerId: 2,
    emailEventId: 103,
    reservationNo: 'R-001',
    slot: successorSlot,
  });
  db.createUploadTask({ taskId: 502, ledgerId: 2 });
  saga.completeUpload(502);
  saga.reconcileDelete(deletion.id);

  assert.equal(db.task(deletion.id).side_effect_state, 'finalized');
  assert.equal(db.task(502).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.deleteTargets, [exactIdentity(uploadTaskId, 'R-001')]);
  assert.deepEqual(spacecloud.snapshot(), ['502|R-001']);
  assert.equal(spacecloud.createClicks, 2);
  assert.equal(spacecloud.deleteClicks, 1);
  assert.equal(smsProvider.calls.length, 0);
});

test('missing prior upload link blocks delete even when a reservation-number candidate exists', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, saga, ledgerId, uploadTaskId } = fixture;

  saga.completeUpload(uploadTaskId);
  const ledger = db.ledger(ledgerId);
  ledger.current_status = 'canceled';
  ledger.canceled_email_event_id = 102;
  const deletion = db.createUnlinkedDeleteTask({
    taskId: 601,
    ledgerId,
    reservationNo: 'R-001',
  });

  assert.equal(spacecloud.hasExact(exactIdentity(uploadTaskId, 'R-001')), true);
  saga.reconcileDelete(deletion.id);

  assert.equal(db.task(deletion.id).side_effect_state, 'ready');
  assert.deepEqual(db.task(deletion.id).side_effect_history, ['ready']);
  assert.equal(db.task(deletion.id).status, 'needs_review');
  assert.equal(db.task(deletion.id).blocked_reason, 'exact-prior-upload-generation-missing');
  assert.deepEqual(spacecloud.snapshot(), [`${uploadTaskId}|R-001`]);
  assert.equal(spacecloud.createClicks, 1);
  assert.equal(spacecloud.deleteClicks, 0);
  assert.deepEqual(spacecloud.deleteTargets, []);
});

test('two confirm-cancel generations clean only their own upload task identities', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, saga, ledgerId, uploadTaskId } = fixture;

  // E1 -> U1, then cancel E2 -> D2.
  saga.completeUpload(uploadTaskId);
  const deleteE2 = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 602,
  });
  saga.reconcileDelete(deleteE2.id);

  // Reconfirm E3 -> U3 only after D2 is terminal, then cancel E4 -> D4. Each
  // delete keeps its immutable upload task identity.
  db.createGeneration({
    ledgerId,
    emailEventId: 103,
    reservationNo: 'R-001',
    slot: { ...db.task(uploadTaskId).slot },
  });
  db.createUploadTask({ taskId: 503, ledgerId });
  saga.completeUpload(503);
  const deleteE4 = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 104,
    deleteTaskId: 604,
  });

  saga.reconcileDelete(deleteE4.id);

  assert.equal(db.task(deleteE2.id).target_upload_task_id, uploadTaskId);
  assert.equal(db.task(deleteE4.id).target_upload_task_id, 503);
  assert.equal(db.task(deleteE2.id).side_effect_state, 'finalized');
  assert.equal(db.task(deleteE4.id).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.deleteTargets, [
    exactIdentity(uploadTaskId, 'R-001'),
    exactIdentity(503, 'R-001'),
  ]);
  assert.deepEqual(spacecloud.snapshot(), []);
  assert.equal(spacecloud.createClicks, 2);
  assert.equal(spacecloud.deleteClicks, 2);
  assert.equal(smsProvider.calls.length, 0);
});

test('later upload waits for every earlier unresolved delete even when the latest delete is terminal', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, saga, ledgerId, uploadTaskId } = fixture;

  // Same-second total order is E1(101) < D2(102) < U3(103) < D4(104) < U5(105).
  saga.completeUpload(uploadTaskId);
  const deleteE2 = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 602,
  });

  // Model a pre-fix/concurrent U3 that slipped past unfinished D2. D4 still
  // cleans only U3, so U1 remains until D2 is reconciled.
  db.createGeneration({
    ledgerId,
    emailEventId: 103,
    reservationNo: 'R-001',
    slot: { ...db.task(uploadTaskId).slot },
  });
  db.createUploadTask({ taskId: 503, ledgerId });
  db.arm(503);
  spacecloud.clickCreate(exactIdentity(503, 'R-001'), db.task(503).slot);
  db.finalize(503);
  const deleteE4 = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 104,
    deleteTaskId: 604,
  });
  saga.reconcileDelete(deleteE4.id);

  db.createGeneration({
    ledgerId,
    emailEventId: 105,
    reservationNo: 'R-001',
    slot: { ...db.task(uploadTaskId).slot },
  });
  db.createUploadTask({ taskId: 505, ledgerId });

  assert.throws(
    () => saga.armUpload(505),
    /every earlier cancellation cleanup must finish/,
  );
  assert.equal(db.task(deleteE2.id).side_effect_state, 'ready');
  assert.equal(db.task(deleteE4.id).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.snapshot(), [`${uploadTaskId}|R-001`]);

  saga.reconcileDelete(deleteE2.id);
  saga.completeUpload(505);

  assert.equal(db.task(deleteE2.id).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.deleteTargets, [
    exactIdentity(503, 'R-001'),
    exactIdentity(uploadTaskId, 'R-001'),
  ]);
  assert.deepEqual(spacecloud.snapshot(), ['505|R-001']);
});

test('armed upload API ambiguity stays running past the retry budget and retains its claim', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, saga, uploadTaskId } = fixture;

  saga.armUpload(uploadTaskId);
  const recoveryClaim = 'recovery-claim-after-crash';
  db.task(uploadTaskId).claim_token = recoveryClaim;

  for (let attempt = 0; attempt < VERIFICATION_RETRY_BUDGET * 2; attempt += 1) {
    saga.recoverUpload(uploadTaskId, { apiAvailable: false });
    assert.equal(db.task(uploadTaskId).status, 'running');
    assert.equal(db.task(uploadTaskId).side_effect_state, 'armed');
    assert.equal(db.task(uploadTaskId).claim_token, recoveryClaim);
  }

  assert.equal(db.task(uploadTaskId).verification_attempts, VERIFICATION_RETRY_BUDGET * 2);
  assert.equal(db.task(uploadTaskId).recovery_status, 'upload-verification-pending');
  assert.equal(spacecloud.createClicks, 0);
  assert.deepEqual(spacecloud.snapshot(), []);
});

test('production source keeps the same exact-link and ambiguous-claim saga guards', () => {
  assert.match(UPLOADER_SOURCE, /requireTaskId:\s*Boolean\(mirrorTaskId\)/);
  assert.match(UPLOADER_SOURCE, /mode:\s*'ensure-absent'/);
  assert.match(UPLOADER_SOURCE, /consecutiveAbsentReads:\s*Number/);
  assert.match(WATCH_SOURCE, /exact prior upload generation is missing; automatic delete is blocked/);
  assert.match(WATCH_SOURCE, /function isSupersededCancellationCleanup\(task\)/);
  assert.match(WATCH_SOURCE, /function uploadDeleteDependencyRow\(task\)/);
  assert.match(WATCH_SOURCE, /COALESCE\(cleanup\.side_effect_state, ''\) IN \('finalized','skipped'\)/);
  assert.match(WATCH_SOURCE, /cleanup\.email_event_id < %s/);
  assert.doesNotMatch(WATCH_SOURCE, /status IN \('needs_review','failed','done','already_gone'\)\s+AND task_type='delete'/);
  assert.match(WATCH_SOURCE, /upload_event\.event_type='reservation'/);
  assert.match(WATCH_SOURCE, /event_order_trusted=1/);
  assert.match(WATCH_SOURCE, /AS sourceEventOrderTrusted/);
  assert.match(WATCH_SOURCE, /sourceEventOrderTrusted \?\? task\.source_event_order_trusted/);
  assert.match(WATCH_SOURCE, /cleanup\.booking_ledger_id IS NULL\s+AND cleanup\.reservation_number=%s/);
  assert.match(WATCH_SOURCE, /unresolved-lifecycle-quarantine/);
  assert.match(WATCH_SOURCE, /priorUnresolvedLifecycleEventId/);
  assert.doesNotMatch(WATCH_SOURCE, /OR upload\.email_event_id IS NULL/);
  assert.match(WATCH_SOURCE, /cleanup_event\.id IS NULL\s+OR COALESCE/);
  assert.match(WATCH_SOURCE, /COALESCE\(email_event_id, 0\) ASC/);
  assert.match(WATCH_SOURCE, /async function assertRemoteDurableTaskSchema\(args\)/);
  assert.match(WATCH_SOURCE, /exact_absence_proof_ok = bool/);
  assert.match(WATCH_SOURCE, /absent_verified_after_cancel/);
  assert.match(
    WATCH_SOURCE,
    /sideEffectOutcomeMayBeAmbiguous\(row, task\)\s*\?\s*'pending'\s*:\s*boundedVerificationDbStatus/,
  );
  assert.match(
    WATCH_SOURCE,
    /releaseClaim:\s*!\(status === 'pending' && sideEffectOutcomeMayBeAmbiguous\(row, task\)\)/,
  );
});

test('SMS canceled generation is suppressed even after its upload was finalized', () => {
  const fixture = setupGeneration();
  const { db, spacecloud, smsProvider, ledgerId, uploadTaskId } = fixture;
  const saga = fixture.saga;

  saga.completeUpload(uploadTaskId);
  const deletion = db.cancelGeneration(ledgerId, {
    canceledEmailEventId: 102,
    deleteTaskId: 601,
  });
  saga.dispatchConfirmationSms(uploadTaskId);
  saga.reconcileDelete(deletion.id);

  assert.equal(db.task(uploadTaskId).side_effect_state, 'finalized');
  assert.equal(db.task(uploadTaskId).confirmation_sms_required, false);
  assert.equal(db.delivery(uploadTaskId).status, 'skipped');
  assert.equal(db.task(deletion.id).side_effect_state, 'finalized');
  assert.deepEqual(spacecloud.snapshot(), []);
  assert.equal(spacecloud.createClicks, 1);
  assert.equal(spacecloud.deleteClicks, 1);
  assert.equal(smsProvider.calls.length, 0);
});
