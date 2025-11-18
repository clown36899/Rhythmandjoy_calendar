class DataManager {
  constructor() {
    this.supabase = null;
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.MAX_CACHE_SIZE = 15; // LRU: 최대 15주 캐시
    this.CACHE_TTL = 15 * 60 * 1000; // TTL: 15분
    this.startCacheCleanup();
  }

  startCacheCleanup() {
    // 10분마다 오래된 캐시 자동 정리
    setInterval(() => {
      this.cleanupOldCache();
    }, 10 * 60 * 1000);
  }

  cleanupOldCache() {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      devLog(`🧹 [캐시정리] ${deletedCount}개 삭제됨 (남은 캐시: ${this.cache.size}개)`);
    }
  }

  enforceCacheSizeLimit() {
    // LRU: 최대 캐시 크기 초과 시 가장 오래된 항목 삭제
    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.cacheTimestamps.delete(oldestKey);
      devLog(`🧹 [LRU캐시] 최대 크기 초과로 가장 오래된 캐시 삭제: ${oldestKey.substring(0, 30)}...`);
    }
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

    devLog('✅ Supabase initialized');
    this.setupRealtimeSubscription();
    this.setupVisibilityHandler();
    return true;
  }

  setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && window.calendar) {
        devLog('🥇 [화면 복귀] 전체 캐시 리셋 후 현재 3주 재조회');
        window.calendar.weekDataCache.clear();
        window.calendar.refreshCurrentView();
      }
    });

    window.addEventListener('online', () => {
      if (window.calendar) {
        devLog('🌐 [온라인 복구] 전체 캐시 리셋 후 재조회');
        window.calendar.weekDataCache.clear();
        window.calendar.refreshCurrentView();
      }
    });

    devLog('✅ 모바일 화면 활성화 감지 설정 완료');
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
          devLog('📡 실시간 업데이트:', payload);
          this.handleRealtimeChange(payload);
        }
      )
      .subscribe();

    devLog('✅ Realtime subscription active');
  }

  handleRealtimeChange(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    devLog(`🔄 [Realtime] ${eventType}`, { newId: newRecord?.id, oldId: oldRecord?.id });
    
    if (!window.calendar) return;

    if (eventType === 'INSERT' && newRecord) {
      this.handleIncrementalInsert(newRecord);
    } else if (eventType === 'UPDATE' && newRecord && oldRecord) {
      this.handleIncrementalUpdate(oldRecord.id, newRecord);
    } else if (eventType === 'DELETE' && oldRecord) {
      this.handleIncrementalDelete(oldRecord.id);
    }

    window.calendar.refreshCurrentView();
  }

  handleIncrementalInsert(record) {
    const newEvent = this.convertToEvents([record])[0];
    if (!newEvent) return;

    devLog(`   ➕ [증분INSERT] ID: ${record.id}, 날짜: ${record.start_time}`);

    const weekKeys = this.getAffectedWeekKeys(record);
    let addedCount = 0;

    devLog(`   🔍 영향받은 주: ${weekKeys.length}개`, weekKeys.map(k => k.substring(0, 10)));
    devLog(`   📦 현재 캐시 크기: ${window.calendar.weekDataCache.size}개`);

    for (const weekKey of weekKeys) {
      for (const [cacheKey, events] of window.calendar.weekDataCache.entries()) {
        if (cacheKey.startsWith(weekKey + '_')) {
          const updatedEvents = [...events, newEvent];
          window.calendar.weekDataCache.set(cacheKey, updatedEvents);
          addedCount++;
          devLog(`   💾 추가: ${cacheKey} (총 ${updatedEvents.length}개)`);
        }
      }
    }

    if (addedCount === 0) {
      devLog(`   ⚠️ 캐시에 해당 주가 없어서 추가 안 됨`);
    }
  }

  handleIncrementalUpdate(oldId, newRecord) {
    const newEvent = this.convertToEvents([newRecord])[0];
    if (!newEvent) return;

    devLog(`   🔄 [증분UPDATE] ID: ${oldId}`);
    
    let updatedCount = 0;
    for (const [cacheKey, events] of window.calendar.weekDataCache.entries()) {
      const index = events.findIndex(e => e.id === oldId);
      if (index !== -1) {
        const updatedEvents = [...events];
        updatedEvents[index] = newEvent;
        window.calendar.weekDataCache.set(cacheKey, updatedEvents);
        updatedCount++;
        devLog(`   💾 수정: ${cacheKey}`);
      }
    }
    
    if (updatedCount === 0) {
      devLog(`   ⚠️ 캐시에 없는 UPDATE → INSERT로 처리`);
      this.handleIncrementalInsert(newRecord);
    }
  }

  handleIncrementalDelete(deleteId) {
    devLog(`   ➖ [증분DELETE] ID: ${deleteId}`);
    
    let deletedCount = 0;
    for (const [cacheKey, events] of window.calendar.weekDataCache.entries()) {
      const beforeLength = events.length;
      const filtered = events.filter(e => e.id !== deleteId);
      if (filtered.length < beforeLength) {
        window.calendar.weekDataCache.set(cacheKey, filtered);
        deletedCount++;
        devLog(`   💾 삭제: ${cacheKey} (${beforeLength} → ${filtered.length}개)`);
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
    
    if (this.cache.has(cacheKey) && (now - cacheFreshness) < 300000) {
      devLog('📦 [캐시HIT-FRESH]:', cacheKey);
      return this.cache.get(cacheKey);
    }
    
    if (this.cache.has(cacheKey)) {
      devLog('⏰ [캐시STALE] 재조회:', cacheKey);
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

      devLog(`✅ DB 조회 완료: ${data.length}개 이벤트`);
      this.cache.set(cacheKey, data);
      this.cacheTimestamps.set(cacheKey, now);
      
      this.enforceCacheSizeLimit();
      
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
      
      if (bookings.indexOf(booking) === 0) {
        devLog(`   🕐 [타임존] DB: ${booking.start_time} → JS: ${start.toLocaleString('ko-KR')}`);
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
