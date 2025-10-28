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
  auth: 'AIzaSyCLqM39X5vTjrNt1Vl5miRryXWkLYPqky8' // Google Calendar API 키
});

// 연습실 정보
const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
  { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

async function syncRoomCalendar(room) {
  try {
    console.log(`🔄 ${room.id}홀 동기화 시작...`);

    // 최근 3개월 이벤트 가져오기
    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 1);
    const timeMax = new Date();
    timeMax.setMonth(timeMax.getMonth() + 2);

    const response = await calendar.events.list({
      calendarId: room.calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    console.log(`  📌 ${events.length}개 이벤트 발견`);

    // Supabase에 업서트
    for (const event of events) {
      if (!event.start || !event.start.dateTime) continue;

      const eventData = {
        room_id: room.id,
        google_event_id: event.id,
        title: event.summary || '(제목 없음)',
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        description: event.description || null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('booking_events')
        .upsert(eventData, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`  ❌ 이벤트 저장 오류 (${event.id}):`, error.message);
      }
    }

    console.log(`  ✅ ${room.id}홀 동기화 완료`);
  } catch (error) {
    console.error(`❌ ${room.id}홀 동기화 실패:`, error.message);
  }
}

async function syncAllCalendars() {
  console.log('🚀 전체 캘린더 동기화 시작...\n');
  
  for (const room of rooms) {
    await syncRoomCalendar(room);
  }
  
  console.log('\n✅ 전체 동기화 완료!');
}

// 스크립트 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAllCalendars()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('동기화 실패:', error);
      process.exit(1);
    });
}

export { syncAllCalendars, syncRoomCalendar };
