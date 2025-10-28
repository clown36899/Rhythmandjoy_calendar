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

// 🚀 전체 데이터 캐시 (서버 요청 최소화)
let allBookingsCache = [];
let cacheLoaded = false;

// 전체 데이터 한 번만 로드 (초기화)
async function loadAllBookingsOnce() {
  if (cacheLoaded) return allBookingsCache;
  
  console.log('🔄 전체 예약 데이터 로드 중 (한 번만)...');
  
  try {
    const { data, error } = await supabase
      .from('booking_events')
      .select('*')
      .order('start_time', { ascending: true });
    
    if (error) {
      console.error('❌ 전체 데이터 로드 실패:', error);
      return [];
    }
    
    allBookingsCache = data || [];
    cacheLoaded = true;
    console.log(`✅ 전체 ${allBookingsCache.length}개 예약 캐시 완료 (이제 서버 요청 0)`);
    
    return allBookingsCache;
  } catch (error) {
    console.error('❌ 캐시 로드 오류:', error);
    return [];
  }
}

// 캐시에서 범위별 필터링 (서버 요청 없음!)
function getBookingsFromCache(roomId = null, startTime = null, endTime = null) {
  let filtered = allBookingsCache;
  
  if (roomId) {
    filtered = filtered.filter(b => b.room_id === roomId);
  }
  if (startTime) {
    filtered = filtered.filter(b => b.start_time >= startTime);
  }
  if (endTime) {
    filtered = filtered.filter(b => b.start_time <= endTime);
  }
  
  return filtered;
}

// 📦 범위별 데이터 가져오기 (캐시 사용, 서버 요청 0!)
export async function fetchBookingsFromSupabase(roomId = null, startTime = null, endTime = null) {
  // 캐시가 없으면 초기 로드
  if (!cacheLoaded) {
    await loadAllBookingsOnce();
  }
  
  // 캐시에서 필터링 (서버 요청 없음!)
  return getBookingsFromCache(roomId, startTime, endTime);
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
        if (typeof onUpdate === 'function') {
          onUpdate(payload);
        }
      }
    )
    .subscribe();

  return channel;
}

// 자동 Realtime 구독 (변경 감지 시 페이지 새로고침)
function autoSubscribeAndRefresh() {
  let reloadTimeout = null;
  let isFirstEvent = true;
  
  subscribeToRealtimeUpdates((payload) => {
    // 첫 이벤트만 로그 출력
    if (isFirstEvent) {
      console.log('🔔 변경 감지 → 3초 후 자동 새로고침');
      isFirstEvent = false;
    }
    
    // 연속된 변경 시 마지막 변경 후 3초 뒤에 새로고침
    if (reloadTimeout) {
      clearTimeout(reloadTimeout);
    }
    
    reloadTimeout = setTimeout(() => {
      console.log('🔄 페이지 새로고침...');
      location.reload();
    }, 3000); // 3초 대기 (연속 변경 대비)
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
