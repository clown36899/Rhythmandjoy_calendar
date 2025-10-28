import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const calendar = google.calendar({
  version: 'v3',
  auth: process.env.GOOGLE_CALENDAR_API_KEY
});

// 연습실 정보
const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
  { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

/**
 * 특정 날짜 범위만 동기화 (3주 윈도우)
 * @param {Object} room - 룸 정보 { id, calendarId }
 * @param {Date} timeMin - 시작 날짜
 * @param {Date} timeMax - 종료 날짜
 */
async function rangeSync(room, timeMin, timeMax) {
  try {
    console.log(`🔄 ${room.id}홀 범위 동기화: ${timeMin.toISOString().split('T')[0]} ~ ${timeMax.toISOString().split('T')[0]}`);

    const response = await calendar.events.list({
      calendarId: room.calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 500,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    console.log(`  📌 ${events.length}개 이벤트 발견`);

    // Google에서 가져온 이벤트 ID 목록
    const googleEventIds = new Set();
    const eventsToUpsert = [];
    
    for (const event of events) {
      if (!event.start || !event.start.dateTime) continue;

      googleEventIds.add(event.id);
      eventsToUpsert.push({
        room_id: room.id,
        google_event_id: event.id,
        title: event.summary || '(제목 없음)',
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        description: event.description || null,
        updated_at: new Date().toISOString()
      });
    }

    // Upsert (추가/수정)
    if (eventsToUpsert.length > 0) {
      const { error } = await supabase
        .from('booking_events')
        .upsert(eventsToUpsert, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`  ❌ ${room.id}홀 저장 오류:`, error.message);
        return 0;
      }
    }

    // 삭제 감지: DB에는 있지만 Google에는 없는 이벤트 삭제
    const { data: dbEvents, error: fetchError } = await supabase
      .from('booking_events')
      .select('google_event_id')
      .eq('room_id', room.id)
      .gte('start_time', timeMin.toISOString())
      .lte('end_time', timeMax.toISOString());

    if (!fetchError && dbEvents) {
      const eventsToDelete = dbEvents
        .filter(dbEvent => !googleEventIds.has(dbEvent.google_event_id))
        .map(dbEvent => dbEvent.google_event_id);

      if (eventsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('booking_events')
          .delete()
          .in('google_event_id', eventsToDelete);

        if (deleteError) {
          console.error(`  ❌ 삭제 오류:`, deleteError.message);
        } else {
          console.log(`  🗑️ ${eventsToDelete.length}개 이벤트 삭제됨`);
        }
      }
    }

    console.log(`  ✅ ${room.id}홀 ${eventsToUpsert.length}개 동기화 완료`);
    return eventsToUpsert.length;
  } catch (error) {
    console.error(`❌ ${room.id}홀 범위 동기화 실패:`, error.message);
    return 0;
  }
}

/**
 * 증분 동기화 (sync token 사용, 변경된 이벤트만!)
 * @param {Object} room - 룸 정보 { id, calendarId }
 */
async function incrementalSync(room) {
  try {
    console.log(`🔄 ${room.id}홀 증분 동기화 시작...`);

    // DB에서 sync token 가져오기
    let syncToken = null;
    
    try {
      const { data: syncState } = await supabase
        .from('calendar_sync_state')
        .select('sync_token')
        .eq('room_id', room.id)
        .single();
      
      syncToken = syncState?.sync_token;
    } catch (error) {
      // 테이블 없으면 무시
    }

    // sync token이 없으면 초기 설정 필요
    if (!syncToken) {
      console.log(`  ⚠️ sync token 없음, 전체 동기화로 초기 설정...`);
      
      // 전체 이벤트 가져오기 (sync token 생성용)
      let allEvents = [];
      let pageToken = null;
      let nextSyncToken = null;

      do {
        const response = await calendar.events.list({
          calendarId: room.calendarId,
          maxResults: 500,
          singleEvents: true,
          pageToken: pageToken
        });

        const events = response.data.items || [];
        allEvents = allEvents.concat(events);
        pageToken = response.data.nextPageToken;
        nextSyncToken = response.data.nextSyncToken;
      } while (pageToken);

      console.log(`  📌 초기 ${allEvents.length}개 이벤트 발견 (sync token 생성)`);

      // 최근 3주 이벤트만 DB에 저장
      const now = new Date();
      const threeWeeksAgo = new Date(now);
      threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 7);
      const twoWeeksLater = new Date(now);
      twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);

      const recentEvents = allEvents.filter(event => {
        if (!event.start || !event.start.dateTime) return false;
        const startTime = new Date(event.start.dateTime);
        return startTime >= threeWeeksAgo && startTime <= twoWeeksLater;
      });

      // DB에 저장
      if (recentEvents.length > 0) {
        const eventsToUpsert = recentEvents.map(event => ({
          room_id: room.id,
          google_event_id: event.id,
          title: event.summary || '(제목 없음)',
          start_time: event.start.dateTime,
          end_time: event.end.dateTime,
          description: event.description || null,
          updated_at: new Date().toISOString()
        }));

        await supabase
          .from('booking_events')
          .upsert(eventsToUpsert, { onConflict: 'google_event_id' });
      }

      // sync token 저장 (RLS 우회를 위해 직접 SQL 사용)
      if (nextSyncToken) {
        try {
          const { error } = await supabase.rpc('upsert_sync_token', {
            p_room_id: room.id,
            p_sync_token: nextSyncToken
          });
          
          if (error) {
            console.error(`  ❌ sync token 저장 실패:`, error.message);
          } else {
            console.log(`  💾 sync token 저장 완료 (최근 3주 ${recentEvents.length}개만 저장)`);
          }
        } catch (err) {
          console.error(`  ❌ sync token 저장 실패:`, err.message);
        }
      }

      return recentEvents.length;
    }

    // sync token으로 변경분만 가져오기
    console.log(`  🔄 sync token 사용 (변경분만 가져오기)...`);
    
    const response = await calendar.events.list({
      calendarId: room.calendarId,
      syncToken: syncToken,
      maxResults: 100
    });

    const changes = response.data.items || [];
    console.log(`  📌 ${changes.length}개 변경 발견`);

    let added = 0, updated = 0, deleted = 0;

    for (const event of changes) {
      // 삭제된 이벤트
      if (event.status === 'cancelled') {
        const { error } = await supabase
          .from('booking_events')
          .delete()
          .eq('google_event_id', event.id);
        
        if (!error) deleted++;
        continue;
      }

      // 추가/수정된 이벤트
      if (!event.start || !event.start.dateTime) continue;

      const { error } = await supabase
        .from('booking_events')
        .upsert({
          room_id: room.id,
          google_event_id: event.id,
          title: event.summary || '(제목 없음)',
          start_time: event.start.dateTime,
          end_time: event.end.dateTime,
          description: event.description || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'google_event_id' });

      if (!error) {
        // 기존 이벤트인지 확인
        const { data: existing } = await supabase
          .from('booking_events')
          .select('id')
          .eq('google_event_id', event.id)
          .single();
        
        if (existing) updated++;
        else added++;
      }
    }

    // 새 sync token 저장 (RLS 우회를 위해 직접 SQL 사용)
    if (response.data.nextSyncToken) {
      try {
        const { error: tokenError } = await supabase.rpc('upsert_sync_token', {
          p_room_id: room.id,
          p_sync_token: response.data.nextSyncToken
        });
        
        if (tokenError) {
          console.error(`  ❌ sync token 업데이트 실패:`, tokenError.message);
        }
      } catch (err) {
        console.error(`  ❌ sync token 업데이트 실패:`, err.message);
      }
    }

    console.log(`  ✅ ${room.id}홀 증분 완료 (추가: ${added}, 수정: ${updated}, 삭제: ${deleted})`);
    return added + updated + deleted;
  } catch (error) {
    // sync token 만료 시
    if (error.message && error.message.includes('Sync token')) {
      console.log(`  ⚠️ sync token 만료, 재생성...`);
      
      // sync token 삭제 후 재시도
      await supabase
        .from('calendar_sync_state')
        .delete()
        .eq('room_id', room.id);
      
      return await incrementalSync(room);
    }

    console.error(`❌ ${room.id}홀 증분 동기화 실패:`, error.message);
    return 0;
  }
}

/**
 * 모든 룸의 증분 동기화 (Webhook 트리거용)
 */
async function syncAllCalendarsIncremental() {
  console.log('🚀 전체 증분 동기화 시작...\n');
  
  const results = [];
  for (const room of rooms) {
    const count = await incrementalSync(room);
    results.push({ room: room.id, count });
  }
  
  console.log('\n✅ 전체 증분 동기화 완료!');
  return results;
}

/**
 * 전체 룸 초기 동기화 (최근 3주)
 */
async function syncAllCalendarsInitial() {
  console.log('🚀 초기 동기화 시작 (최근 3주)...\n');
  
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 7); // 1주 전
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 14); // 2주 후

  const results = [];
  for (const room of rooms) {
    const count = await rangeSync(room, timeMin, timeMax);
    results.push({ room: room.id, count });
  }
  
  console.log('\n✅ 초기 동기화 완료!');
  return results;
}

// 스크립트 직접 실행 시 (초기 동기화)
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAllCalendarsInitial()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('동기화 실패:', error);
      process.exit(1);
    });
}

export { 
  rangeSync, 
  incrementalSync, 
  syncAllCalendarsIncremental, 
  syncAllCalendarsInitial,
  rooms 
};
