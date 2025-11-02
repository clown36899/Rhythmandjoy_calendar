import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from './lib/price-calculator.js';
import { getGoogleAuth } from './lib/google-auth.js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const calendar = google.calendar({
  version: 'v3',
  auth: process.env.GOOGLE_CALENDAR_API_KEY
});

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://xn--xy1b23ggrmm5bfb82ees967e.com/.netlify/functions/google-webhook';

// 연습실 정보
const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
  { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

async function syncRoomCalendar(room) {
  try {
    console.log(`🔄 ${room.id}홀 동기화 시작...`);

    // 🚀 모든 예약 이벤트 가져오기 (제한 없음)
    const timeMin = new Date('2020-01-01T00:00:00Z'); // 모든 과거 데이터
    const timeMax = new Date();
    timeMax.setFullYear(timeMax.getFullYear() + 2); // 2년 후까지

    // 페이지네이션으로 모든 이벤트 가져오기
    let allEvents = [];
    let pageToken = null;

    do {
      const response = await calendar.events.list({
        calendarId: room.calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 2500,
        singleEvents: true,
        orderBy: 'startTime',
        pageToken: pageToken
      });

      const events = response.data.items || [];
      allEvents = allEvents.concat(events);
      pageToken = response.data.nextPageToken;

      if (pageToken) {
        console.log(`  📄 페이지 ${Math.ceil(allEvents.length / 2500)} 로드 중... (현재: ${allEvents.length}개)`);
      }
    } while (pageToken);

    console.log(`  📌 ${allEvents.length}개 이벤트 발견`);

    // Supabase에 upsert (추가/업데이트만, 삭제 없음)
    const eventsToUpsert = [];
    for (const event of allEvents) {
      if (!event.start || !event.start.dateTime) continue;

      // 가격 계산 (시간대별/방별/공휴일/수수료 모두 고려)
      const { price, priceType, isNaver } = calculatePrice(
        event.start.dateTime,
        event.end.dateTime,
        room.id,
        event.description || ''
      );

      eventsToUpsert.push({
        room_id: room.id,
        google_event_id: event.id,
        title: event.summary || '(제목 없음)',
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        description: event.description || null,
        price: price,
        price_type: priceType,
        is_naver: isNaver,
        updated_at: new Date().toISOString()
      });
    }

    // 100개씩 배치 upsert (Supabase 제한)
    for (let i = 0; i < eventsToUpsert.length; i += 100) {
      const batch = eventsToUpsert.slice(i, i + 100);
      const { error } = await supabase
        .from('booking_events')
        .upsert(batch, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`  ❌ 배치 ${Math.floor(i / 100) + 1} 저장 오류:`, error.message);
      }
    }

    console.log(`  ✅ ${room.id}홀 ${eventsToUpsert.length}개 동기화 완료`);
    return eventsToUpsert.length;
  } catch (error) {
    console.error(`❌ ${room.id}홀 동기화 실패:`, error.message);
    return 0;
  }
}

// Watch 채널 재설정
async function resetWatchChannels() {
  console.log('\n🔔 Watch 채널 자동 재설정 시작...');
  
  const auth = getGoogleAuth();
  await auth.authorize();
  const tokenInfo = await auth.getAccessToken();
  const token = tokenInfo.token;
  
  const watchResults = [];
  
  for (const room of rooms) {
    try {
      // 1. 초기 sync token 가져오기
      const listUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(room.calendarId)}/events?maxResults=1&singleEvents=true&key=${process.env.GOOGLE_CALENDAR_API_KEY}`;
      const listResponse = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const listData = await listResponse.json();
      const initialSyncToken = listData.nextSyncToken;

      // 2. Watch 채널 등록
      const channelId = uuidv4();
      const channel = {
        id: channelId,
        type: 'web_hook',
        address: WEBHOOK_URL,
        token: room.id
      };

      const watchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(room.calendarId)}/events/watch?key=${process.env.GOOGLE_CALENDAR_API_KEY}`;
      const watchResponse = await fetch(watchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(channel)
      });

      if (!watchResponse.ok) {
        throw new Error(`HTTP ${watchResponse.status}`);
      }

      const watchData = await watchResponse.json();
      const { resourceId, expiration } = watchData;

      // 3. Supabase에 채널 정보 저장
      await supabase
        .from('calendar_channels')
        .upsert({
          room_id: room.id,
          calendar_id: room.calendarId,
          channel_id: channelId,
          resource_id: resourceId,
          expiration: parseInt(expiration)
        }, { onConflict: 'room_id' });

      // 4. Sync token 저장
      if (initialSyncToken) {
        await supabase
          .from('calendar_sync_state')
          .upsert({
            room_id: room.id,
            sync_token: initialSyncToken,
            last_synced_at: new Date().toISOString()
          }, { onConflict: 'room_id' });
      }

      console.log(`  ✅ ${room.id}홀 Watch 등록 완료`);
      watchResults.push({ room: room.id, success: true });
    } catch (error) {
      console.error(`  ❌ ${room.id}홀 Watch 등록 실패:`, error.message);
      watchResults.push({ room: room.id, success: false, error: error.message });
    }
  }
  
  console.log('✅ Watch 채널 재설정 완료!');
  return watchResults;
}

async function syncAllCalendars() {
  console.log('🚀 전체 캘린더 동기화 시작...\n');
  
  const results = [];
  for (const room of rooms) {
    const count = await syncRoomCalendar(room);
    results.push({ room: room.id, count });
  }
  
  console.log('\n✅ 전체 동기화 완료!');
  
  // 자동으로 Watch 채널 재설정
  const watchResults = await resetWatchChannels();
  
  return { syncResults: results, watchResults };
}

export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { syncResults, watchResults } = await syncAllCalendars();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: '전체 캘린더 동기화 및 Watch 채널 재설정 완료',
        syncResults,
        watchResults
      })
    };
  } catch (error) {
    console.error('동기화 오류:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
