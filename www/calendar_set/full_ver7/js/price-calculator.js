// 기본 가격 정보 (fallback용)
const DEFAULT_ROOM_PRICES = {
  a: { before16: 10000, after16: 13000, overnight: 30000 },
  b: { before16: 9000, after16: 11000, overnight: 20000 },
  c: { before16: 4000, after16: 6000, overnight: 15000 },
  d: { before16: 3000, after16: 5000, overnight: 15000 },
  e: { before16: 8000, after16: 10000, overnight: 20000 }
};

// 2025년 한국 법정 공휴일 (매년 업데이트 필요)
const KOREAN_HOLIDAYS_2025 = [
  '2025-01-01', // 신정
  '2025-01-28', // 설날 연휴
  '2025-01-29', // 설날
  '2025-01-30', // 설날 연휴
  '2025-03-01', // 삼일절
  '2025-03-03', // 대체공휴일 (삼일절)
  '2025-05-05', // 어린이날
  '2025-05-06', // 부처님오신날
  '2025-06-06', // 현충일
  '2025-08-15', // 광복절
  '2025-09-06', // 추석 연휴
  '2025-09-07', // 추석 연휴
  '2025-09-08', // 추석
  '2025-09-09', // 추석 연휴
  '2025-10-03', // 개천절
  '2025-10-09', // 한글날
  '2025-12-25'  // 성탄절
];

// 한국 시간대 (UTC+9) 기준으로 날짜 문자열 생성
function getKstDateString(date) {
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split('T')[0];
}

// UTC Date를 KST 시간으로 변환
function toKst(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

// KST 기준 시간 추출
function getKstHour(date) {
  const kst = toKst(date);
  return kst.getUTCHours();
}

// KST 기준 요일 추출 (0=일요일, 6=토요일)
function getKstDay(date) {
  const kst = toKst(date);
  return kst.getUTCDay();
}

// 주말 또는 공휴일 체크 (KST 기준)
function isWeekendOrHoliday(date) {
  const day = getKstDay(date);
  const dateString = getKstDateString(date);
  
  // 토요일(6) 또는 일요일(0) 또는 공휴일
  return day === 0 || day === 6 || KOREAN_HOLIDAYS_2025.includes(dateString);
}

// 네이버 예약 여부 체크
function isNaverBooking(description) {
  if (!description) return false;
  return /예약번호:\s*\d+/.test(description);
}

// 가격 계산 메인 함수
function calculatePrice(startTime, endTime, roomId, description = '', roomPrices = null) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  // roomPrices 파라미터가 없으면 기본값 사용
  const allPrices = roomPrices || DEFAULT_ROOM_PRICES;
  const prices = allPrices[roomId];
  
  if (!prices) {
    console.error(`Unknown room: ${roomId}`);
    return { price: 0, priceType: 'unknown', isNaver: false };
  }

  let totalPrice = 0;
  let priceType = '일반';
  const isNaver = isNaverBooking(description);

  // KST 기준 시간 추출
  const startHourKst = getKstHour(start);
  const endHourKst = getKstHour(end);
  const durationHours = (end - start) / (1000 * 60 * 60);

  // 새벽 통대관 체크: KST 0시~6시 정확히 6시간
  if (startHourKst === 0 && endHourKst === 6 && durationHours === 6) {
    totalPrice = prices.overnight;
    priceType = '새벽통대관';
  } else {
    // 시간별 계산
    let currentTime = new Date(start);
    
    console.log(`[${roomId}홀] 시작: ${start.toISOString()}, KST ${startHourKst}시`);
    
    while (currentTime < end) {
      const hourKst = getKstHour(currentTime);
      const isWeekend = isWeekendOrHoliday(currentTime);
      
      let hourlyPrice = 0;
      let reason = '';
      
      // 새벽 시간 (0~6시): overnight ÷ 6
      if (hourKst >= 0 && hourKst < 6) {
        hourlyPrice = prices.overnight / 6;
        reason = `새벽(KST ${hourKst}시)`;
      } 
      // 주말 또는 공휴일: after16 요금
      else if (isWeekend) {
        hourlyPrice = prices.after16;
        reason = `주말/공휴일(KST ${hourKst}시)`;
      }
      // 평일
      else {
        if (hourKst < 16) {
          hourlyPrice = prices.before16;
          reason = `평일오전(KST ${hourKst}시)`;
        } else {
          hourlyPrice = prices.after16;
          reason = `평일저녁(KST ${hourKst}시)`;
        }
      }
      
      console.log(`  ${currentTime.toISOString()} → ${reason} = ${hourlyPrice}원`);
      totalPrice += hourlyPrice;
      
      currentTime.setHours(currentTime.getHours() + 1);
    }
    
    console.log(`  총합: ${totalPrice}원, 수수료 후: ${Math.round(totalPrice * (isNaver ? 0.9802 : 0.9))}원`);

    // 가격 타입 결정 (KST 기준)
    if (startHourKst >= 0 && startHourKst < 6) {
      priceType = '새벽';
    } else if (isWeekendOrHoliday(start)) {
      priceType = '주말/공휴일';
    } else if (startHourKst >= 16) {
      priceType = '저녁';
    } else {
      priceType = '일반';
    }
  }

  // 수수료 적용
  const commission = isNaver ? 0.9802 : 0.9;
  totalPrice = Math.round(totalPrice * commission);

  return {
    price: totalPrice,
    priceType: priceType,
    isNaver: isNaver
  };
}

module.exports = {
  calculatePrice,
  DEFAULT_ROOM_PRICES,
  isWeekendOrHoliday,
  isNaverBooking
};
