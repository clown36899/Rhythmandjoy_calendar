import { createClient } from '@supabase/supabase-js';
import { getCalendarClient } from './lib/google-auth.js';
import { parsePriceFromEvent, estimateDefaultPrice } from './lib/price-parser.js';

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

// 채널 ID로 룸 정보 조회
async function getRoomByChannelId(channelId) {
  const { data, error } = await supabase
    .from('calendar_channels')
    .select('*')
    .eq('channel_id', channelId)
    .single();

  if (error) {
    console.error('채널 조회 실패:', error);
    return null;
  }

  return data;
}

// Sync Token을 사용해 증분 동기화
async function incrementalSync(roomId, calendarId, syncToken) {
  const calendar = getCalendarClient();
  
  try {
    console.log(`🔄 ${roomId}홀 증분 동기화 시작... (sync_token: ${syncToken?.substring(0, 20)}...)`);

    let allChanges = [];
    let pageToken = null;
    let newSyncToken = null;

    do {
      const params = {
        calendarId: calendarId,
        showDeleted: true
      };

      if (syncToken) {
        params.syncToken = syncToken;
      } else {
        // sync token 없으면 최근 데이터만 가져오기
        const timeMin = new Date();
        timeMin.setMonth(timeMin.getMonth() - 1);
        params.timeMin = timeMin.toISOString();
        params.singleEvents = true;
        params.orderBy = 'startTime';
      }

      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await calendar.events.list(params);
      const changes = response.data.items || [];
      
      allChanges = allChanges.concat(changes);
      newSyncToken = response.data.nextSyncToken || newSyncToken;
      pageToken = response.data.nextPageToken;

    } while (pageToken);

    console.log(`  📌 ${allChanges.length}개 변경 감지`);

    // Supabase 업데이트
    for (const event of allChanges) {
      if (event.status === 'cancelled') {
        // 삭제된 이벤트
        await supabase
          .from('booking_events')
          .delete()
          .eq('google_event_id', event.id);
        console.log(`  🗑️  삭제: ${event.id}`);
      } else {
        // 추가/수정된 이벤트
        if (!event.start || !event.end) continue;

        const startTime = event.start.dateTime || event.start.date;
        const endTime = event.end.dateTime || event.end.date;

        // 가격 정보 파싱
        const { price, priceType } = parsePriceFromEvent(
          event.summary,
          event.description,
          startTime
        );

        // 가격이 없으면 시간 기반으로 추정
        let finalPrice = price;
        let finalPriceType = priceType;
        
        if (!finalPrice) {
          const estimated = estimateDefaultPrice(
            startTime,
            endTime,
            roomId
          );
          finalPrice = estimated.price;
          // priceType이 null이면 추정된 타입 사용
          finalPriceType = finalPriceType || estimated.priceType;
        }

        await supabase
          .from('booking_events')
          .upsert({
            room_id: roomId,
            google_event_id: event.id,
            title: event.summary || '예약',
            description: event.description || '',
            start_time: startTime,
            end_time: endTime,
            price: finalPrice,
            price_type: finalPriceType
          }, {
            onConflict: 'google_event_id'
          });
        console.log(`  ✅ 업데이트: ${event.summary || event.id} (${finalPrice}원, ${finalPriceType})`);
      }
    }

    // Sync Token 저장
    if (newSyncToken) {
      await supabase
        .from('calendar_sync_state')
        .upsert({
          room_id: roomId,
          sync_token: newSyncToken,
          last_synced_at: new Date().toISOString()
        }, {
          onConflict: 'room_id'
        });
    }

    return { changes: allChanges.length, syncToken: newSyncToken };

  } catch (error) {
    if (error.code === 410) {
      // Sync token 만료 → 전체 동기화 필요
      console.log('  ⚠️  Sync token 만료, 전체 동기화 수행');
      
      // Sync token 없이 다시 시도
      await supabase
        .from('calendar_sync_state')
        .update({ sync_token: null })
        .eq('room_id', roomId);
      
      return await incrementalSync(roomId, calendarId, null);
    }
    throw error;
  }
}

// Webhook 핸들러
export async function handler(event, context) {
  // Google 헤더 추출
  const channelId = event.headers['x-goog-channel-id'];
  const resourceState = event.headers['x-goog-resource-state'];
  const resourceId = event.headers['x-goog-resource-id'];

  console.log('📨 Google Calendar Webhook 수신:', { 
    channelId, 
    resourceState,
    resourceId
  });

  // Sync 메시지 (채널 등록 확인)
  if (resourceState === 'sync') {
    console.log('✅ 채널 등록 확인 완료');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Webhook 검증 성공' })
    };
  }

  // Exists 메시지 (실제 변경 발생)
  if (resourceState === 'exists') {
    try {
      // 채널 정보 조회
      const channelInfo = await getRoomByChannelId(channelId);
      if (!channelInfo) {
        console.error('❌ 알 수 없는 채널:', channelId);
        return {
          statusCode: 404,
          body: JSON.stringify({ error: '채널을 찾을 수 없습니다' })
        };
      }

      console.log(`🔔 ${channelInfo.room_id}홀 변경 감지`);

      // Sync Token 조회
      const { data: syncState } = await supabase
        .from('calendar_sync_state')
        .select('sync_token')
        .eq('room_id', channelInfo.room_id)
        .single();

      // 증분 동기화 실행
      const result = await incrementalSync(
        channelInfo.room_id,
        channelInfo.calendar_id,
        syncState?.sync_token
      );

      console.log(`✅ ${channelInfo.room_id}홀 동기화 완료:`, result);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: '변경 감지 및 동기화 완료',
          room: channelInfo.room_id,
          changes: result.changes
        })
      };

    } catch (error) {
      console.error('❌ Webhook 처리 실패:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: error.message,
          stack: error.stack
        })
      };
    }
  }

  // Not exists 메시지 (리소스 삭제됨)
  if (resourceState === 'not_exists') {
    console.log('⚠️  리소스 삭제 감지');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: '리소스 삭제 알림 수신' })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: '알림 수신 완료' })
  };
}
