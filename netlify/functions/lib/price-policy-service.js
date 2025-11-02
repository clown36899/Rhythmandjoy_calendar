import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 가격 캐시 (메모리 절약)
const priceCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1시간

/**
 * 특정 날짜에 유효한 가격 정책 조회
 * @param {string} roomId - 방 ID (a, b, c, d, e)
 * @param {Date|string} bookingDate - 예약 시작 날짜
 * @returns {Object|null} { price_weekday_before16, price_weekday_after16, price_weekend, price_overnight }
 */
export async function getPricePolicy(roomId, bookingDate) {
  const dateStr = typeof bookingDate === 'string' 
    ? bookingDate.split('T')[0] 
    : bookingDate.toISOString().split('T')[0];
  
  const cacheKey = `${roomId}-${dateStr}`;
  
  // 캐시 확인
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  // DB 조회
  const { data, error } = await supabase
    .from('price_history')
    .select('price_weekday_before16, price_weekday_after16, price_weekend, price_overnight')
    .eq('room_id', roomId)
    .lte('effective_from', dateStr)
    .or(`effective_to.is.null,effective_to.gte.${dateStr}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    console.error(`가격 정책 조회 오류 [${roomId}, ${dateStr}]:`, error);
    return getDefaultPrices()[roomId];
  }
  
  if (!data) {
    console.warn(`가격 정책 없음 [${roomId}, ${dateStr}] - 기본값 사용`);
    return getDefaultPrices()[roomId];
  }
  
  // 캐시 저장
  priceCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
  
  return data;
}

/**
 * 기본 가격 (fallback용)
 */
export function getDefaultPrices() {
  return {
    a: { price_weekday_before16: 10000, price_weekday_after16: 13000, price_weekend: 13000, price_overnight: 30000 },
    b: { price_weekday_before16: 9000, price_weekday_after16: 11000, price_weekend: 11000, price_overnight: 20000 },
    c: { price_weekday_before16: 4000, price_weekday_after16: 6000, price_weekend: 6000, price_overnight: 15000 },
    d: { price_weekday_before16: 3000, price_weekday_after16: 5000, price_weekend: 5000, price_overnight: 15000 },
    e: { price_weekday_before16: 8000, price_weekday_after16: 10000, price_weekend: 10000, price_overnight: 20000 }
  };
}

/**
 * 캐시 초기화 (가격 정책 변경 시 호출)
 */
export function clearPriceCache() {
  priceCache.clear();
  console.log('[가격 캐시 초기화]');
}
