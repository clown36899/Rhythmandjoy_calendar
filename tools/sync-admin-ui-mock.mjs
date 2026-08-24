import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'www');
const port = Number(process.env.SYNC_ADMIN_MOCK_PORT || 8765);
const mockState = {
  createReservationCalls: [],
  createdReservations: [],
};

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function basePayload(date = '2026-08-13') {
  const reservations = date === '2026-08-13' ? [{
    id: 77,
    date: '2026-08-13',
    room: 'A',
    startHour: 15,
    endHour: 17,
    name: '기존 예약',
    source: 'naver',
    sourceLabel: '네이버 원장',
    status: 'confirmed',
    price: '100,000원',
    grossAmount: 100000,
    feeAmount: 1980,
    netAmount: 98020,
    naverStatus: 'source',
    spacecloudStatus: 'synced',
  }] : [];
  reservations.push(...mockState.createdReservations.filter((item) => item.date === date && item.status !== 'canceled'));
  return {
    ok: true,
    mode: 'db-live-queue',
    serverTime: new Date().toISOString(),
    settings: {},
    sessions: {},
    reservations,
    tasks: mockState.createdReservations.flatMap(mockAllOperationTasks),
    reflectionAudits: [],
    reflectionAuditSummary: { issueCount: 0, waitingCount: 0, okCount: 10 },
    monthSummary: {
      month: '2026-08',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      count: 1,
      revenue: 100000,
      netRevenue: 98020,
      feeRevenue: 1980,
      missingCount: 0,
      days: [{
        date: '2026-08-13',
        day: 13,
        count: 1,
        revenue: 100000,
        netRevenue: 98020,
        feeRevenue: 1980,
        missingCount: 0,
        rooms: { A: 1, B: 0, C: 0, D: 0, E: 0 },
      }],
    },
    revenueStats: {
      year: 2026,
      yearTotal: 59119600,
      yearNetTotal: 57500826,
      yearFeeTotal: 1618774,
      yearConfirmedCount: 365,
      yearMissingCount: 0,
      months: [{
        month: '2026-08',
        total: 7256400,
        netTotal: 6986896,
        feeTotal: 269504,
        confirmedCount: 365,
        missingCount: 0,
        dayAverage: 234077,
        weekendAverage: 659673,
        bookingAverage: 19881,
      }],
    },
    revenueComparison: null,
    industryComparison: null,
    adminSeries: [{
      id: 1,
      title: '테스트 월·금 정기대관',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      fifthWeekPolicy: 'exclude',
      name: '테스트 예약자',
      status: 'active',
      occurrenceCount: 8,
      visibleCount: 8,
      canceledCount: 0,
    }],
  };
}

function mockOperationTasks(reservation) {
  if (reservation.operationType === 'cancellation') {
    return mockCancellationTasks(reservation);
  }
  return mockRegistrationTasks(reservation);
}

