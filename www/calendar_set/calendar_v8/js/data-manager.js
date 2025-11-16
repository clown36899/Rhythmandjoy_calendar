class DataManager {
  constructor() {
    this.supabase = null;
    this.cache = new Map();
  }

  async init() {
    const supabaseUrl = window.SUPABASE_URL || window.ENV?.SUPABASE_URL;
    const supabaseKey = window.SUPABASE_ANON_KEY || window.ENV?.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ ENV not loaded properly');
      return false;
    }

    const { createClient } = supabase;
    this.supabase = createClient(supabaseUrl, supabaseKey);

    console.log('✅ Supabase initialized');
    this.setupRealtimeSubscription();
    this.setupVisibilityHandler();
    return true;
  }

  setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('📱 화면 활성화 - 데이터 새로고침');
        this.cache.clear();
        if (window.calendar) {
          window.calendar.weekDataCache.clear();
          window.calendar.refresh();
        }
      }
    });

    window.addEventListener('online', () => {
      console.log('🌐 온라인 복구 - 데이터 새로고침');
      this.cache.clear();
      if (window.calendar) {
        window.calendar.weekDataCache.clear();
        window.calendar.refresh();
      }
    });

    console.log('✅ 모바일 화면 활성화 감지 설정 완료');
  }

  setupRealtimeSubscription() {
    const channel = this.supabase
      .channel('booking_events_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'booking_events'
        },
        (payload) => {
          console.log('📡 실시간 업데이트:', payload);
          this.cache.clear();
          if (window.calendar) {
            window.calendar.weekDataCache.clear(); // 주간 캐시도 무효화
            window.calendar.refresh();
          }
        }
      )
      .subscribe();

    console.log('✅ Realtime subscription active');
  }

  async fetchBookings(roomIds, startDate, endDate) {
    const cacheKey = `${roomIds.join(',')}_${startDate}_${endDate}`;
    
    if (this.cache.has(cacheKey)) {
      console.log('📦 캐시에서 로드:', cacheKey);
      return this.cache.get(cacheKey);
    }

    try {
      const { data, error } = await this.supabase
        .from('booking_events')
        .select('*')
        .in('room_id', roomIds)
        .gte('start_time', startDate)
        .lte('end_time', endDate)
        .order('start_time', { ascending: true });

      if (error) throw error;

      console.log(`✅ DB 조회 완료: ${data.length}개 이벤트`);
      this.cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error('❌ DB 조회 실패:', error);
      return [];
    }
  }

  convertToEvents(bookings) {
    return bookings.map(booking => {
      const start = new Date(booking.start_time);
      const end = new Date(booking.end_time);
      
      // 타임존 변환 로그 (첫 이벤트만)
      if (bookings.indexOf(booking) === 0) {
        console.log(`   🕐 [타임존] DB: ${booking.start_time} → JS: ${start.toLocaleString('ko-KR')}`);
      }
      
      return {
        id: booking.id,
        title: booking.title || '예약',
        start,
        end,
        roomId: booking.room_id,
        description: booking.description,
        raw: booking
      };
    });
  }
}

window.dataManager = new DataManager();
