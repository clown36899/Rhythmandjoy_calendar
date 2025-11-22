class DataManager {
  constructor() {
    this.supabase = null;
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.MAX_CACHE_SIZE = 15; // LRU: 최대 15주 캐시
    this.CACHE_TTL = 15 * 60 * 1000; // TTL: 15분
    this.realtimeStatus = null; // 상태 중복 로그 방지
    this.realtimeRetryCount = 0; // Realtime 재연결 시도 횟수
    this.realtimeMaxRetries = 5; // 최대 5회 시도
    this.realtimeRetryDelay = 3000; // 초기 재시도 간격 (3초)
    this.realtimeChannel = null; // 현재 Realtime 채널
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
      if (window.logger) logger.error('Supabase config missing', { url: !!supabaseUrl, key: !!supabaseKey });
      console.error('❌ ENV not loaded properly');
      return false;
    }

    if (window.logger) logger.info('Supabase config loaded', { 
      url: supabaseUrl.substring(0, 30) + '...', 
      keyLength: supabaseKey.length 
    });
    devLog('📡 Supabase 설정 로드됨', { url: supabaseUrl.substring(0, 30), keyLen: supabaseKey.length });

    const { createClient } = supabase;
    this.supabase = createClient(supabaseUrl, supabaseKey);

    if (window.logger) logger.info('Supabase initialized', { url: supabaseUrl.substring(0, 30) });
    devLog('✅ Supabase 클라이언트 생성됨');
    
    // Realtime 구독 전 상태 확인
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
    this.realtimeRetryCount = 0; // 재시도 횟수 초기화
    this._connectRealtime();
  }

  _connectRealtime() {
    if (window.logger) logger.info('Realtime connecting', { retryCount: this.realtimeRetryCount });
    devLog(`🔌 [REALTIME] 연결 시도 중 (재시도: ${this.realtimeRetryCount})`);
    
    const channel = this.supabase
      .channel('app_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'booking_events'
        },
        (payload) => {
          if (window.logger) logger.info('Realtime data received', { 
            eventType: payload.eventType,
            newId: payload.new?.id,
            oldId: payload.old?.id 
          });
          devLog('📡 [Realtime이벤트] ', payload.eventType, { id: payload.new?.id || payload.old?.id });
          this.handleRealtimeChange(payload);
          // 성공 시 재시도 횟수 초기화
          this.realtimeRetryCount = 0;
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications'
        },
        (payload) => {
          if (window.logger) logger.info('Webhook notification received', { 
            roomId: payload.new?.room_id,
            type: payload.new?.type
          });
          devLog(`🔔 [WEBHOOK신호] 룸 ${payload.new?.room_id}에서 변경 감지 → 현재 주 재조회`);
          // Webhook 신호: 현재 보는 주 데이터 재조회
          if (window.calendar) {
            window.calendar.refreshCurrentView();
          }
        }
      )
      .on('system', { event: 'join' }, () => {
        const timestamp = new Date().toISOString();
        if (window.logger) logger.info('Realtime join event', { timestamp });
        devLog(`✅ [JOIN] Realtime 채널 조인됨 @ ${timestamp}`);
        this.realtimeRetryCount = 0; // 재시도 횟수 초기화
      })
      .on('system', { event: 'leave' }, () => {
        const timestamp = new Date().toISOString();
        if (window.logger) logger.warn('Realtime leave event', { timestamp, retryCount: this.realtimeRetryCount });
        devLog(`⚠️ [LEAVE] Realtime 채널 이탈 @ ${timestamp} (이유: 미정의)`);
        // 연결 끊김 시 자동 재연결 시도
        setTimeout(() => {
          if (window.logger) logger.info('Realtime reconnect starting after leave', { retryCount: this.realtimeRetryCount });
          devLog(`🔄 [RECONNECT_TRIGGERED] Realtime 자동 재연결 시작 (재시도: ${this.realtimeRetryCount})`);
          this._scheduleRealtimeReconnect();
        }, 500);
      })
      .subscribe((status) => {
        // 상태 변화가 있을 때만 로그 (중복 방지)
        if (status !== this.realtimeStatus) {
          this.realtimeStatus = status;
          const timestamp = new Date().toISOString();
          
          if (status === 'SUBSCRIBED') {
            if (window.logger) logger.info('Realtime subscribed', { 
              status,
              timestamp,
              retryCount: this.realtimeRetryCount
            });
            devLog(`✅ [SUBSCRIBED] Realtime subscription 활성화 @ ${timestamp}`);
            this.realtimeRetryCount = 0; // 성공 시 초기화
          } else if (status === 'CHANNEL_ERROR') {
            if (window.logger) logger.error('Realtime channel error', { 
              status,
              timestamp,
              retryCount: this.realtimeRetryCount + 1,
              maxRetries: this.realtimeMaxRetries
            });
            devLog(`❌ [CHANNEL_ERROR] Realtime 채널 에러 (${this.realtimeRetryCount + 1}/${this.realtimeMaxRetries})`);
            this._scheduleRealtimeReconnect();
          } else if (status === 'TIMED_OUT') {
            if (window.logger) logger.error('Realtime timed out', { 
              status,
              timestamp,
              retryCount: this.realtimeRetryCount + 1,
              maxRetries: this.realtimeMaxRetries
            });
            devLog(`❌ [TIMED_OUT] Realtime 타임아웃 (${this.realtimeRetryCount + 1}/${this.realtimeMaxRetries})`);
            this._scheduleRealtimeReconnect();
          } else {
            if (window.logger) logger.info('Realtime status change', { status, timestamp });
            devLog(`🔄 [STATUS] Realtime 상태: ${status} @ ${timestamp}`);
          }
        }
      });

    // 에러 핸들러 추가
    if (channel && channel.on) {
      channel.on('error', (err) => {
        if (window.logger) logger.error('Realtime error handler', { 
          error: err?.message || String(err),
          errorType: err?.constructor?.name,
          timestamp: new Date().toISOString()
        });
        devLog(`❌ [ERROR_HANDLER] Realtime 에러: ${err?.message || String(err)}`);
        this._scheduleRealtimeReconnect();
      });
    }

    this.realtimeChannel = channel;
    if (window.logger) logger.info('Realtime setup complete', { 
      channelName: 'booking_events_changes',
      retryCount: this.realtimeRetryCount,
      status: 'SUBSCRIBING'
    });
    devLog(`🔧 [SETUP] Realtime 구독 설정 완료 → SUBSCRIBING 상태로 전환 중...`);
  }

  _scheduleRealtimeReconnect() {
    // 최대 재시도 횟수 확인
    if (this.realtimeRetryCount >= this.realtimeMaxRetries) {
      const msg = `❌ Realtime 최대 재시도 횟수 초과 (${this.realtimeRetryCount}회)`;
      if (window.logger) logger.error('Realtime max retries exceeded', { retries: this.realtimeRetryCount });
      devLog(msg);
      return;
    }

    // Exponential backoff: 3초, 6초, 12초, 24초, 48초
    const delay = this.realtimeRetryDelay * Math.pow(2, this.realtimeRetryCount);
    this.realtimeRetryCount++;

    const delaySeconds = (delay / 1000).toFixed(0);
    if (window.logger) logger.info('Realtime reconnect scheduled', { 
      retries: this.realtimeRetryCount, 
      delaySeconds: parseFloat(delaySeconds),
      maxRetries: this.realtimeMaxRetries
    });
    devLog(`🔄 [${delaySeconds}초 후] Realtime 재연결 예약 (${this.realtimeRetryCount}/${this.realtimeMaxRetries})`);

    setTimeout(() => {
      devLog(`🔄 [NOW] Realtime 재연결 시도 중... (${this.realtimeRetryCount}/${this.realtimeMaxRetries})`);
      if (window.logger) logger.info('Realtime reconnect attempting', { retries: this.realtimeRetryCount });
      
      // 이전 채널 언서브스크라이브
      if (this.realtimeChannel) {
        try {
          this.realtimeChannel.unsubscribe().catch(err => {
            if (window.logger) logger.warn('Failed to unsubscribe from old channel', { error: err?.message });
            devLog(`⚠️ 기존 채널 언서브 실패: ${err?.message}`);
          });
        } catch (e) {
          if (window.logger) logger.warn('Error unsubscribing', { error: e?.message });
          devLog(`⚠️ 언서브 중 에러: ${e?.message}`);
        }
      }
      
      // 새로 연결
      devLog(`🔄 [NEW_CONNECTION] Realtime 새 연결 시작`);
      this._connectRealtime();
    }, delay);
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
    const cacheAge = now - cacheFreshness;
    
    if (this.cache.has(cacheKey) && cacheAge < 300000) {
      const data = this.cache.get(cacheKey);
      if (window.logger) logger.info('Cache hit fresh', { cacheKey, eventCount: data.length, age: cacheAge });
      devLog(`📦 [캐시HIT-FRESH] ${cacheKey} (나이: ${(cacheAge/1000).toFixed(0)}초, 이벤트: ${data.length}개)`);
      return data;
    }
    
    if (this.cache.has(cacheKey)) {
      if (window.logger) logger.info('Cache stale, fetching', { cacheKey, age: cacheAge });
      devLog(`⏰ [캐시STALE] 재조회 중: ${cacheKey} (나이: ${(cacheAge/1000).toFixed(0)}초)`);
    } else {
      if (window.logger) logger.info('Cache miss, fetching', { cacheKey });
      devLog(`❌ [캐시MISS] 첫 조회: ${cacheKey}`);
    }

    try {
      if (window.logger) logger.info('DB fetch starting', { 
        rooms: roomIds, 
        startDate, 
        endDate,
        cacheSize: this.cache.size
      });
      devLog(`🔍 [DB쿼리] 시작 - 방: ${roomIds.join(',')}, 기간: ${startDate}~${endDate}, 현재캐시크기: ${this.cache.size}`);
      
      const queryStart = Date.now();
      const { data, error } = await this.supabase
        .from('booking_events')
        .select('*')
        .in('room_id', roomIds)
        .gte('start_time', startDate)
        .lte('end_time', endDate)
        .order('start_time', { ascending: true });

      const queryTime = Date.now() - queryStart;

      if (error) {
        if (window.logger) logger.error('DB fetch error', { 
          error: error.message,
          code: error.code,
          queryTime
        });
        throw error;
      }

      if (window.logger) logger.info('DB fetch complete', { 
        eventCount: data.length,
        queryTime,
        cacheKey
      });
      devLog(`✅ [DB조회완료] ${data.length}개 이벤트 로드 (${queryTime}ms)`);
      
      this.cache.set(cacheKey, data);
      this.cacheTimestamps.set(cacheKey, now);
      
      this.enforceCacheSizeLimit();
      
      if (window.logger) logger.info('Cache updated', { 
        cacheKey,
        eventCount: data.length,
        totalCacheSize: this.cache.size
      });
      
      return data;
    } catch (error) {
      if (window.logger) logger.error('DB fetch failed', { 
        error: error?.message || String(error),
        cacheKey,
        fallbackEventCount: this.cache.get(cacheKey)?.length || 0
      });
      console.error('❌ DB 조회 실패:', error);
      
      // 캐시가 있으면 사용
      if (this.cache.has(cacheKey)) {
        const fallback = this.cache.get(cacheKey);
        devLog(`⚠️ [FALLBACK] DB 조회 실패 → 캐시 사용 (${fallback.length}개)`);
        return fallback;
      }
      
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
