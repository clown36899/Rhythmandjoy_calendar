import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
  { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

// Webhook URL (Punycode)
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://xn--xy1b23ggrmm5bfb82ees967e.com/.netlify/functions/google-webhook';

// Google Service Account 인증
function getGoogleAuth() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 환경 변수가 설정되지 않았습니다');
  }

  const credentials = JSON.parse(serviceAccountJson);

  return new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/calendar']
  );
}

// Watch 채널 등록
async function setupWatch(room) {
  try {
    console.log(`🔄 ${room.id}홀 Watch 등록 중...`);

    //  1. JWT 인증 및 Access Token 가져오기
    const auth = getGoogleAuth();
    await auth.authorize();
    const tokenInfo = await auth.getAccessToken();
    const token = tokenInfo.token;
    
    // 2. 초기 sync token 가져오기 (REST API)
    const listUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(room.calendarId)}/events?maxResults=1&singleEvents=true&key=${process.env.GOOGLE_CALENDAR_API_KEY}`;
    const listResponse = await fetch(listUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const listData = await listResponse.json();
    const initialSyncToken = listData.nextSyncToken;

    // 3. Watch 채널 등록 (REST API with API Key in URL)
    const channelId = uuidv4();
    const channel = {
      id: channelId,
      type: 'web_hook',
      address: WEBHOOK_URL,
      token: room.id // 룸 ID를 토큰으로 사용
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
      const errorData = await watchResponse.json();
      throw new Error(errorData.error?.message || `HTTP ${watchResponse.status}`);
    }

    const watchData = await watchResponse.json();
    const { resourceId, expiration } = watchData;

    console.log(`  ✅ Watch 등록 성공`);
    console.log(`     Channel ID: ${channelId}`);
    console.log(`     Resource ID: ${resourceId}`);
    console.log(`     만료: ${new Date(parseInt(expiration)).toLocaleString('ko-KR')}`);

    // 3. Supabase에 채널 정보 저장
    await supabase
      .from('calendar_channels')
      .upsert({
        room_id: room.id,
        calendar_id: room.calendarId,
        channel_id: channelId,
        resource_id: resourceId,
        expiration: parseInt(expiration)
      }, {
        onConflict: 'room_id'
      });

    // 4. Sync token 저장
    if (initialSyncToken) {
      await supabase
        .from('calendar_sync_state')
        .upsert({
          room_id: room.id,
          sync_token: initialSyncToken,
          last_synced_at: new Date().toISOString()
        }, {
          onConflict: 'room_id'
        });
    }

    return {
      room: room.id,
      channelId,
      resourceId,
      expiration: new Date(parseInt(expiration))
    };

  } catch (error) {
    console.error(`❌ ${room.id}홀 Watch 등록 실패:`, error.message);
    throw error;
  }
}

// 모든 룸의 Watch 등록
export async function handler(event, context) {
  try {
    console.log('🚀 모든 캘린더 Watch 등록 시작...\n');

    const results = [];
    
    for (const room of rooms) {
      try {
        const result = await setupWatch(room);
        results.push(result);
      } catch (error) {
        results.push({
          room: room.id,
          error: error.message
        });
      }
    }

    console.log('\n✅ Watch 등록 완료!');
    console.log(JSON.stringify(results, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Watch 채널 등록 완료',
        results
      }, null, 2)
    };

  } catch (error) {
    console.error('❌ Setup 실패:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  }
}
