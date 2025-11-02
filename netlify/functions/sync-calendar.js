import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from './lib/price-calculator.js';

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

async function syncRoomCalendar(room) {
  const startTime = Date.now();
  const logs = [];
  
  try {
    logs.push(`[${room.id}] 시작`);
    
    // 🚀 모든 예약 이벤트 가져오기 (제한 없음)
    const timeMin = new Date('2020-01-01T00:00:00Z');
    const timeMax = new Date();
    timeMax.setFullYear(timeMax.getFullYear() + 2);

    logs.push(`[${room.id}] Google Calendar API 호출 시작`);
    const apiStartTime = Date.now();
    
    // 페이지네이션으로 모든 이벤트 가져오기
    let allEvents = [];
    let pageToken = null;

    do {
      const response = await calendar.events.list({
        calendarId: room.calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 2500,
        singleEvents: true,
        orderBy: 'startTime',
        pageToken: pageToken
      });

      const events = response.data.items || [];
      allEvents = allEvents.concat(events);
      pageToken = response.data.nextPageToken;

      if (pageToken) {
        logs.push(`[${room.id}] 페이지 ${Math.ceil(allEvents.length / 2500)} 로드 중... (현재: ${allEvents.length}개)`);
      }
    } while (pageToken);

    const apiTime = Date.now() - apiStartTime;
    logs.push(`[${room.id}] API 호출 완료: ${allEvents.length}개 이벤트, ${(apiTime/1000).toFixed(1)}초`);

    // Supabase에 upsert
    logs.push(`[${room.id}] 가격 계산 시작`);
    const calcStartTime = Date.now();
    
    const eventsToUpsert = [];
    for (const event of allEvents) {
      if (!event.start || !event.start.dateTime) continue;

      const { price, priceType, isNaver } = calculatePrice(
        event.start.dateTime,
        event.end.dateTime,
        room.id,
        event.description || ''
      );

      eventsToUpsert.push({
        room_id: room.id,
        google_event_id: event.id,
        title: event.summary || '(제목 없음)',
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        description: event.description || null,
        price: price,
        price_type: priceType,
        is_naver: isNaver,
        updated_at: new Date().toISOString()
      });
    }
    
    const calcTime = Date.now() - calcStartTime;
    logs.push(`[${room.id}] 가격 계산 완료: ${eventsToUpsert.length}개, ${(calcTime/1000).toFixed(1)}초`);

    // 100개씩 배치 upsert
    logs.push(`[${room.id}] Supabase 저장 시작`);
    const dbStartTime = Date.now();
    
    for (let i = 0; i < eventsToUpsert.length; i += 100) {
      const batch = eventsToUpsert.slice(i, i + 100);
      const { error } = await supabase
        .from('booking_events')
        .upsert(batch, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false
        });

      if (error) {
        logs.push(`[${room.id}] ❌ 배치 ${Math.floor(i / 100) + 1} 오류: ${error.message}`);
      }
    }
    
    const dbTime = Date.now() - dbStartTime;
    const totalTime = Date.now() - startTime;
    logs.push(`[${room.id}] DB 저장 완료: ${(dbTime/1000).toFixed(1)}초`);
    logs.push(`[${room.id}] ✅ 전체 완료: ${eventsToUpsert.length}개, ${(totalTime/1000).toFixed(1)}초`);
    
    console.log(logs.join('\n'));
    return { room: room.id, count: eventsToUpsert.length, logs, totalTime };
  } catch (error) {
    logs.push(`[${room.id}] ❌ 오류: ${error.message}`);
    console.error(logs.join('\n'));
    return { room: room.id, count: 0, logs, error: error.message };
  }
}

async function syncAllCalendars() {
  const overallStartTime = Date.now();
  console.log('🚀 전체 캘린더 동기화 시작 (병렬 처리)...\n');
  
  // 병렬 처리로 속도 향상
  const promises = rooms.map(room => syncRoomCalendar(room));
  const results = await Promise.all(promises);
  
  const overallTime = Date.now() - overallStartTime;
  console.log(`\n✅ 전체 동기화 완료! 총 ${(overallTime/1000).toFixed(1)}초`);
  
  return { results, overallTime };
}

export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { results, overallTime } = await syncAllCalendars();
    
    // 모든 로그 수집
    const allLogs = [];
    results.forEach(r => {
      if (r.logs) allLogs.push(...r.logs);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: '전체 캘린더 동기화 완료',
        results: results.map(r => ({ room: r.room, count: r.count })),
        totalTime: `${(overallTime/1000).toFixed(1)}초`,
        logs: allLogs
      })
    };
  } catch (error) {
    console.error('동기화 오류:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: error.message,
        stack: error.stack
      })
    };
  }
}
