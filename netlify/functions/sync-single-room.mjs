// 단일 연습실 동기화 테스트 (A홀만)
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from './lib/price-calculator.mjs';

export async function handler(event, context) {
  const startTime = Date.now();
  const logs = [`[START] ${new Date().toISOString()}`];
  
  try {
    logs.push('[1] 환경 변수 확인');
    if (!process.env.SUPABASE_URL || !process.env.GOOGLE_CALENDAR_API_KEY) {
      throw new Error('환경 변수 없음');
    }
    
    logs.push('[2] Supabase 클라이언트 초기화');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    logs.push('[3] Google Calendar 클라이언트 초기화');
    const calendar = google.calendar({
      version: 'v3',
      auth: process.env.GOOGLE_CALENDAR_API_KEY
    });
    
    const room = {
      id: 'a',
      calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com'
    };
    
    logs.push('[4] Google Calendar API 호출 시작');
    const apiStart = Date.now();
    
    const response = await calendar.events.list({
      calendarId: room.calendarId,
      timeMin: new Date('2024-01-01T00:00:00Z').toISOString(),
      timeMax: new Date('2025-12-31T23:59:59Z').toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const events = response.data.items || [];
    logs.push(`[5] API 완료: ${events.length}개 이벤트, ${Date.now() - apiStart}ms`);
    
    logs.push('[6] 이벤트 준비 시작');
    const prepStart = Date.now();
    const eventsToUpsert = [];
    
    for (const event of events) {
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
    
    logs.push(`[7] 이벤트 준비 완료: ${eventsToUpsert.length}개, ${Date.now() - prepStart}ms`);
    
    logs.push('[8] booking_events 저장 시작');
    const dbStart = Date.now();
    
    const { error } = await supabase
      .from('booking_events')
      .upsert(eventsToUpsert, {
        onConflict: 'google_event_id',
        ignoreDuplicates: false
      });
    
    if (error) {
      logs.push(`[ERROR] booking_events 저장 실패: ${error.message}`);
      throw error;
    }
    
    logs.push(`[9] booking_events 저장 완료: ${Date.now() - dbStart}ms`);
    
    // event_prices 계산 및 저장
    logs.push('[10] event_prices 계산 시작');
    const priceStart = Date.now();
    
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
        logs.push(`[ERROR] booking_events 조회 실패 (배치 ${Math.floor(i / 1000) + 1}): ${fetchError.message}`);
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
      
      // event_prices 저장
      const { error: priceError } = await supabase
        .from('event_prices')
        .upsert(pricesToUpsert, {
          onConflict: 'booking_event_id'
        });
      
      if (priceError) {
        logs.push(`[ERROR] event_prices 저장 실패: ${priceError.message}`);
      } else {
        logs.push(`[11] event_prices 저장 완료: ${pricesToUpsert.length}개, ${Date.now() - priceStart}ms`);
      }
    }
    
    const totalTime = Date.now() - startTime;
    logs.push(`[END] 전체 완료: ${totalTime}ms`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        room: 'A',
        count: eventsToUpsert.length,
        totalTime: `${(totalTime/1000).toFixed(2)}초`,
        logs
      })
    };
    
  } catch (error) {
    logs.push(`[ERROR] ${error.message}`);
    console.error('Error:', error);
    console.error('Logs:', logs);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        logs
      })
    };
  }
}
