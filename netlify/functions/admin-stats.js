import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from './lib/price-calculator.js';
import { getPricePolicyForDate } from './lib/price-policy-service.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * 페이지네이션으로 모든 데이터 가져오기
 */
async function fetchAllData(query) {
  let allData = [];
  let start = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await query.range(start, start + pageSize - 1);
    
    if (error) throw error;
    if (!data || data.length === 0) break;
    
    allData.push(...data);
    
    if (data.length < pageSize) break; // 마지막 페이지
    start += pageSize;
  }

  return allData;
}

/**
 * 이벤트의 가격을 가져옴 (DB에 저장된 값 사용)
 */
async function getEventPrice(event) {
  // DB에 이미 저장된 가격 사용
  return event.price || 0;
}

/**
 * 연도별 총 매출 요약
 */
async function getYearlySummary(year) {
  const query = supabase
    .from('booking_events')
    .select('price, room_id, price_type, start_time, end_time, description')
    .gte('start_time', `${year}-01-01T00:00:00Z`)
    .lt('start_time', `${year + 1}-01-01T00:00:00Z`)
    .order('id', { ascending: true });

  const data = await fetchAllData(query);

  let totalRevenue = 0;
  const totalBookings = data.length;

  // 방별 예약 수 집계
  const roomStats = {};
  for (const event of data) {
    const price = await getEventPrice(event);
    totalRevenue += price;
    
    if (!roomStats[event.room_id]) {
      roomStats[event.room_id] = { count: 0, revenue: 0 };
    }
    roomStats[event.room_id].count++;
    roomStats[event.room_id].revenue += price;
  }

  // 최다 예약 방 찾기
  const topRoom = Object.entries(roomStats)
    .sort((a, b) => b[1].count - a[1].count)[0];

  return {
    year,
    totalRevenue,
    totalBookings,
    averagePrice: totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0,
    topRoom: topRoom ? {
      roomId: topRoom[0],
      count: topRoom[1].count,
      revenue: topRoom[1].revenue
    } : null,
    roomStats
  };
}

/**
 * 월별 매출 통계 (1-12월)
 */
async function getMonthlyStats(year) {
  const query = supabase
    .from('booking_events')
    .select('price, start_time, end_time, room_id, description')
    .gte('start_time', `${year}-01-01T00:00:00Z`)
    .lt('start_time', `${year + 1}-01-01T00:00:00Z`)
    .order('id', { ascending: true });

  const data = await fetchAllData(query);

  // 월별 집계
  const monthlyData = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    revenue: 0,
    bookings: 0,
    byRoom: { a: 0, b: 0, c: 0, d: 0, e: 0 }
  }));

  for (const event of data) {
    const price = await getEventPrice(event);
    const month = new Date(event.start_time).getMonth(); // 0-11
    monthlyData[month].revenue += price;
    monthlyData[month].bookings += 1;
    monthlyData[month].byRoom[event.room_id] += price;
  }

  return monthlyData;
}

/**
 * 방별 매출 통계
 */
async function getRoomStats(year) {
  const query = supabase
    .from('booking_events')
    .select('price, room_id, price_type, start_time, end_time, description')
    .gte('start_time', `${year}-01-01T00:00:00Z`)
    .lt('start_time', `${year + 1}-01-01T00:00:00Z`)
    .order('id', { ascending: true });

  const data = await fetchAllData(query);

  const rooms = ['a', 'b', 'c', 'd', 'e'];
  const roomStats = {};

  for (const roomId of rooms) {
    const roomEvents = data.filter(e => e.room_id === roomId);
    let totalRevenue = 0;
    
    // 가격 타입별 집계
    const byPriceType = {};
    for (const e of roomEvents) {
      const price = await getEventPrice(e);
      totalRevenue += price;
      const type = e.price_type || '일반';
      byPriceType[type] = (byPriceType[type] || 0) + price;
    }

    roomStats[roomId] = {
      name: `${roomId.toUpperCase()}홀`,
      bookings: roomEvents.length,
      revenue: totalRevenue,
      averagePrice: roomEvents.length > 0 ? Math.round(totalRevenue / roomEvents.length) : 0,
      byPriceType
    };
  }

  return roomStats;
}