function mockRegistrationTasks(reservation) {
  const polls = Number(reservation.operationPolls || 0);
  const attention = String(reservation.name || '').includes('확인필요');
  const naverStatus = polls < 1 ? 'pending' : (polls < 2 ? 'running' : 'done');
  let spacecloudStatus = polls < 2 ? 'pending' : (polls < 3 ? 'running' : 'done');
  if (attention && polls >= 3) spacecloudStatus = 'needs_review';
  const common = {
    reservationId: reservation.id,
    date: reservation.date,
    room: reservation.room,
    startHour: reservation.startHour,
    endHour: reservation.endHour,
    name: reservation.name,
    createdAt: reservation.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return [{
    ...common,
    id: String(reservation.id * 10 + 1),
    liveTaskId: reservation.id * 10 + 101,
    taskType: 'naver_block',
    actionLabel: '네이버 예약불가',
    status: naverStatus,
    naverStatus,
    spacecloudStatus: 'source',
  }, {
    ...common,
    id: String(reservation.id * 10 + 2),
    liveTaskId: reservation.id * 10 + 102,
    taskType: 'upload',
    actionLabel: '스페이스클라우드 예약등록',
    status: spacecloudStatus,
    naverStatus: 'source',
    spacecloudStatus,
    error: spacecloudStatus === 'needs_review'
      ? '관리자 입력 시간에 기존 실제 플랫폼 예약 1건이 확인되어 자동 반영을 중단했습니다.'
      : '',
  }];
}

function mockCancellationTasks(reservation) {
  const polls = Number(reservation.operationPolls || 0);
  const naverStatus = polls < 1 ? 'pending' : (polls < 2 ? 'running' : 'done');
  const spacecloudStatus = polls < 2 ? 'pending' : (polls < 3 ? 'running' : 'done');
  const common = {
    reservationId: reservation.id,
    date: reservation.date,
    room: reservation.room,
    startHour: reservation.startHour,
    endHour: reservation.endHour,
    name: reservation.name,
    createdAt: reservation.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return [{
    ...common,
    id: String(reservation.id * 10 + 3),
    liveTaskId: reservation.id * 10 + 103,
    taskType: 'naver_restore',
    actionLabel: '네이버 예약가능 복구',
    status: naverStatus,
    naverStatus,
    spacecloudStatus: 'source',
  }, {
    ...common,
    id: String(reservation.id * 10 + 4),
    liveTaskId: reservation.id * 10 + 104,
    taskType: 'delete',
    actionLabel: '스페이스클라우드 삭제',
    status: spacecloudStatus,
    naverStatus: 'source',
    spacecloudStatus,
  }];
}

function mockAllOperationTasks(reservation) {
  const registrationReservation = { ...reservation, operationType: 'registration', operationPolls: 3 };
  const tasks = mockRegistrationTasks(registrationReservation);
  if (reservation.operationType === 'cancellation') tasks.push(...mockCancellationTasks(reservation));
  return tasks;
}

function mockReservationOperation(reservation) {
  const tasks = mockOperationTasks(reservation);
  const statuses = tasks.map((task) => task.status);
  const state = statuses.some((status) => ['failed', 'needs_review'].includes(status))
    ? 'attention'
    : (statuses.every((status) => status === 'done') ? 'done' : (statuses.some((status) => ['done', 'running'].includes(status)) ? 'running' : 'pending'));
  return {
    reservation: {
      id: reservation.id,
      date: reservation.date,
      room: reservation.room,
      startHour: reservation.startHour,
      endHour: reservation.endHour,
      name: reservation.name,
      status: state === 'done' ? 'confirmed' : 'pending',
      createdAt: reservation.createdAt,
      updatedAt: new Date().toISOString(),
    },
    tasks,
    operationType: reservation.operationType || 'registration',
    state,
    updatedAt: new Date().toISOString(),
  };
}

function dateText(date) {
  return date.toISOString().slice(0, 10);
}

function fifthWeek(date) {
  return date.getUTCDate() >= 29;
}

function generatedOccurrences(body) {
  if (Array.isArray(body.occurrences)) return body.occurrences;
  const rules = Array.isArray(body.rules) ? body.rules : [];
  const rows = [];
  const cursor = new Date(`${body.startDate}T00:00:00Z`);
  const end = new Date(`${body.endDate}T00:00:00Z`);
  while (cursor <= end) {
    const isoWeekday = cursor.getUTCDay() || 7;
    rules.forEach((rule, ruleIndex) => {
      if (Number(rule.weekday) !== isoWeekday) return;
      const date = dateText(cursor);
      const isFifth = fifthWeek(cursor);
      const included = !(body.fifthWeekPolicy === 'exclude' && isFifth);
      rows.push({
        key: `r${ruleIndex}:${date}`,
        originalDate: date,
        date,
        weekday: isoWeekday,
        ruleIndex,
        room: rule.room,
        start: Number(rule.start),
        end: Number(rule.end),
        included,
        fifthWeek: isFifth,
        excludedReason: included ? '' : 'fifth_week',
        modified: false,
      });
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

function previewPayload(body) {
  const rows = generatedOccurrences(body).map((row) => {
    const conflicts = row.included && row.date === '2026-08-17' && row.room === 'C'
      ? [{ source: 'ledger', sourceLabel: '스페이스클라우드', id: 77, name: '기존 예약', date: row.date, room: row.room, start: 13, end: 15 }]
      : [];
    const status = !row.included ? 'excluded' : (conflicts.length ? 'conflict' : (row.modified ? 'modified' : 'ready'));
    return { ...row, conflicts, status };
  });
  const summary = {
    total: rows.length,
    included: rows.filter((row) => row.included).length,
    excluded: rows.filter((row) => !row.included).length,
    conflicts: rows.filter((row) => row.status === 'conflict').length,
    modified: rows.filter((row) => row.modified).length,
  };
  return {
    ok: true,
    startDate: body.startDate || rows[0]?.date,
    endDate: body.endDate || rows.at(-1)?.date,
    fifthWeekPolicy: body.fifthWeekPolicy || 'include',
    rules: body.rules || [],
    occurrences: rows,
    summary,
    previewHash: 'mock-preview',
  };
}

async function requestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/sync-admin/api.php') {
    const body = await requestBody(req);
    const action = url.searchParams.get('action') || 'bootstrap';
    if (action === 'mock_reset') {
      mockState.createReservationCalls = [];
      mockState.createdReservations = [];
      return json(res, { ok: true });
    }
    if (action === 'mock_state') {
      return json(res, {
        ok: true,
        createReservationCalls: mockState.createReservationCalls,
        createdReservations: mockState.createdReservations,
      });
    }
    if (action === 'create_reservation') {
      mockState.createReservationCalls.push({
        requestId: String(body.requestId || ''),
        name: String(body.name || ''),
      });
      const matchingCalls = mockState.createReservationCalls.filter((entry) => entry.name === body.name);
      await delay(250);
      if (body.name === 'UI 충돌 검사') {
        return json(res, { ok: false, error: 'reservation_overlap', message: '기존 예약과 겹칩니다.' }, 409);
      }
      if (body.name === 'UI 재시도 검사' && matchingCalls.length === 1) {
        return json(res, { ok: false, error: 'mock_temporary_failure', message: '모의 일시 장애' }, 503);
      }
      let createdReservation = mockState.createdReservations.find((item) => item.name === body.name);
      const wasCreated = !createdReservation;
      if (wasCreated) {
        createdReservation = {
          id: 8 + mockState.createdReservations.length + 1,
          date: String(body.date || ''),
          room: String(body.room || 'A'),
          startHour: Number(body.start),
          endHour: Number(body.end),
          name: String(body.name || ''),
          source: 'admin',
          sourceLabel: '관리자 입력',
          status: 'pending',
          naverStatus: 'pending',
          spacecloudStatus: 'pending',
          operationType: 'registration',
          operationPolls: 0,
          createdAt: new Date().toISOString(),
        };
        mockState.createdReservations.push(createdReservation);
      }
      const responsePayload = basePayload(body.date);
      return json(res, {
        ...responsePayload,
        reservationResult: {
          reservationId: createdReservation.id,
          createdCount: wasCreated ? 1 : 0,
          duplicateRequest: !wasCreated,
        },
        reservationOperation: mockReservationOperation(createdReservation),
      });
    }
    if (action === 'reservation_status') {
      const reservation = mockState.createdReservations.find((item) => Number(item.id) === Number(body.reservationId));
      if (!reservation) {
        return json(res, { ok: false, error: 'reservation_not_found', message: '관리자 예약 작업을 찾지 못했습니다.' }, 404);
      }
      reservation.operationPolls = Number(reservation.operationPolls || 0) + 1;
      if (reservation.operationPolls >= 3 && !String(reservation.name || '').includes('확인필요')) {
        if (reservation.operationType === 'cancellation') {
          reservation.status = 'canceled';
        } else {
          reservation.status = 'confirmed';
          reservation.naverStatus = 'done';
          reservation.spacecloudStatus = 'done';
        }
      }
      return json(res, {
        ok: true,
        serverTime: new Date().toISOString(),
        reservationOperation: mockReservationOperation(reservation),
      });
    }
    if (action === 'preview_recurring') return json(res, previewPayload(body));
    if (action === 'series_occurrences') {
      return json(res, {
        ok: true,
        seriesId: 1,
        occurrences: [
          { id: 11, seriesId: 1, date: '2026-08-03', room: 'C', start: 13, end: 15, status: 'confirmed' },
          { id: 12, seriesId: 1, date: '2026-08-10', room: 'C', start: 16, end: 17, status: 'confirmed' },
          { id: 13, seriesId: 1, date: '2026-08-14', room: 'C', start: 13, end: 15, status: 'confirmed' },
          { id: 14, seriesId: 1, date: '2026-08-17', room: 'C', start: 13, end: 15, status: 'canceling' },
        ],
      });
    }
    if (action === 'create_recurring') return json(res, { ...basePayload(), recurringResult: { seriesId: 2, createdCount: 8 } });
    if (action === 'cancel_admin_reservations') {
      const ids = Array.isArray(body.reservationIds) ? body.reservationIds.map(Number) : [];
      const reservations = mockState.createdReservations.filter((item) => ids.includes(Number(item.id)));
      reservations.forEach((reservation) => {
        reservation.status = 'canceling';
        reservation.operationType = 'cancellation';
        reservation.operationPolls = 0;
      });
      const requestedCount = reservations.length || (Number(body.seriesId || 0) > 0 ? 2 : 0);
      const response = {
        ...basePayload(body.date),
        cancelResult: { requestedCount, reservationIds: reservations.map((item) => item.id) },
      };
      if (reservations.length === 1) response.reservationOperation = mockReservationOperation(reservations[0]);
      return json(res, response);
    }
    return json(res, basePayload(body.date));
  }

  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '');
  const filePath = join(root, relative || 'sync-admin/index.html');
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const data = await readFile(filePath);
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`sync-admin UI mock listening on http://127.0.0.1:${port}/sync-admin/index.html\n`);
});
