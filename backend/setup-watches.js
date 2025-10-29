import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

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

// Webhook URL (환경별 자동 선택)
const WEBHOOK_URL = process.env.NETLIFY 
  ? 'https://xn--xy1b23ggrmm5bfb82ees967e.com/.netlify/functions/google-webhook'
  : `https://${process.env.REPLIT_DEV_DOMAIN}/api/calendar-webhook`;

// Google Service Account 인증
function getGoogleAuth() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 환경 변수가 설정되지 않았습니다');
  }

  const credentials = JSON.parse(serviceAccountJson);

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
}

// Watch 채널 등록
async function setupWatch(room) {
  const auth = getGoogleAuth();
  
  try {
    console.log(`🔄 ${room.id}홀 Watch 등록 중...`);

    // 1. Access Token 가져오기
    const { token } = await auth.getAccessToken();
    
    // 2. 초기 sync token 가져오기
    const listUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(room.calendarId)}/events?maxResults=1&singleEvents=true&key=${process.env.GOOGLE_CALENDAR_API_KEY}`;
    const listResponse = await fetch(listUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const listData = await listResponse.json();
    
    if (listData.error) {
      throw new Error(`List events 실패: ${listData.error.message}`);
    }
    
    const initialSyncToken = listData.nextSyncToken;

    // 3. Watch 채널 등록
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

    const watchData = await watchResponse.json();
    
    if (watchData.error) {
      throw new Error(watchData.error.message);
    }

    const { resourceId, expiration } = watchData;

    console.log(`  ✅ Watch 등록 성공`);
    console.log(`     Channel ID: ${channelId}`);
    console.log(`     Resource ID: ${resourceId}`);
    console.log(`     만료: ${new Date(parseInt(expiration)).toLocaleString('ko-KR')}`);

    // 4. Supabase에 채널 정보 저장
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

    // 5. Sync token 저장
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
      expiration: new Date(parseInt(expiration)),
      webhookUrl: WEBHOOK_URL
    };

  } catch (error) {
    console.error(`❌ ${room.id}홀 Watch 등록 실패:`, error.message);
    throw error;
  }
}

// 모든 룸의 Watch 등록
export async function setupAllWatches() {
  console.log('🚀 모든 캘린더 Watch 등록 시작...');
  console.log(`📍 Webhook URL: ${WEBHOOK_URL}\n`);

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
  return results;
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  setupAllWatches()
    .then(results => {
      console.log('\n📊 결과:');
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ 오류:', error.message);
      process.exit(1);
    });
}
