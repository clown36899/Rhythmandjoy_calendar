import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const calendar = google.calendar({
  version: 'v3',
  auth: process.env.GOOGLE_CALENDAR_API_KEY
});

// 연습실 정보
const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
  { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

/**
 * 특정 날짜 범위만 동기화 (3주 윈도우)
 * @param {Object} room - 룸 정보 { id, calendarId }
 * @param {Date} timeMin - 시작 날짜
 * @param {Date} timeMax - 종료 날짜
 */
async function rangeSync(room, timeMin, timeMax) {
  try {
    console.log(`🔄 ${room.id}홀 범위 동기화: ${timeMin.toISOString().split('T')[0]} ~ ${timeMax.toISOString().split('T')[0]}`);

    const response = await calendar.events.list({
      calendarId: room.calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 500,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    console.log(`  📌 ${events.length}개 이벤트 발견`);

    // Google에서 가져온 이벤트 ID 목록
    const googleEventIds = new Set();
    const eventsToUpsert = [];
    
    for (const event of events) {
      if (!event.start || !event.start.dateTime) continue;

      googleEventIds.add(event.id);
      eventsToUpsert.push({
        room_id: room.id,
        google_event_id: event.id,
        title: event.summary || '(제목 없음)',
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        description: event.description || null,
        updated_at: new Date().toISOString()
      });
    }

    // Upsert (추가/수정)
    if (eventsToUpsert.length > 0) {
      const { error } = await supabase
        .from('booking_events')
        .upsert(eventsToUpsert, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`  ❌ ${room.id}홀 저장 오류:`, error.message);
        return 0;
      }
    }

    // 삭제 감지: DB에는 있지만 Google에는 없는 이벤트 삭제
    const { data: dbEvents, error: fetchError } = await supabase
      .from('booking_events')
      .select('google_event_id')
      .eq('room_id', room.id)
      .gte('start_time', timeMin.toISOString())
      .lte('end_time', timeMax.toISOString());

    if (!fetchError && dbEvents) {
      const eventsToDelete = dbEvents
        .filter(dbEvent => !googleEventIds.has(dbEvent.google_event_id))
        .map(dbEvent => dbEvent.google_event_id);

      if (eventsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('booking_events')
          .delete()
          .in('google_event_id', eventsToDelete);

        if (deleteError) {
          console.error(`  ❌ 삭제 오류:`, deleteError.message);
        } else {
          console.log(`  🗑️ ${eventsToDelete.length}개 이벤트 삭제됨`);
        }
      }
    }

    console.log(`  ✅ ${room.id}홀 ${eventsToUpsert.length}개 동기화 완료`);
    return eventsToUpsert.length;
  } catch (error) {
    console.error(`❌ ${room.id}홀 범위 동기화 실패:`, error.message);
    return 0;
  }
}

/**
 * 증분 동기화 (범위 기반, DB diff로 삭제 감지)
 * @param {Object} room - 룸 정보 { id, calendarId }
 */
async function incrementalSync(room) {
  try {
    console.log(`🔄 ${room.id}홀 증분 동기화 시작 (최근 3주)...`);

    // 최근 3주 범위 동기화 (DB diff로 삭제 자동 처리)
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 7); // 1주 전
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + 14); // 2주 후

    const count = await rangeSync(room, timeMin, timeMax);
    return count;
  } catch (error) {
    console.error(`❌ ${room.id}홀 증분 동기화 실패:`, error.message);
    return 0;
  }
}

/**
 * 모든 룸의 증분 동기화 (Webhook 트리거용)
 */
async function syncAllCalendarsIncremental() {
  console.log('🚀 전체 증분 동기화 시작...\n');
  
  const results = [];
  for (const room of rooms) {
    const count = await incrementalSync(room);
    results.push({ room: room.id, count });
  }
  
  console.log('\n✅ 전체 증분 동기화 완료!');
  return results;
}

/**
 * 전체 룸 초기 동기화 (최근 3주)
 */
async function syncAllCalendarsInitial() {
  console.log('🚀 초기 동기화 시작 (최근 3주)...\n');
  
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 7); // 1주 전
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 14); // 2주 후

  const results = [];
  for (const room of rooms) {
    const count = await rangeSync(room, timeMin, timeMax);
    results.push({ room: room.id, count });
  }
  
  console.log('\n✅ 초기 동기화 완료!');
  return results;
}

// 스크립트 직접 실행 시 (초기 동기화)
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAllCalendarsInitial()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('동기화 실패:', error);
      process.exit(1);
    });
}

export { 
  rangeSync, 
  incrementalSync, 
  syncAllCalendarsIncremental, 
  syncAllCalendarsInitial,
  rooms 
};
