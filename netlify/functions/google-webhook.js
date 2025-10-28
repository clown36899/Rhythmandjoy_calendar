import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event, context) {
  console.log('📨 Google Calendar Webhook 수신:', event.headers);

  const channelId = event.headers['x-goog-channel-id'];
  const resourceState = event.headers['x-goog-resource-state'];

  if (resourceState === 'sync') {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Webhook 검증 성공' })
    };
  }

  if (resourceState === 'exists') {
    console.log('🔔 캘린더 변경 감지, 동기화 트리거 필요');
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: '변경 감지됨',
        note: 'sync-calendar 함수를 호출하여 동기화하세요'
      })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: '알림 수신 완료' })
  };
}
