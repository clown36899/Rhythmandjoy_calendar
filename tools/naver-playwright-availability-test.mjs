import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHourlySlotRows,
  partitionNaverActionableSlotRows,
  selectNaverScheduleEditorPanel,
} from './naver-playwright-availability.mjs';

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
