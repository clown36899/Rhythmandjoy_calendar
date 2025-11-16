// Supabase Realtime 연동 스크립트
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = window.SUPABASE_URL || 'https://izcdhoozlvcmjcbnvwoe.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6Y2Rob296bHZjbWpjYm52d29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2MjgyNjUsImV4cCI6MjA3NzIwNDI2NX0.W32NXxZoFhcWnVX9PqsHtSwxSPm1RFqnWI71wNigcE4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const roomConfigs = {
  a: { name: "A홀", color: "#F6BF26" },
  b: { name: "B홀", color: "rgb(87, 150, 200)" },
  c: { name: "C홀", color: "rgb(129, 180, 186)" },
  d: { name: "D홀", color: "rgb(125, 157, 106)" },
  e: { name: "E홀", color: "#4c4c4c" }
};

// 📦 범위별 데이터 가져오기 (보이는 범위만!)
export async function fetchBookingsFromSupabase(roomId = null, startTime = null, endTime = null) {
  try {
    let query = supabase
      .from('booking_events')
      .select('*')
      .order('start_time', { ascending: true });

    if (roomId) {
      query = query.eq('room_id', roomId);
    }
    if (startTime) {
      query = query.gte('start_time', startTime);
    }
    if (endTime) {
      query = query.lte('start_time', endTime);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Supabase 데이터 조회 오류:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('❌ fetchBookingsFromSupabase 오류:', error);
    return [];
  }
}

// Supabase 데이터를 FullCalendar 이벤트 형식으로 변환
export function convertToCalendarEvents(bookings) {
  return bookings.map(booking => {
    const roomConfig = roomConfigs[booking.room_id] || {};
    
    return {
      id: booking.id,
      title: booking.title,
      start: booking.start_time,
      end: booking.end_time,
      color: roomConfig.color || '#ccc',
      textColor: '#000',
      className: booking.room_id,  // ✅ CSS 위치 적용 (a, b, c, d, e)
      extendedProps: {
        roomKey: booking.room_id,
        roomName: roomConfig.name || booking.room_id,
        googleEventId: booking.google_event_id,
        description: booking.description
      }
    };
  });
}

// 대량 업데이트 감지 변수
let updateCount = 0;
let updateTimer = null;
let realtimeChannel = null;
const UPDATE_THRESHOLD = 50; // 1초 내 50개 이상 업데이트 시 중지
const UPDATE_WINDOW = 1000; // 1초

// Realtime 구독 설정 (booking_events 변경 감지)
export function subscribeToRealtimeUpdates(onUpdate) {
  const channel = supabase
    .channel('booking_events_realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'booking_events'
      },
      (payload) => {
        // 대량 업데이트 감지
        updateCount++;
        
        if (updateTimer) {
          clearTimeout(updateTimer);
        }
        
        updateTimer = setTimeout(() => {
          updateCount = 0; // 1초 후 카운터 리셋
        }, UPDATE_WINDOW);
        
        // 임계값 초과 시 Realtime 중지 및 새로고침 유도
        if (updateCount >= UPDATE_THRESHOLD) {
          console.warn(`⚠️ 대량 업데이트 감지 (${updateCount}개) - Realtime 일시 중지`);
          
          // Realtime 구독 중지
          if (realtimeChannel) {
            realtimeChannel.unsubscribe();
            realtimeChannel = null;
          }
          
          // 사용자에게 알림
          const message = `🔄 데이터베이스 동기화가 진행 중입니다.\n\n최신 데이터를 보려면 페이지를 새로고침하세요.`;
          
          // 알림 표시 (5초 후 자동 새로고침)
          if (confirm(message + '\n\n5초 후 자동으로 새로고침됩니다.\n\n지금 새로고침하시겠습니까?')) {
            window.location.reload();
          } else {
            setTimeout(() => {
              window.location.reload();
            }, 5000);
          }
          
          return; // 더 이상 업데이트 처리 안 함
        }
        
        if (typeof onUpdate === 'function') {
          onUpdate(payload);
        }
      }
    )
    .subscribe();

  realtimeChannel = channel;
  return channel;
}

// FullCalendar 슬라이드 인스턴스 가져오기 (fullcal_02.js에서)
function getAllCalendarInstances() {
  if (typeof window.calendar === 'undefined') return [];
  
  const candidates = [
    window.calendar?._prevCal, 
    window.calendar?._curCal, 
    window.calendar?._nextCal
  ];
  
  return candidates.filter(cal => cal && typeof cal.addEvent === 'function');
}

// 실시간 이벤트 업데이트 (페이지 리로드 없이!)
function updateCalendarEvent(payload) {
  const calendars = getAllCalendarInstances();
  
  if (calendars.length === 0) {
    console.warn('⚠️ FullCalendar 인스턴스가 아직 준비되지 않음');
    return;
  }
  
  const eventType = payload.eventType;
  
  if (eventType === 'INSERT' && payload.new) {
    // 새 이벤트 추가
    const booking = payload.new;
    const roomConfig = roomConfigs[booking.room_id] || {};
    
    const newEvent = {
      id: booking.id,
      title: booking.title,
      start: booking.start_time,
      end: booking.end_time,
      color: roomConfig.color || '#ccc',
      textColor: '#000',
      className: booking.room_id,  // ✅ A홀=a, B홀=b... (CSS 위치 적용!)
      extendedProps: {
        roomKey: booking.room_id,
        roomName: roomConfig.name || booking.room_id,
        googleEventId: booking.google_event_id,
        description: booking.description
      }
    };
    
    calendars.forEach(cal => {
      cal.addEvent(newEvent);
    });
    
    console.log('✅ 새 이벤트 추가:', booking.title);
    
  } else if (eventType === 'UPDATE' && payload.new) {
    // 기존 이벤트 수정
    const booking = payload.new;
    const roomConfig = roomConfigs[booking.room_id] || {};
    
    calendars.forEach(cal => {
      const existingEvent = cal.getEventById(booking.id);
      if (existingEvent) {
        existingEvent.setProp('title', booking.title);
        existingEvent.setStart(booking.start_time);
        existingEvent.setEnd(booking.end_time);
        existingEvent.setProp('color', roomConfig.color);
      }
    });
    
    console.log('✅ 이벤트 수정:', booking.title);
    
  } else if (eventType === 'DELETE' && payload.old) {
    // 이벤트 삭제
    const bookingId = payload.old.id;
    
    calendars.forEach(cal => {
      const existingEvent = cal.getEventById(bookingId);
      if (existingEvent) {
        existingEvent.remove();
      }
    });
    
    console.log('✅ 이벤트 삭제:', bookingId);
  }
}

// 자동 Realtime 구독 (실시간 업데이트, 리로드 없음!)
function autoSubscribeAndRefresh() {
  const channel = subscribeToRealtimeUpdates((payload) => {
    console.log('🔔 실시간 변경 감지:', payload.eventType);
    updateCalendarEvent(payload);
  });
  
  // 전역 참조 저장 (나중에 구독 해제 가능)
  window.supabaseChannel = channel;
}

// DOM이 로드되면 자동으로 구독 시작
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(autoSubscribeAndRefresh, 2000);
  });
} else {
  setTimeout(autoSubscribeAndRefresh, 2000);
}

console.log('✅ Supabase Realtime 모듈 로드 완료 (범위별 로드 모드)');

window.SupabaseCalendar = {
  fetchBookings: fetchBookingsFromSupabase,
  convertToEvents: convertToCalendarEvents,
  subscribe: subscribeToRealtimeUpdates
};
