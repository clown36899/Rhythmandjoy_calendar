import assert from 'node:assert/strict';
import test from 'node:test';

import { selectNaverScheduleEditorPanel } from './naver-playwright-availability.mjs';

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
