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
      if (document.visibilityState === 'visible' && window.calendar) {
        console.log('📱 화면 활성화 - UI 갱신 (캐시는 증분 업데이트로 항상 최신)');
        // ✅ 증분 업데이트로 캐시가 항상 최신이므로 UI만 갱신
        window.calendar.refreshCurrentView();
      }
    });

    window.addEventListener('online', () => {
      if (window.calendar) {
        console.log('🌐 온라인 복구 - UI 갱신');
        window.calendar.refreshCurrentView();
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
          this.handleRealtimeChange(payload);
        }
      )
      .subscribe();

    console.log('✅ Realtime subscription active');
  }

  handleRealtimeChange(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    console.log(`🔄 [Realtime] ${eventType}`, { newId: newRecord?.id, oldId: oldRecord?.id });
    
    if (!window.calendar) return;

    // ✅ 증분 업데이트: ID 기반으로 캐시에서 직접 추가/수정/삭제
    if (eventType === 'INSERT' && newRecord) {
      this.handleIncrementalInsert(newRecord);
    } else if (eventType === 'UPDATE' && newRecord && oldRecord) {
      this.handleIncrementalUpdate(oldRecord.id, newRecord);
    } else if (eventType === 'DELETE' && oldRecord) {
      this.handleIncrementalDelete(oldRecord.id);
    }

    // UI 갱신 (캐시 유지)
    window.calendar.refreshCurrentView();
  }

  handleIncrementalInsert(record) {
    // 새 이벤트를 변환
    const newEvent = this.convertToEvents([record])[0];
    if (!newEvent) return;

    console.log(`   ➕ [증분INSERT] ID: ${record.id}, 날짜: ${record.start_time}`);

    // 영향받은 모든 주의 캐시에 추가
    const weekKeys = this.getAffectedWeekKeys(record);
    let addedCount = 0;

    console.log(`   🔍 영향받은 주: ${weekKeys.length}개`, weekKeys.map(k => k.substring(0, 10)));
    console.log(`   📦 현재 캐시 크기: ${window.calendar.weekDataCache.size}개`);

    for (const weekKey of weekKeys) {
      // Calendar의 모든 캐시 키 순회 (room signature 포함)
      for (const [cacheKey, events] of window.calendar.weekDataCache.entries()) {
        if (cacheKey.startsWith(weekKey + '_')) {
          events.push(newEvent);
          addedCount++;
          console.log(`   💾 추가: ${cacheKey} (총 ${events.length}개)`);
        }
      }
    }

    if (addedCount === 0) {
      console.warn(`   ⚠️ 캐시에 해당 주가 없어서 추가 안 됨! 현재 보는 주를 새로고침하면 보일 것입니다.`);
    }
  }

  handleIncrementalUpdate(oldId, newRecord) {
    const newEvent = this.convertToEvents([newRecord])[0];
    if (!newEvent) return;

    console.log(`   🔄 [증분UPDATE] ID: ${oldId}`);
    
    let updatedCount = 0;
    // 모든 캐시에서 해당 ID 찾아서 교체
    for (const [cacheKey, events] of window.calendar.weekDataCache.entries()) {
      const index = events.findIndex(e => e.id === oldId);
      if (index !== -1) {
        events[index] = newEvent;
        updatedCount++;
        console.log(`   💾 수정: ${cacheKey}`);
      }
    }
    
    // 캐시에 없는 UPDATE는 INSERT처럼 처리 (새 이벤트 추가)
    if (updatedCount === 0) {
      console.warn(`   ⚠️ 캐시에 없는 UPDATE → INSERT로 처리`);
      this.handleIncrementalInsert(newRecord);
    }
  }

  handleIncrementalDelete(deleteId) {
    console.log(`   ➖ [증분DELETE] ID: ${deleteId}`);
    
    let deletedCount = 0;
    // 모든 캐시에서 해당 ID 제거
    for (const [cacheKey, events] of window.calendar.weekDataCache.entries()) {
      const beforeLength = events.length;
      const filtered = events.filter(e => e.id !== deleteId);
      if (filtered.length < beforeLength) {
        window.calendar.weekDataCache.set(cacheKey, filtered);
        deletedCount++;
        console.log(`   💾 삭제: ${cacheKey} (${beforeLength} → ${filtered.length}개)`);
      }
    }
  }


  getAffectedWeekKeys(record) {
    // booking이 걸쳐있는 모든 주의 시작일 계산
    // ✅ Calendar.getWeekRange()와 동일한 로직 사용
    const start = new Date(record.start_time);
    const end = new Date(record.end_time);
    const weeks = [];
    
    let current = new Date(start);
    current.setHours(0, 0, 0, 0);
    
    // 해당 주의 일요일로 이동
    const day = current.getDay();
    current.setDate(current.getDate() - day); // 일요일 기준
    
    while (current <= end) {
      // ✅ toISOString() 사용 (Calendar.getWeekCacheKey()와 일치)
      weeks.push(current.toISOString());
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
