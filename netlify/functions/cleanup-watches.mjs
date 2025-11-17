import { getCalendarClient } from './lib/google-auth.mjs';

// 알려진 중복 채널들 (로그에서 확인된 것)
const duplicateChannels = [
  {
    channelId: '91586d79-8188-477e-b47a-85a9093bed66',
    resourceId: 'zZA4CNjsO1zBpOm83GGuN7HW2BU',
    reason: '미등록 채널 (DB에 없음)'
  }
];

// 채널 중지
async function stopWatch(channelId, resourceId) {
  const calendar = getCalendarClient();
  
  try {
    await calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId: resourceId
      }
    });
    console.log(`  ✅ 채널 정지 완료: ${channelId}`);
    return { success: true };
  } catch (error) {
    console.log(`  ⚠️  채널 정지 실패: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// 중복 채널 정리
export async function handler(event, context) {
  try {
    console.log('🧹 중복 Watch 채널 정리 시작...\n');

    const results = [];

    for (const channel of duplicateChannels) {
      console.log(`🛑 정지 중: ${channel.channelId}`);
      console.log(`   사유: ${channel.reason}`);
      
      const result = await stopWatch(channel.channelId, channel.resourceId);
      results.push({
        channelId: channel.channelId,
        ...result
      });
      
      console.log('');
    }

    console.log('✅ 정리 완료!\n');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: '중복 채널 정리 완료',
        results
      }, null, 2)
    };

  } catch (error) {
    console.error('❌ 정리 작업 실패:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  }
}
