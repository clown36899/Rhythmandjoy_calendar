-- 기존 booking_events 테이블에 가격 컬럼 추가
ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS price INTEGER;
ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS price_type TEXT;

-- 인덱스 추가 (통계 쿼리 성능 향상)
CREATE INDEX IF NOT EXISTS idx_booking_events_price ON booking_events(price);
CREATE INDEX IF NOT EXISTS idx_booking_events_year_month ON booking_events(EXTRACT(YEAR FROM start_time), EXTRACT(MONTH FROM start_time));

COMMENT ON COLUMN booking_events.price IS '예약 가격 (원 단위)';
COMMENT ON COLUMN booking_events.price_type IS '가격 타입 (일반/심야/새벽/할인 등)';