/**
 * 일별 매출 통계 (특정 월)
 */
async function getDailyStats(year, month) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // 마지막 날
  const daysInMonth = endDate.getDate();

  const query = supabase
    .from('booking_events')
    .select('price, start_time, end_time, room_id, description')
    .gte('start_time', startDate.toISOString())
    .lt('start_time', new Date(year, month, 1).toISOString())
    .order('id', { ascending: true });

  const data = await fetchAllData(query);

  // 일별 집계
  const dailyData = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    revenue: 0,
    bookings: 0,
    byRoom: { a: 0, b: 0, c: 0, d: 0, e: 0 }
  }));

  for (const event of data) {
    const price = await getEventPrice(event);
    const day = new Date(event.start_time).getDate();
    dailyData[day - 1].revenue += price;
    dailyData[day - 1].bookings += 1;
    dailyData[day - 1].byRoom[event.room_id] += price;
  }

  return dailyData;
}

/**
 * 주별 매출 통계 (ISO 주차 기준)
 */
async function getWeeklyStats(year) {
  const query = supabase
    .from('booking_events')
    .select('price, start_time, end_time, room_id, description')
    .gte('start_time', `${year}-01-01T00:00:00Z`)
    .lt('start_time', `${year + 1}-01-01T00:00:00Z`);

  const data = await fetchAllData(query);

  // ISO 주차 계산
  function getISOWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  const weeklyData = {};

  for (const event of data) {
    const price = await getEventPrice(event);
    const week = getISOWeek(event.start_time);
    if (!weeklyData[week]) {
      weeklyData[week] = {
        week,
        revenue: 0,
        bookings: 0,
        byRoom: { a: 0, b: 0, c: 0, d: 0, e: 0 }
      };
    }
    weeklyData[week].revenue += price;
    weeklyData[week].bookings += 1;
    weeklyData[week].byRoom[event.room_id] += price;
  }

  return Object.values(weeklyData).sort((a, b) => a.week - b.week);
}

/**
 * 시간대별 매출 통계
 */
async function getHourlyStats(year) {
  const query = supabase
    .from('booking_events')
    .select('price, start_time')
    .gte('start_time', `${year}-01-01T00:00:00Z`)
    .lt('start_time', `${year + 1}-01-01T00:00:00Z`)
    .not('price', 'is', null);

  const data = await fetchAllData(query);

  const hourlyData = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    revenue: 0,
    bookings: 0
  }));

  data.forEach(event => {
    const hour = new Date(event.start_time).getHours();
    hourlyData[hour].revenue += event.price || 0;
    hourlyData[hour].bookings += 1;
  });

  return hourlyData;
}

/**
 * Main handler
 */
export async function handler(event, context) {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // 쿼리 파라미터 파싱
    const params = event.queryStringParameters || {};
    const type = params.type || 'summary';
    const year = parseInt(params.year || new Date().getFullYear(), 10);
    const month = params.month ? parseInt(params.month, 10) : null;

    let result;

    switch (type) {
      case 'summary':
        result = await getYearlySummary(year);
        break;
      case 'monthly':
        result = await getMonthlyStats(year);
        break;
      case 'room':
        result = await getRoomStats(year);
        break;
      case 'daily':
        if (!month) {
          throw new Error('month 파라미터가 필요합니다');
        }
        result = await getDailyStats(year, month);
        break;
      case 'weekly':
        result = await getWeeklyStats(year);
        break;
      case 'hourly':
        result = await getHourlyStats(year);
        break;
      default:
        throw new Error('올바르지 않은 type 파라미터입니다');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: result })
    };

  } catch (error) {
    console.error('통계 조회 오류:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}
