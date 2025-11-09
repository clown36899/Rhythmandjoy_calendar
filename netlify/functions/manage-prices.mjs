import { createClient } from '@supabase/supabase-js';
import { clearCache } from './lib/price-policy-service.mjs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // GET: 가격 정책 조회
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('price_policies')
        .select('*')
        .order('effective_from', { ascending: false });

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    // POST: 새 가격 정책 추가
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { effectiveFrom, roomPrices } = body;

      if (!effectiveFrom || !roomPrices) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: '필수 파라미터 누락 (effectiveFrom, roomPrices)' })
        };
      }

      // 가격 정책 추가
      const { data, error } = await supabase
        .from('price_policies')
        .insert({
          effective_from: effectiveFrom,
          room_prices: roomPrices
        })
        .select()
        .single();

      if (error) throw error;

      // 캐시 초기화
      clearCache();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('가격 정책 관리 오류:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}
