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

// 📦 범위별 데이터 가져오기 (보이는 3주만!)
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
      extendedProps: {
        roomKey: booking.room_id,
        roomName: roomConfig.name || booking.room_id,
        googleEventId: booking.google_event_id,
        description: booking.description
      }
    };
  });
}

// Realtime 구독 설정 (변경 감지 → 캘린더 새로고침만)
export function subscribeToRealtimeUpdates(onUpdate) {
  const channel = supabase
    .channel('booking_changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'booking_events'
      },
      (payload) => {
        console.log('🔔 실시간 변경 감지:', payload.eventType);
        
        if (typeof onUpdate === 'function') {
          onUpdate(payload);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Supabase Realtime 구독 성공');
      }
    });

  return channel;
}

// 자동 Realtime 구독 (추가/삭제된 이벤트만 패치)
function autoSubscribeAndRefresh() {
  subscribeToRealtimeUpdates((payload) => {
    const eventType = payload.eventType; // INSERT, UPDATE, DELETE
    console.log(`🔔 ${eventType} 이벤트 감지`);
    
    // 변경된 룸 ID 확인
    const changedRoomId = payload?.new?.room_id || payload?.old?.room_id;
    
    if (!changedRoomId) {
      console.warn('⚠️ room_id를 찾을 수 없습니다');
      return;
    }
    
    if (typeof calendar === 'undefined') {
      console.warn('⚠️ 캘린더가 초기화되지 않았습니다');
      return;
    }
    
    const allCalendars = [calendar._prevCal, calendar._curCal, calendar._nextCal]
      .filter(cal => cal);
    
    // INSERT: 새 이벤트 추가
    if (eventType === 'INSERT' && payload.new) {
      const newEvent = convertToCalendarEvents([payload.new])[0];
      
      allCalendars.forEach(cal => {
        // 이미 존재하는지 확인
        const existing = cal.getEventById(newEvent.id);
        if (!existing) {
          cal.addEvent(newEvent);
          console.log(`➕ ${changedRoomId}홀 이벤트 추가: ${newEvent.title}`);
        }
      });
    }
    
    // UPDATE: 기존 이벤트 수정
    else if (eventType === 'UPDATE' && payload.new) {
      const updatedEvent = convertToCalendarEvents([payload.new])[0];
      
      allCalendars.forEach(cal => {
        const existing = cal.getEventById(updatedEvent.id);
        if (existing) {
          existing.setProp('title', updatedEvent.title);
          existing.setStart(updatedEvent.start);
          existing.setEnd(updatedEvent.end);
          console.log(`✏️ ${changedRoomId}홀 이벤트 수정: ${updatedEvent.title}`);
        }
      });
    }
    
    // DELETE: 기존 이벤트 삭제
    else if (eventType === 'DELETE' && payload.old) {
      const deletedId = payload.old.id;
      
      allCalendars.forEach(cal => {
        const existing = cal.getEventById(deletedId);
        if (existing) {
          existing.remove();
          console.log(`🗑️ ${changedRoomId}홀 이벤트 삭제: ${existing.title}`);
        }
      });
    }
  });
}

// DOM이 로드되면 자동으로 구독 시작
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(autoSubscribeAndRefresh, 2000);
  });
} else {
  setTimeout(autoSubscribeAndRefresh, 2000);
}

// 전역 객체로 export
window.SupabaseCalendar = {
  fetchBookings: fetchBookingsFromSupabase,
  convertToEvents: convertToCalendarEvents,
  subscribe: subscribeToRealtimeUpdates,
  supabase
};

console.log('✅ Supabase Realtime 모듈 로드 완료 (범위별 로드 모드)');
