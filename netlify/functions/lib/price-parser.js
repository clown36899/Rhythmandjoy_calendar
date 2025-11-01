/**
 * Google Calendar 이벤트에서 가격 정보 추출
 * @param {string} title - 이벤트 제목
 * @param {string} description - 이벤트 설명
 * @returns {{price: number|null, priceType: string|null}}
 */
function parsePriceFromEvent(title, description) {
  const text = `${title || ''} ${description || ''}`;
  
  // 가격 패턴: "30,000원", "30000원", "3만원" 등
  const pricePattern = /(\d{1,3}(?:,\d{3})*)\s*원/;
  const match = text.match(pricePattern);
  
  let price = null;
  let priceType = null;
  
  if (match) {
    // 쉼표 제거 후 숫자 변환
    price = parseInt(match[1].replace(/,/g, ''), 10);
    
    // 가격 타입 추론 (키워드 기반)
    const lowerText = text.toLowerCase();
    if (lowerText.includes('심야') || lowerText.includes('야간')) {
      priceType = '심야';
    } else if (lowerText.includes('새벽')) {
      priceType = '새벽';
    } else if (lowerText.includes('할인') || lowerText.includes('특가')) {
      priceType = '할인';
    } else {
      priceType = '일반';
    }
  } else {
    // 가격이 명시되지 않은 경우 시간대별 기본 가격 추정
    priceType = inferPriceTypeFromTime(title, description);
  }
  
  return { price, priceType };
}

/**
 * 제목/설명에서 시간대 정보를 기반으로 가격 타입 추정
 */
function inferPriceTypeFromTime(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  
  if (text.includes('심야') || text.includes('야간')) {
    return '심야';
  } else if (text.includes('새벽')) {
    return '새벽';
  } else if (text.includes('할인') || text.includes('특가')) {
    return '할인';
  }
  
  return '일반';
}

/**
 * 시간 기반 기본 가격 추정 (가격 정보 없을 때)
 * @param {Date} startTime - 예약 시작 시간
 * @param {Date} endTime - 예약 종료 시간
 * @param {string} roomId - 방 ID (a, b, c, d, e)
 * @returns {number|null}
 */
function estimateDefaultPrice(startTime, endTime, roomId) {
  const hour = new Date(startTime).getHours();
  const duration = (new Date(endTime) - new Date(startTime)) / (1000 * 60 * 60); // 시간 단위
  
  // 시간대별 시간당 기본 요금 (예시 - 실제 요금으로 수정 필요)
  let hourlyRate;
  
  if (hour >= 0 && hour < 6) {
    // 새벽 (00:00~06:00)
    hourlyRate = 15000;
  } else if (hour >= 6 && hour < 16) {
    // 오전~오후 4시 (06:00~16:00)
    hourlyRate = 20000;
  } else if (hour >= 16 && hour < 22) {
    // 오후 4시~밤 10시 (16:00~22:00)
    hourlyRate = 25000;
  } else {
    // 심야 (22:00~24:00)
    hourlyRate = 30000;
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
  return Math.round(hourlyRate * duration * multiplier);
}

module.exports = {
  parsePriceFromEvent,
  estimateDefaultPrice
};
