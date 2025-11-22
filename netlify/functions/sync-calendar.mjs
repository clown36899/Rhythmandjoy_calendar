import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from './lib/price-calculator.mjs';

// 연습실 정보
const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
  { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

// Lazy initialization
let supabase = null;
let calendar = null;

function initClients() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(`❌ Supabase 환경 변수 미설정: URL=${!!process.env.SUPABASE_URL}, KEY=${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);
    }
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  if (!calendar) {
    if (!process.env.GOOGLE_CALENDAR_API_KEY) {
      throw new Error(`❌ Google API KEY 환경 변수 미설정`);
    }
    calendar = google.calendar({
      version: 'v3',
      auth: process.env.GOOGLE_CALENDAR_API_KEY
    });
  }
}

async function syncRoomCalendar(room) {
  const startTime = Date.now();
  const logs = [];
  
  try {
    logs.push(`[${room.id}] 시작`);
    
    // 🚀 모든 예약 이벤트 (매출 정보 필요) - 효율성 최적화
    const timeMin = new Date('2020-01-01T00:00:00Z');
    const timeMax = new Date();
    timeMax.setFullYear(timeMax.getFullYear() + 2);

    logs.push(`[${room.id}] Google Calendar API 호출 시작 (전체 동기화)`);
    const apiStartTime = Date.now();
    
    // 페이지네이션으로 모든 이벤트 가져오기
    let allEvents = [];
    let pageToken = null;

    do {
      try {
        const response = await calendar.events.list({
          calendarId: room.calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          pageToken: pageToken
        });

        const events = response.data.items || [];
        allEvents = allEvents.concat(events);
        pageToken = response.data.nextPageToken;

        if (pageToken) {
          logs.push(`[${room.id}] 페이지 로딩... ${allEvents.length}개 (다음 페이지 있음)`);
        }
      } catch (apiErr) {
        if (apiErr.message?.includes('404')) {
          logs.push(`[${room.id}] 이벤트 없음 (API 404)`);
          break;
        }
        throw apiErr;
      }
    } while (pageToken);

    const apiTime = Date.now() - apiStartTime;
    logs.push(`[${room.id}] API 호출 완료: ${allEvents.length}개 이벤트, ${(apiTime/1000).toFixed(1)}초`);

    // Supabase에 upsert
    logs.push(`[${room.id}] 가격 계산 시작`);
    const calcStartTime = Date.now();
    
    const eventsToUpsert = [];
    const pricesData = []; // event_prices용 데이터
    
    for (const event of allEvents) {
      if (!event.start || !event.start.dateTime) continue;

      // booking_events에는 메타데이터만 저장
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
    
    const prepTime = Date.now() - calcStartTime;
    logs.push(`[${room.id}] 이벤트 준비 완료: ${eventsToUpsert.length}개, ${(prepTime/1000).toFixed(1)}초`);
    
    // 200개씩 배치 upsert (booking_events) - 더 큰 배치로 속도 향상
    logs.push(`[${room.id}] booking_events 저장 시작 (${eventsToUpsert.length}개)`);
    const dbStartTime = Date.now();
    
    for (let i = 0; i < eventsToUpsert.length; i += 200) {
      const batch = eventsToUpsert.slice(i, i + 200);
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
    logs.push(`[${room.id}] booking_events 저장 완료: ${(dbTime/1000).toFixed(1)}초`);
    
    // event_prices 계산 및 저장
    logs.push(`[${room.id}] event_prices 계산 시작`);
    const priceStartTime = Date.now();
    
    // google_event_id로 booking_events 조회 (1000개씩 페이지네이션)
    const googleEventIds = eventsToUpsert.map(e => e.google_event_id);
    const allSavedEvents = [];
    
    for (let i = 0; i < googleEventIds.length; i += 1000) {
      const idBatch = googleEventIds.slice(i, i + 1000);
      const { data: savedEvents, error: fetchError } = await supabase
        .from('booking_events')
        .select('id, google_event_id, start_time, end_time, room_id, description')
        .eq('room_id', room.id)
        .in('google_event_id', idBatch);
      
      if (fetchError) {
        logs.push(`[${room.id}] ❌ booking_events 조회 실패 (배치 ${Math.floor(i / 1000) + 1}): ${fetchError.message}`);
      } else {
        allSavedEvents.push(...savedEvents);
      }
    }
    
    if (allSavedEvents.length > 0) {
      // 각 이벤트의 가격 계산
      const pricesToUpsert = [];
      for (const savedEvent of allSavedEvents) {
        const { price, priceType, isNaver } = await calculatePrice(
          savedEvent.start_time,
          savedEvent.end_time,
          savedEvent.room_id,
          savedEvent.description || ''
        );
        
        pricesToUpsert.push({
          booking_event_id: savedEvent.id,
          calculated_price: price,
          price_type: priceType,
          price_metadata: { is_naver: isNaver }
        });
      }
      
      // event_prices 저장 (200개씩)
      for (let i = 0; i < pricesToUpsert.length; i += 200) {
        const batch = pricesToUpsert.slice(i, i + 200);
        const { error: priceError } = await supabase
          .from('event_prices')
          .upsert(batch, {
            onConflict: 'booking_event_id'
          });
        
        if (priceError) {
          logs.push(`[${room.id}] ❌ event_prices 배치 ${Math.floor(i / 100) + 1} 오류: ${priceError.message}`);
        }
      }
      
      const priceTime = Date.now() - priceStartTime;
      logs.push(`[${room.id}] event_prices 저장 완료: ${pricesToUpsert.length}개, ${(priceTime/1000).toFixed(1)}초`);
    }
    
    const totalTime = Date.now() - startTime;
    logs.push(`[${room.id}] ✅ 전체 완료: ${eventsToUpsert.length}개, ${(totalTime/1000).toFixed(1)}초`);
    
    console.log(logs.join('\n'));
    return { room: room.id, count: eventsToUpsert.length, logs, totalTime };
  } catch (error) {
    logs.push(`[${room.id}] ❌ 오류: ${error.message}`);
    logs.push(`[${room.id}] Stack: ${error.stack}`);
    console.error(logs.join('\n'));
    return { room: room.id, count: 0, logs, error: error.message, stack: error.stack };
  }
}

async function syncAllCalendars(selectedRoomIds = null) {
  const overallStartTime = Date.now();
  
  // 선택된 연습실만 필터링
  const roomsToSync = selectedRoomIds 
    ? rooms.filter(room => selectedRoomIds.includes(room.id))
    : rooms;
  
  console.log(`🚀 캘린더 동기화 시작 (${roomsToSync.map(r => r.id.toUpperCase()).join(', ')}) - 순차 처리...\n`);
  
  // 클라이언트 초기화
  initClients();
  
  // 순차 처리로 안정성 향상 (배포 환경에서 타임아웃 방지)
  const results = [];
  for (const room of roomsToSync) {
    const result = await syncRoomCalendar(room);
    results.push(result);
    console.log(`[${room.id}] 완료, 다음 룸 진행...\n`);
  }
  
  const overallTime = Date.now() - overallStartTime;
  console.log(`\n✅ 동기화 완료! 총 ${(overallTime/1000).toFixed(1)}초`);
  
  return { results, overallTime };
}

export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Netlify 타임아웃 대비: 최대 20초로 제한 (Netlify Pro: 26초, 안전 마진)
  const timeoutMs = 20000;
  const startTime = Date.now();
  
  try {
    // 요청 body에서 선택된 연습실 확인
    let selectedRoomIds = null;
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        selectedRoomIds = body.rooms; // ['a', 'b', 'c'] 형태
      } catch (e) {
        // body 파싱 실패 시 전체 동기화
      }
    }
    
    const { results, overallTime } = await Promise.race([
      syncAllCalendars(selectedRoomIds),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`동기화 타임아웃 (${timeoutMs/1000}초 초과)`)), timeoutMs)
      )
    ]);
    
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
    console.error('❌ Handler 동기화 오류:', error);
    console.error('Stack:', error.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: error.message,
        errorType: error.constructor.name,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
    };
  }
}
