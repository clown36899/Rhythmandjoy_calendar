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

    // 각 이벤트의 가격 재계산
    const updates = [];
    let processed = 0;

    for (const event of events) {
      const { price, priceType, isNaver } = calculatePrice(
        event.start_time,
        event.end_time,
        event.room_id,
        event.description || ''
      );

      updates.push({
        id: event.id,
        price: price,
        price_type: priceType,
        is_naver: isNaver
      });

      processed++;
      if (processed % 100 === 0) {
        console.log(`  📊 진행률: ${processed}/${events.length} (${Math.round(processed/events.length*100)}%)`);
      }
    }

    // 100개씩 배치 업데이트
    let updated = 0;
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      
      for (const update of batch) {
        const { error: updateError } = await supabase
          .from('booking_events')
          .update({
            price: update.price,
            price_type: update.price_type,
            is_naver: update.is_naver
          })
          .eq('id', update.id);

        if (updateError) {
          console.error(`  ❌ ID ${update.id} 업데이트 실패:`, updateError.message);
        } else {
          updated++;
        }
      }

      console.log(`  💾 배치 ${Math.floor(i / 100) + 1}/${Math.ceil(updates.length / 100)} 업데이트 완료`);
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
