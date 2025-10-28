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

// 🚀 전체 데이터를 메모리에 캐시 (룸별)
const cachedEvents = {
  a: [],
  b: [],
  c: [],
  d: [],
  e: []
};

let isDataLoaded = false;

// 🔥 페이지 로드 시 전체 데이터를 한 번에 가져오기 (효율적!)
export async function loadAllBookings() {
  if (isDataLoaded) {
    console.log('✅ 데이터 이미 로드됨 (캐시 사용)');
    return cachedEvents;
  }

  console.log('🚀 전체 예약 데이터 로드 시작...');
  const startTime = performance.now();

  try {
    const { data, error } = await supabase
      .from('booking_events')
      .select('*')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('❌ Supabase 데이터 조회 오류:', error);
      return cachedEvents;
    }

    // 룸별로 분류
    data.forEach(booking => {
      const roomId = booking.room_id;
      if (cachedEvents[roomId]) {
        const roomConfig = roomConfigs[roomId] || {};
        
        cachedEvents[roomId].push({
          id: booking.id,
          title: booking.title,
          start: booking.start_time,
          end: booking.end_time,
          color: roomConfig.color || '#ccc',
          textColor: '#000',
          extendedProps: {
            roomKey: roomId,
            roomName: roomConfig.name || roomId,
            googleEventId: booking.google_event_id,
            description: booking.description
          }
        });
      }
    });

    isDataLoaded = true;
    const loadTime = (performance.now() - startTime).toFixed(0);
    
    console.log(`✅ 전체 데이터 로드 완료 (${loadTime}ms)`);
    console.log(`   A홀: ${cachedEvents.a.length}개`);
    console.log(`   B홀: ${cachedEvents.b.length}개`);
    console.log(`   C홀: ${cachedEvents.c.length}개`);
    console.log(`   D홀: ${cachedEvents.d.length}개`);
    console.log(`   E홀: ${cachedEvents.e.length}개`);
    console.log(`   총합: ${data.length}개`);
    console.log('   💡 이제 모든 달력 이동이 네트워크 요청 없이 즉시 처리됩니다!');

    // 🔥 캘린더 자동 새로고침 (데이터 로드 완료 후)
    setTimeout(() => {
      if (typeof calendar !== 'undefined') {
        const allCalendars = [calendar._prevCal, calendar._curCal, calendar._nextCal]
          .filter(cal => cal && typeof cal.refetchEvents === 'function');
        
        if (allCalendars.length > 0) {
          allCalendars.forEach(cal => cal.refetchEvents());
          console.log('🔄 캘린더 자동 새로고침 완료 (데이터 로드 후)');
        }
      }
    }, 500);

    return cachedEvents;
  } catch (error) {
    console.error('❌ loadAllBookings 오류:', error);
    return cachedEvents;
  }
}

// 기존 함수 (호환성 유지, 이제는 캐시에서 필터링)
export async function fetchBookingsFromSupabase(roomId = null, startTime = null, endTime = null) {
  if (!isDataLoaded) {
    await loadAllBookings();
  }

  if (roomId && cachedEvents[roomId]) {
    return cachedEvents[roomId];
  }

  return [];
}

// Supabase 데이터를 FullCalendar 이벤트 형식으로 변환 (이제는 불필요하지만 호환성 유지)
export function convertToCalendarEvents(bookings) {
  return bookings;
}

// 🔄 캐시 갱신 (Realtime 업데이트 시 사용)
export async function refreshCache() {
  console.log('🔄 캐시 새로고침 중...');
  isDataLoaded = false;
  
  // 기존 캐시 초기화
  Object.keys(cachedEvents).forEach(key => {
    cachedEvents[key] = [];
  });
  
  await loadAllBookings();
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
  subscribeToRealtimeUpdates(async (payload) => {
    console.log('🔄 데이터 변경 감지, 캐시 새로고침 중...');
    
    await refreshCache();
    
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

// DOM이 로드되면 자동으로 데이터 로드 및 구독 시작
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadAllBookings();
    setTimeout(autoSubscribeAndRefresh, 2000);
  });
} else {
  loadAllBookings();
  setTimeout(autoSubscribeAndRefresh, 2000);
}

// 전역 객체로 export
window.SupabaseCalendar = {
  fetchBookings: fetchBookingsFromSupabase,
  convertToEvents: convertToCalendarEvents,
  subscribe: subscribeToRealtimeUpdates,
  refreshCache,
  getCachedEvents: () => cachedEvents,
  supabase
};

console.log('✅ Supabase Realtime 모듈 로드 완료 (전체 데이터 캐싱 모드)');
