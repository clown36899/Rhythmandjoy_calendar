import { createClient } from '@supabase/supabase-js';

let cachedPolicies = null;
let lastCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5분 캐시

export async function getPricePolicyForDate(supabase, eventDate) {
  // 캐시 갱신 체크
  if (!cachedPolicies || !lastCacheTime || (Date.now() - lastCacheTime > CACHE_DURATION)) {
    const { data, error } = await supabase
      .from('price_policies')
      .select('*')
      .order('effective_from', { ascending: false });
    
    if (error) {
      console.error('가격 정책 조회 오류:', error);
      return getDefaultPrices(); // 폴백
    }
    
    cachedPolicies = data;
    lastCacheTime = Date.now();
  }
  
  // 이벤트 날짜에 맞는 가격 정책 찾기
  const eventTime = new Date(eventDate).getTime();
  
  for (const policy of cachedPolicies) {
    const policyTime = new Date(policy.effective_from).getTime();
    if (eventTime >= policyTime) {
      return policy.room_prices;
    }
  }
  
  // 없으면 가장 오래된 정책 사용
  return cachedPolicies[cachedPolicies.length - 1]?.room_prices || getDefaultPrices();
}

export function getDefaultPrices() {
  return {
    a: { before16: 10000, after16: 13000, overnight: 30000 },
    b: { before16: 9000, after16: 11000, overnight: 20000 },
    c: { before16: 4000, after16: 6000, overnight: 15000 },
    d: { before16: 3000, after16: 5000, overnight: 15000 },
    e: { before16: 8000, after16: 10000, overnight: 20000 }
  };
}

export function clearCache() {
  cachedPolicies = null;
  lastCacheTime = null;
}
