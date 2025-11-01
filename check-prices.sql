-- D홀 이벤트 중 아침 시간대 (KST 9~10시) 조회
-- UTC로는 0~1시

SELECT 
  id,
  room_id,
  title,
  start_time,
  end_time,
  EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 AS duration_hours,
  price,
  price_type,
  is_naver,
  description
FROM booking_events
WHERE room_id = 'd'
  AND EXTRACT(HOUR FROM start_time) = 0  -- UTC 0시 = KST 9시
  AND EXTRACT(HOUR FROM end_time) = 1    -- UTC 1시 = KST 10시
  AND price IS NOT NULL
ORDER BY start_time DESC
LIMIT 10;

-- 전체 통계 확인
SELECT 
  room_id,
  COUNT(*) as total_events,
  COUNT(price) as events_with_price,
  MIN(price) as min_price,
  MAX(price) as max_price,
  AVG(price)::INTEGER as avg_price
FROM booking_events
GROUP BY room_id
ORDER BY room_id;

-- price가 비정상적으로 높은 이벤트 찾기
SELECT 
  id,
  room_id,
  title,
  start_time,
  end_time,
  EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 AS duration_hours,
  price,
  price / (EXTRACT(EPOCH FROM (end_time - start_time)) / 3600) AS price_per_hour,
  price_type,
  is_naver
FROM booking_events
WHERE price > 15000 
  AND EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 < 2  -- 2시간 미만인데 15,000원 넘는 것
ORDER BY price DESC
LIMIT 20;
