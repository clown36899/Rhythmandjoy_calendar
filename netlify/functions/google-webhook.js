import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const calendar = google.calendar({
  version: 'v3',
  auth: process.env.GOOGLE_CALENDAR_API_KEY
});

const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '6b9dbc066ad84e9ec2003fa58e65cd27a6aa64b77ea2c7f23f1fb890c16ecc4d@group.calendar.google.com' },
  { id: 'c', calendarId: '35ea46a1ffe4a53cc81aee9c21d5a8efebbdbfe6a39285dc83f0b5f9ae29ee49@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

async function syncRoomCalendar(room) {
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - 6);
  const timeMax = new Date();
  timeMax.setMonth(timeMax.getMonth() + 12);

  const response = await calendar.events.list({
    calendarId: room.calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: 2500,
    singleEvents: true,
    orderBy: 'startTime'
  });

  const events = response.data.items || [];
  
  const { error: deleteError } = await supabase
    .from('booking_events')
    .delete()
    .eq('room_id', room.id);

  if (deleteError) throw deleteError;

  for (const event of events) {
    if (!event.start || !event.end) continue;

    const startTime = event.start.dateTime || event.start.date;
    const endTime = event.end.dateTime || event.end.date;

    await supabase.from('booking_events').insert({
      room_id: room.id,
      google_event_id: event.id,
      title: event.summary || '예약',
      description: event.description || '',
      start_time: startTime,
      end_time: endTime
    });
  }

  return events.length;
}

async function syncAllCalendars() {
  const results = await Promise.all(
    rooms.map(async (room) => {
      const count = await syncRoomCalendar(room);
      return { room: room.id, count };
    })
  );
  return results;
}

export async function handler(event, context) {
  const channelId = event.headers['x-goog-channel-id'];
  const resourceState = event.headers['x-goog-resource-state'];

  console.log('📨 Google Calendar Webhook 수신:', { channelId, resourceState });

  // 초기 동기화 확인 메시지
  if (resourceState === 'sync') {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Webhook 검증 성공' })
    };
  }

  // 캘린더 변경 감지 → 자동 동기화 실행
  if (resourceState === 'exists') {
    console.log('🔄 캘린더 변경 감지, 자동 동기화 시작...');
    
    try {
      const results = await syncAllCalendars();
      console.log('✅ 자동 동기화 완료:', results);
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: '변경 감지 및 동기화 완료',
          results
        })
      };
    } catch (error) {
      console.error('❌ 자동 동기화 실패:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: '알림 수신 완료' })
  };
}
