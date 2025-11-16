// 클라이언트 사이드 Google Calendar → Supabase 동기화
class SyncManager {
  constructor(supabaseClient, apiKey) {
    this.supabase = supabaseClient;
    this.apiKey = apiKey;
    this.rooms = [
      { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
      { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
      { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
      { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
      { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
    ];
  }

  // Google Calendar API로 이벤트 가져오기
  async fetchCalendarEvents(calendarId, timeMin, timeMax) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const params = new URLSearchParams({
      key: this.apiKey,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500'
    });

    const response = await fetch(`${url}?${params}`);
    if (!response.ok) {
      throw new Error(`Google API 오류: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
  }

  // 가격 추출 (간단 버전)
  extractPrice(description) {
    if (!description) return 0;
    
    const patterns = [
      /(\d{1,3}(?:,?\d{3})*)\s*원/,
      /(\d{1,3}(?:,?\d{3})*)\s*\//,
      /가격[:\s]*(\d{1,3}(?:,?\d{3})*)/
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) {
        return parseInt(match[1].replace(/,/g, ''));
      }
    }

    return 0;
  }

  // Supabase에 이벤트 저장
  async saveToSupabase(roomId, events) {
    const records = events.map(event => ({
      google_event_id: event.id,
      room_id: roomId,
      title: event.summary || '제목 없음',
      description: event.description || '',
      start_time: event.start?.dateTime || event.start?.date,
      end_time: event.end?.dateTime || event.end?.date,
      price: this.extractPrice(event.description),
      created_at: event.created,
      updated_at: event.updated
    }));

    // 기존 데이터 삭제 후 새로 입력 (간단한 방식)
    const { error: deleteError } = await this.supabase
      .from('booking_events')
      .delete()
      .eq('room_id', roomId);

    if (deleteError) {
      console.warn(`삭제 오류 (무시 가능):`, deleteError);
    }

    // 새 데이터 입력
    if (records.length > 0) {
      const { error: insertError } = await this.supabase
        .from('booking_events')
        .insert(records);

      if (insertError) {
        throw new Error(`입력 오류: ${insertError.message}`);
      }
    }

    return records.length;
  }

  // 전체 동기화
  async syncAll(startYear = 2020, endYear = new Date().getFullYear() + 2) {
    const timeMin = `${startYear}-01-01T00:00:00Z`;
    const timeMax = `${endYear}-12-31T23:59:59Z`;
    
    const results = [];

    for (const room of this.rooms) {
      try {
        console.log(`🔄 ${room.id.toUpperCase()}홀 동기화 중...`);
        
        const events = await this.fetchCalendarEvents(room.calendarId, timeMin, timeMax);
        const count = await this.saveToSupabase(room.id, events);
        
        results.push({
          room: room.id,
          success: true,
          count: count
        });
        
        console.log(`✅ ${room.id.toUpperCase()}홀: ${count}개 이벤트`);
        
        // API Rate Limit 방지
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ ${room.id.toUpperCase()}홀 오류:`, error);
        results.push({
          room: room.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  // 특정 방만 동기화
  async syncRoom(roomId, startYear = 2020, endYear = new Date().getFullYear() + 2) {
    const room = this.rooms.find(r => r.id === roomId);
    if (!room) {
      throw new Error(`방을 찾을 수 없습니다: ${roomId}`);
    }

    const timeMin = `${startYear}-01-01T00:00:00Z`;
    const timeMax = `${endYear}-12-31T23:59:59Z`;

    const events = await this.fetchCalendarEvents(room.calendarId, timeMin, timeMax);
    const count = await this.saveToSupabase(room.id, events);

    return { room: room.id, count };
  }
}

// 전역 변수로 내보내기
window.SyncManager = SyncManager;
