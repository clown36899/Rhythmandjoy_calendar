// 단일 연습실 동기화 테스트 (A홀만)
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from './lib/price-calculator.js';

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
    
    logs.push('[6] 가격 계산 시작');
    const calcStart = Date.now();
    const eventsToUpsert = [];
    
    for (const event of events) {
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
    
    logs.push(`[7] 가격 계산 완료: ${eventsToUpsert.length}개, ${Date.now() - calcStart}ms`);
    
    logs.push('[8] Supabase 저장 시작');
    const dbStart = Date.now();
    
    const { error } = await supabase
      .from('booking_events')
      .upsert(eventsToUpsert, {
        onConflict: 'google_event_id',
        ignoreDuplicates: false
      });
    
    if (error) {
      logs.push(`[ERROR] DB 저장 실패: ${error.message}`);
      throw error;
    }
    
    logs.push(`[9] DB 저장 완료: ${Date.now() - dbStart}ms`);
    
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
