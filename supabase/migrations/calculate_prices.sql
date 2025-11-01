-- 기존 booking_events의 price와 price_type 계산

-- 1. 시간대별 price_type 설정
UPDATE booking_events
SET price_type = CASE
  WHEN EXTRACT(HOUR FROM start_time::timestamptz) >= 0 AND EXTRACT(HOUR FROM start_time::timestamptz) < 6 THEN '새벽'
  WHEN EXTRACT(HOUR FROM start_time::timestamptz) >= 22 THEN '심야'
  ELSE '일반'
END
WHERE price_type IS NULL;

-- 2. 시간대별 price 계산 (시간당 요금 × 예약 시간)
UPDATE booking_events
SET price = CASE
  -- 새벽 (00-06시): 15,000원/시간
  WHEN EXTRACT(HOUR FROM start_time::timestamptz) >= 0 AND EXTRACT(HOUR FROM start_time::timestamptz) < 6 
    THEN 15000 * EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
  -- 오전~오후4시 (06-16시): 20,000원/시간
  WHEN EXTRACT(HOUR FROM start_time::timestamptz) >= 6 AND EXTRACT(HOUR FROM start_time::timestamptz) < 16
    THEN 20000 * EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
  -- 저녁 (16-22시): 25,000원/시간
  WHEN EXTRACT(HOUR FROM start_time::timestamptz) >= 16 AND EXTRACT(HOUR FROM start_time::timestamptz) < 22
    THEN 25000 * EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
  -- 심야 (22-24시): 30,000원/시간
  ELSE 30000 * EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
END::INTEGER
WHERE price IS NULL;

-- 3. 방별 추가 요금 적용 (예시 - 실제 요금에 맞게 조정 필요)
UPDATE booking_events
SET price = CASE room_id
  WHEN 'a' THEN price * 1.0
  WHEN 'b' THEN price * 1.2
  WHEN 'c' THEN price * 1.0
  WHEN 'd' THEN price * 1.1
  WHEN 'e' THEN price * 0.9
  ELSE price
END::INTEGER
WHERE price IS NOT NULL;
