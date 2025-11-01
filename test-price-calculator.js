// 가격 계산 로직 테스트
const { calculatePrice } = require('./netlify/functions/lib/price-calculator.js');

// 테스트 케이스: D홀 평일 아침 9~10시 (1시간)
// 예상: 3,000원 * 0.9 = 2,700원

console.log('=== 가격 계산 테스트 ===\n');

// 한국 시간 2025년 11월 3일 월요일 09:00 ~ 10:00
// UTC로 변환하면 2025-11-03T00:00:00Z ~ 01:00:00Z
const test1 = {
  start: '2025-11-03T00:00:00.000Z', // KST 9:00
  end: '2025-11-03T01:00:00.000Z',   // KST 10:00
  room: 'd',
  description: '일반 예약'
};

console.log('테스트 1: D홀 평일 아침 9~10시 (일반 예약)');
console.log('시작:', test1.start, '(KST 09:00)');
console.log('종료:', test1.end, '(KST 10:00)');
const result1 = calculatePrice(test1.start, test1.end, test1.room, test1.description);
console.log('결과:', result1);
console.log('예상: 2,700원 (3,000 * 0.9)\n');

// 테스트 2: 네이버 예약
const test2 = {
  start: '2025-11-03T00:00:00.000Z',
  end: '2025-11-03T01:00:00.000Z',
  room: 'd',
  description: '예약번호: 12345'
};

console.log('테스트 2: D홀 평일 아침 9~10시 (네이버 예약)');
const result2 = calculatePrice(test2.start, test2.end, test2.room, test2.description);
console.log('결과:', result2);
console.log('예상: 2,941원 (3,000 * 0.9802)\n');

// 테스트 3: 주말
const test3 = {
  start: '2025-11-01T00:00:00.000Z', // 토요일 KST 09:00
  end: '2025-11-01T01:00:00.000Z',
  room: 'd',
  description: '일반 예약'
};

console.log('테스트 3: D홀 주말 9~10시');
const result3 = calculatePrice(test3.start, test3.end, test3.room, test3.description);
console.log('결과:', result3);
console.log('예상: 4,500원 (5,000 * 0.9)\n');

// 테스트 4: 저녁 시간
const test4 = {
  start: '2025-11-03T09:00:00.000Z', // KST 18:00
  end: '2025-11-03T10:00:00.000Z',   // KST 19:00
  room: 'd',
  description: '일반 예약'
};

console.log('테스트 4: D홀 평일 저녁 18~19시');
const result4 = calculatePrice(test4.start, test4.end, test4.room, test4.description);
console.log('결과:', result4);
console.log('예상: 4,500원 (5,000 * 0.9)\n');
