/**
 * Google Calendar 이벤트에서 가격 정보 추출
 * @param {string} title - 이벤트 제목
 * @param {string} description - 이벤트 설명
 * @param {string} startTime - 이벤트 시작 시간 (ISO 8601)
 * @returns {{price: number|null, priceType: string|null}}
 */
function parsePriceFromEvent(title, description, startTime) {
  const text = `${title || ''} ${description || ''}`;
  
  let price = null;
  let priceType = null;
  
  // 패턴 1: "30,000원", "30000원" (쉼표 포함/미포함)
  const pattern1 = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/;
  const match1 = text.match(pattern1);
  
  // 패턴 2: "3만원", "3만 원", "5만5천원" (한글 단위)
  const pattern2 = /(\d+)\s*만\s*(\d*)\s*천?\s*원/;
  const match2 = text.match(pattern2);
  
  if (match1) {
    // 쉼표 제거 후 숫자 변환
    price = parseInt(match1[1].replace(/,/g, ''), 10);
  } else if (match2) {
    // 만원 단위 변환: "3만원" → 30000, "5만5천원" → 55000
    const manWon = parseInt(match2[1], 10) * 10000;
    const cheonWon = match2[2] ? parseInt(match2[2], 10) * 1000 : 0;
    price = manWon + cheonWon;
  }
  
  // 가격 타입 결정
  if (price !== null) {
    const lowerText = text.toLowerCase();
    
    // 1순위: 명시적 키워드 (심야/새벽/할인)
    if (lowerText.includes('심야') || lowerText.includes('야간')) {
      priceType = '심야';
    } else if (lowerText.includes('새벽')) {
      priceType = '새벽';
    } else if (lowerText.includes('할인') || lowerText.includes('특가')) {
      priceType = '할인';
    } else {
      // 2순위: 시간대 기반 자동 분류 (키워드 없으면)
      priceType = inferPriceTypeFromTime(startTime);
    }
  } else {
    // 가격이 명시되지 않은 경우 키워드에서 타입 추론
    priceType = inferPriceTypeFromText(title, description);
  }
  
  return { price, priceType };
}

/**
 * 제목/설명에서 키워드 기반 가격 타입 추정
 */
function inferPriceTypeFromText(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  
  if (text.includes('심야') || text.includes('야간')) {
    return '심야';
  } else if (text.includes('새벽')) {
    return '새벽';
  } else if (text.includes('할인') || text.includes('특가')) {
    return '할인';
  }
  
  return null; // 명시된 타입 없음
}

/**
 * 시작 시간 기반 가격 타입 추정
 * @param {string} startTime - ISO 8601 시작 시간
 * @returns {string} 가격 타입
 */
function inferPriceTypeFromTime(startTime) {
  if (!startTime) {
    return '일반'; // 시간 정보 없으면 일반
  }
  
  // 올데이 이벤트 체크: "2025-11-01" 형식 (시간 정보 없음)
  // dateTime 형식은 "2025-11-01T14:00:00Z" (T 포함)
  if (!startTime.includes('T')) {
    return '일반'; // 올데이 이벤트는 시간 정보 없으므로 일반
  }
  
  const date = new Date(startTime);
  
  // 유효하지 않은 날짜 체크
  if (isNaN(date.getTime())) {
    return '일반';
  }
  
  const hour = date.getHours();
  
  if (hour >= 0 && hour < 6) {
    // 새벽 (00:00~06:00)
    return '새벽';
  } else if (hour >= 22) {
    // 심야 (22:00~24:00)
    return '심야';
  } else {
    // 일반 (06:00~22:00)
    return '일반';
  }
}

/**
 * 시간 기반 기본 가격 추정 (가격 정보 없을 때)
 * @param {Date} startTime - 예약 시작 시간
 * @param {Date} endTime - 예약 종료 시간
 * @param {string} roomId - 방 ID (a, b, c, d, e)
 * @returns {{price: number, priceType: string}}
 */
function estimateDefaultPrice(startTime, endTime, roomId) {
  const hour = new Date(startTime).getHours();
  const duration = (new Date(endTime) - new Date(startTime)) / (1000 * 60 * 60); // 시간 단위
  
  // 시간대별 시간당 기본 요금 및 타입
  let hourlyRate;
  let priceType;
  
  if (hour >= 0 && hour < 6) {
    // 새벽 (00:00~06:00)
    hourlyRate = 15000;
    priceType = '새벽';
  } else if (hour >= 6 && hour < 16) {
    // 오전~오후 4시 (06:00~16:00)
    hourlyRate = 20000;
    priceType = '일반';
  } else if (hour >= 16 && hour < 22) {
    // 오후 4시~밤 10시 (16:00~22:00)
    hourlyRate = 25000;
    priceType = '일반';
  } else {
    // 심야 (22:00~24:00)
    hourlyRate = 30000;
    priceType = '심야';
  }
  
  // 방별 추가 요금 (예시)
  const roomMultiplier = {
    'a': 1.0,
    'b': 1.2,
    'c': 1.0,
    'd': 1.1,
    'e': 0.9
  };
  
  const multiplier = roomMultiplier[roomId] || 1.0;
  const price = Math.round(hourlyRate * duration * multiplier);
  
  return { price, priceType };
}

export {
  parsePriceFromEvent,
  estimateDefaultPrice
};
