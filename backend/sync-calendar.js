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

    // Supabase에 upsert
    const eventsToUpsert = [];
    for (const event of events) {
      if (!event.start || !event.start.dateTime) continue;

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

    console.log(`  ✅ ${room.id}홀 ${eventsToUpsert.length}개 동기화 완료`);
    return eventsToUpsert.length;
  } catch (error) {
    console.error(`❌ ${room.id}홀 범위 동기화 실패:`, error.message);
    return 0;
  }
}

/**
 * 증분 동기화 (변경된 이벤트만 업데이트)
 * @param {Object} room - 룸 정보 { id, calendarId }
 */
async function incrementalSync(room) {
  try {
    console.log(`🔄 ${room.id}홀 증분 동기화 시작...`);

    // DB에서 sync token 가져오기
    let syncToken = null;
    
    try {
      const { data: syncState, error: fetchError } = await supabase
        .from('calendar_sync_state')
        .select('sync_token')
        .eq('room_id', room.id)
        .single();

      // 테이블이 없거나 행이 없으면 sync token 없음으로 처리
      if (fetchError) {
        if (fetchError.code === 'PGRST116' || fetchError.message.includes('does not exist') || fetchError.message.includes('schema cache')) {
          console.log(`  ⚠️ sync token 없음 (테이블 없음 또는 첫 실행)`);
          syncToken = null;
        } else {
          console.error(`  ❌ sync token 조회 오류:`, fetchError.message);
          return 0;
        }
      } else {
        syncToken = syncState?.sync_token;
      }
    } catch (error) {
      console.log(`  ⚠️ sync token 조회 실패, 범위 동기화로 진행`);
      syncToken = null;
    }

    // sync token이 없으면 최근 3주 범위 동기화로 대체
    if (!syncToken) {
      console.log(`  ⚠️ sync token 없음, 최근 3주 범위 동기화 실행`);
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() - 7); // 1주 전
      const timeMax = new Date(now);
      timeMax.setDate(timeMax.getDate() + 14); // 2주 후

      const count = await rangeSync(room, timeMin, timeMax);
      
      // 초기 sync token 저장 (테이블이 있으면)
      try {
        const initResponse = await calendar.events.list({
          calendarId: room.calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          maxResults: 1,
          singleEvents: true
        });

        if (initResponse.data.nextSyncToken) {
          await supabase
            .from('calendar_sync_state')
            .upsert({
              room_id: room.id,
              sync_token: initResponse.data.nextSyncToken,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, { onConflict: 'room_id' });
          console.log(`  💾 sync token 저장됨`);
        }
      } catch (error) {
        console.log(`  ⚠️ sync token 저장 실패 (테이블 없음), 다음에 재시도`);
      }

      return count;
    }

    // sync token으로 증분 동기화
    console.log(`  🔄 sync token 사용: ${syncToken.substring(0, 20)}...`);
    
    const response = await calendar.events.list({
      calendarId: room.calendarId,
      syncToken: syncToken,
      maxResults: 500,
      singleEvents: true
    });

    const events = response.data.items || [];
    console.log(`  📌 ${events.length}개 변경사항 발견`);

    let upsertCount = 0;
    let deleteCount = 0;

    // 이벤트 처리
    const eventsToUpsert = [];
    const eventsToDelete = [];

    for (const event of events) {
      // 삭제된 이벤트
      if (event.status === 'cancelled') {
        eventsToDelete.push(event.id);
        continue;
      }

      // 추가/수정된 이벤트
      if (!event.start || !event.start.dateTime) continue;

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

    // Upsert
    if (eventsToUpsert.length > 0) {
      const { error } = await supabase
        .from('booking_events')
        .upsert(eventsToUpsert, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`  ❌ upsert 오류:`, error.message);
      } else {
        upsertCount = eventsToUpsert.length;
      }
    }

    // Delete
    if (eventsToDelete.length > 0) {
      const { error } = await supabase
        .from('booking_events')
        .delete()
        .in('google_event_id', eventsToDelete);

      if (error) {
        console.error(`  ❌ delete 오류:`, error.message);
      } else {
        deleteCount = eventsToDelete.length;
      }
    }

    // 새 sync token 저장 (테이블이 있으면)
    if (response.data.nextSyncToken) {
      try {
        await supabase
          .from('calendar_sync_state')
          .upsert({
            room_id: room.id,
            sync_token: response.data.nextSyncToken,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'room_id' });
        
        console.log(`  💾 새 sync token 저장됨`);
      } catch (error) {
        console.log(`  ⚠️ sync token 저장 실패 (테이블 없음)`);
      }
    }

    console.log(`  ✅ ${room.id}홀 증분 동기화 완료 (추가/수정: ${upsertCount}, 삭제: ${deleteCount})`);
    return upsertCount + deleteCount;
  } catch (error) {
    // sync token 만료 시 전체 재동기화
    if (error.message && error.message.includes('Sync token')) {
      console.log(`  ⚠️ sync token 만료, 전체 재동기화 실행`);
      
      // sync token 삭제
      await supabase
        .from('calendar_sync_state')
        .delete()
        .eq('room_id', room.id);

      // 최근 3주 재동기화
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
