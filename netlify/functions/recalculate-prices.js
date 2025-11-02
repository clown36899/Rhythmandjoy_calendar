// 기존 booking_events의 가격을 재계산하는 함수
import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from './lib/price-calculator.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('🔄 기존 이벤트 가격 재계산 시작...');

    // 모든 booking_events 가져오기
    const { data: events, error } = await supabase
      .from('booking_events')
      .select('*')
      .order('start_time', { ascending: true });

    if (error) {
      throw new Error(`이벤트 조회 실패: ${error.message}`);
    }

    console.log(`📌 총 ${events.length}개 이벤트 발견`);

    // 각 이벤트의 가격 재계산 및 event_prices 테이블에 upsert
    let updated = 0;
    let processed = 0;

    for (const event of events) {
      const { price, priceType, isNaver } = await calculatePrice(
        event.start_time,
        event.end_time,
        event.room_id,
        event.description || ''
      );

      // event_prices 테이블에 upsert
      const { error: upsertError } = await supabase
        .from('event_prices')
        .upsert({
          booking_event_id: event.id,
          calculated_price: price,
          price_type: priceType,
          price_metadata: { is_naver: isNaver }
        }, {
          onConflict: 'booking_event_id'
        });

      if (upsertError) {
        console.error(`  ❌ ID ${event.id} 저장 실패:`, upsertError.message);
      } else {
        updated++;
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`  📊 진행률: ${processed}/${events.length} (${Math.round(processed/events.length*100)}%)`);
      }
    }

    console.log(`✅ 가격 재계산 완료! ${updated}/${events.length}개 업데이트됨`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: '가격 재계산 완료',
        total: events.length,
        updated: updated
      })
    };

  } catch (error) {
    console.error('❌ 가격 재계산 오류:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
