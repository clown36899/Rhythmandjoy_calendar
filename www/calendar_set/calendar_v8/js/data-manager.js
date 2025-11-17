class DataManager {
  constructor() {
    this.supabase = null;
    this.cache = new Map();
    this.cacheTimestamps = new Map(); // 캐시 freshness 추적
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
        console.log('📱 화면 활성화 - 현재 상태 유지하며 갱신');
        // 캐시를 stale로 표시 (clear 대신)
        this.markCachesStale();
        if (window.calendar) {
          // 현재 view 유지하며 필요한 주만 갱신
          window.calendar.refreshCurrentView();
        }
      }
    });

    window.addEventListener('online', () => {
      console.log('🌐 온라인 복구 - 현재 상태 유지하며 갱신');
      this.markCachesStale();
      if (window.calendar) {
        window.calendar.refreshCurrentView();
      }
    });

    console.log('✅ 모바일 화면 활성화 감지 설정 완료');
  }

  markCachesStale() {
    // 모든 캐시를 오래된 것으로 표시 (clear 대신)
    const now = Date.now();
    for (const key of this.cache.keys()) {
      this.cacheTimestamps.set(key, 0); // 0 = stale
    }
    console.log('⏰ 캐시를 stale로 표시 (삭제 안 함)');
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
          this.handleRealtimeChange(payload);
        }
      )
      .subscribe();

    console.log('✅ Realtime subscription active');
  }

  handleRealtimeChange(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    // INSERT: new만, DELETE: old만, UPDATE: 둘 다
    const affectedRecords = [];
    if (newRecord) affectedRecords.push(newRecord);
    if (oldRecord && eventType === 'DELETE') affectedRecords.push(oldRecord);
    
    console.log(`🔄 [Realtime] ${eventType} - 영향받은 레코드:`, affectedRecords.length);
    
    // 영향받은 주의 캐시만 무효화
    const affectedWeeks = new Set();
    for (const record of affectedRecords) {
      const weeks = this.getAffectedWeekKeys(record);
      weeks.forEach(w => affectedWeeks.add(w));
    }
    
    if (window.calendar && affectedWeeks.size > 0) {
      console.log(`   🗑️ 무효화할 주: ${affectedWeeks.size}개`);
      
      // ✅ Calendar의 주간 캐시 무효화 (올바른 키 포맷 사용)
      window.calendar.invalidateWeeks(Array.from(affectedWeeks));
      
      // ✅ DataManager의 범위 캐시도 무효화 (날짜 범위 겹치는 것)
      this.invalidateOverlappingCaches(affectedWeeks);
      
      // 현재 view만 갱신 (날짜 유지)
      window.calendar.refreshCurrentView();
    }
  }

  invalidateOverlappingCaches(affectedWeeks) {
    // affectedWeeks = Set of "YYYY-MM-DD" 문자열
    const weekDates = Array.from(affectedWeeks).map(w => new Date(w));
    
    // cache 키들을 순회하며 날짜 범위가 겹치는 것 삭제
    for (const cacheKey of Array.from(this.cache.keys())) {
      // cacheKey 형식: "a,b,c,d,e_2025-11-10T00:00:00.000Z_2025-11-17T00:00:00.000Z"
      const parts = cacheKey.split('_');
      if (parts.length >= 3) {
        const rangeStart = new Date(parts[1]);
        const rangeEnd = new Date(parts[2]);
        
        // 영향받은 주와 겹치는지 확인
        for (const weekDate of weekDates) {
          const weekEnd = new Date(weekDate);
          weekEnd.setDate(weekEnd.getDate() + 7);
          
          if (rangeStart < weekEnd && rangeEnd > weekDate) {
            this.cache.delete(cacheKey);
            this.cacheTimestamps.delete(cacheKey);
            console.log(`   🗑️ [DataManager 캐시삭제] ${cacheKey}`);
            break;
          }
        }
      }
    }
  }

  getAffectedWeekKeys(record) {
    // booking이 걸쳐있는 모든 주의 시작일 계산
    const start = new Date(record.start_time);
    const end = new Date(record.end_time);
    const weeks = [];
    
    let current = new Date(start);
    current.setHours(0, 0, 0, 0);
    
    // 해당 주의 일요일(또는 월요일)로 이동
    const day = current.getDay();
    current.setDate(current.getDate() - day); // 일요일 기준
    
    while (current <= end) {
      weeks.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 7);
    }
    
    return weeks;
  }

  async fetchBookings(roomIds, startDate, endDate) {
    const cacheKey = `${roomIds.join(',')}_${startDate}_${endDate}`;
    const now = Date.now();
    const cacheFreshness = this.cacheTimestamps.get(cacheKey) || 0;
    
    // 캐시가 있고 fresh하면 재사용 (5분 이내)
    if (this.cache.has(cacheKey) && (now - cacheFreshness) < 300000) {
      console.log('📦 [캐시HIT-FRESH]:', cacheKey);
      return this.cache.get(cacheKey);
    }
    
    // stale하거나 없으면 fetch
    if (this.cache.has(cacheKey)) {
      console.log('⏰ [캐시STALE] 재조회:', cacheKey);
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
      this.cacheTimestamps.set(cacheKey, now);
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
