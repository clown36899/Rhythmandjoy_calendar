import { createClient } from '@supabase/supabase-js';
import { getCalendarClient } from './lib/google-auth.mjs';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://리듬앤조이일정표.com/.netlify/functions/google-webhook';

// 기존 채널 정지
async function stopWatch(channelId, resourceId) {
  const calendar = getCalendarClient();
  
  try {
    await calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId: resourceId
      }
    });
    console.log(`  🛑 기존 채널 정지 완료: ${channelId}`);
  } catch (error) {
    console.log(`  ⚠️  채널 정지 실패 (이미 만료됨): ${error.message}`);
  }
}

// 채널 갱신
async function renewWatch(channel) {
  const calendar = getCalendarClient();
  
  try {
    console.log(`🔄 ${channel.room_id}홀 채널 갱신 중...`);

    // 1. 기존 채널 정지
    await stopWatch(channel.channel_id, channel.resource_id);

    // 2. 새 채널 등록
    const newChannelId = uuidv4();
    const newChannel = {
      id: newChannelId,
      type: 'web_hook',
      address: WEBHOOK_URL,
      token: channel.room_id
    };

    const watchResponse = await calendar.events.watch({
      calendarId: channel.calendar_id,
      requestBody: newChannel
    });

    const { resourceId, expiration } = watchResponse.data;

    console.log(`  ✅ 새 채널 등록 완료`);
    console.log(`     만료: ${new Date(parseInt(expiration)).toLocaleString('ko-KR')}`);

    // 3. Supabase 업데이트
    await supabase
      .from('calendar_channels')
      .update({
        channel_id: newChannelId,
        resource_id: resourceId,
        expiration: parseInt(expiration),
        updated_at: new Date().toISOString()
      })
      .eq('room_id', channel.room_id);

    return {
      room: channel.room_id,
      newChannelId,
      expiration: new Date(parseInt(expiration))
    };

  } catch (error) {
    console.error(`❌ ${channel.room_id}홀 갱신 실패:`, error.message);
    throw error;
  }
}

// 만료 임박 채널 갱신 (Scheduled Function)
export async function handler(event, context) {
  try {
    console.log('🔄 채널 갱신 작업 시작...\n');

    // 3일 이내 만료 예정 채널 조회 (안전 마진 확보)
    const threeDaysFromNow = Date.now() + (3 * 24 * 60 * 60 * 1000);

    const { data: expiringChannels, error } = await supabase
      .from('calendar_channels')
      .select('*')
      .lt('expiration', threeDaysFromNow);

    if (error) throw error;

    if (!expiringChannels || expiringChannels.length === 0) {
      console.log('✅ 갱신 필요한 채널 없음');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: '갱신 필요한 채널 없음' })
      };
    }

    console.log(`📌 ${expiringChannels.length}개 채널 갱신 필요\n`);

    const results = [];

    for (const channel of expiringChannels) {
      try {
        const result = await renewWatch(channel);
        results.push(result);
      } catch (error) {
        results.push({
          room: channel.room_id,
          error: error.message
        });
      }
    }

    console.log('\n✅ 채널 갱신 완료!');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: '채널 갱신 완료',
        renewed: results.length,
        results
      }, null, 2)
    };

  } catch (error) {
    console.error('❌ 갱신 작업 실패:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  }
}
