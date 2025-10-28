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

// 📦 범위별 데이터 가져오기 (필요한 범위만!)
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

// Realtime 구독 설정
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
        console.log('🔔 실시간 변경 감지:', payload);
        
        if (typeof onUpdate === 'function') {
          onUpdate(payload);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Supabase Realtime 구독 성공');
      } else {
        console.log('📡 Realtime 상태:', status);
      }
    });

  return channel;
}

// 자동 Realtime 구독 및 캘린더 새로고침
function autoSubscribeAndRefresh() {
  subscribeToRealtimeUpdates((payload) => {
    console.log('🔄 데이터 변경 감지, 캘린더 새로고침 중...');
    
    if (typeof calendar !== 'undefined') {
      const allCalendars = [calendar._prevCal, calendar._curCal, calendar._nextCal]
        .filter(cal => cal && typeof cal.refetchEvents === 'function');
      
      allCalendars.forEach(cal => {
        cal.refetchEvents();
        console.log('✅ 캘린더 이벤트 새로고침 완료');
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
