import { createClient } from '@supabase/supabase-js';
import { getCalendarClient } from './lib/google-auth.js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '6b9dbc066ad84e9ec2003fa58e65cd27a6aa64b77ea2c7f23f1fb890c16ecc4d@group.calendar.google.com' },
  { id: 'c', calendarId: '35ea46a1ffe4a53cc81aee9c21d5a8efebbdbfe6a39285dc83f0b5f9ae29ee49@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

// Webhook URL (Netlify 배포 후 실제 URL로 변경 필요)
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://리듬앤조이일정표.com/.netlify/functions/google-webhook';

// Watch 채널 등록
async function setupWatch(room) {
  const calendar = getCalendarClient();
  
  try {
    console.log(`🔄 ${room.id}홀 Watch 등록 중...`);

    // 1. 초기 sync token 가져오기
    const listResponse = await calendar.events.list({
      calendarId: room.calendarId,
      maxResults: 1,
      singleEvents: true
    });

    const initialSyncToken = listResponse.data.nextSyncToken;

    // 2. Watch 채널 등록
    const channelId = uuidv4();
    const channel = {
      id: channelId,
      type: 'web_hook',
      address: WEBHOOK_URL,
      token: room.id // 룸 ID를 토큰으로 사용
    };

    const watchResponse = await calendar.events.watch({
      calendarId: room.calendarId,
      requestBody: channel
    });

    const { resourceId, expiration } = watchResponse.data;

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
