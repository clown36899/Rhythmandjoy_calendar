-- 기존 booking_events 테이블에 가격 컬럼 추가
ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS price INTEGER;
ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS price_type TEXT;
ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS is_naver BOOLEAN DEFAULT false;

-- 인덱스 추가 (통계 쿼리 성능 향상)
CREATE INDEX IF NOT EXISTS idx_booking_events_price ON booking_events(price);
CREATE INDEX IF NOT EXISTS idx_booking_events_year_month ON booking_events(EXTRACT(YEAR FROM start_time), EXTRACT(MONTH FROM start_time));
CREATE INDEX IF NOT EXISTS idx_booking_events_is_naver ON booking_events(is_naver);

COMMENT ON COLUMN booking_events.price IS '계산된 최종 가격 (수수료 적용 후, 원 단위)';
COMMENT ON COLUMN booking_events.price_type IS '가격 타입 (새벽통대관/새벽/일반/저녁/주말/공휴일)';
COMMENT ON COLUMN booking_events.is_naver IS '네이버 예약 여부 (수수료율 다름)';
