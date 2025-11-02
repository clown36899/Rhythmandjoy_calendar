-- =============================================
-- Rhythmjoy 매출 대시보드용 event_prices 테이블 생성
-- =============================================
-- 목적: booking_events는 Google Calendar 동기화 전용
--       가격 계산 결과는 event_prices에 별도 저장
-- =============================================

-- 1. event_prices 테이블 생성
CREATE TABLE IF NOT EXISTS event_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_event_id UUID NOT NULL UNIQUE,
  calculated_price NUMERIC(12, 0) NOT NULL DEFAULT 0,
  price_type TEXT,
  price_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_booking_event 
    FOREIGN KEY (booking_event_id) 
    REFERENCES booking_events(id) 
    ON DELETE CASCADE
);

-- 2. updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_event_prices_updated_at ON event_prices;
CREATE TRIGGER update_event_prices_updated_at
  BEFORE UPDATE ON event_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 3. 코멘트 추가
COMMENT ON TABLE event_prices IS '클라이언트 계산 가격 저장 (booking_events는 건드리지 않음)';
COMMENT ON COLUMN event_prices.booking_event_id IS 'booking_events.id 외래키';
COMMENT ON COLUMN event_prices.calculated_price IS '클라이언트 측에서 계산된 가격';

-- 4. RLS 활성화 및 정책 설정
ALTER TABLE event_prices ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 후 재생성
DROP POLICY IF EXISTS "Allow public read access" ON event_prices;
DROP POLICY IF EXISTS "Allow write access" ON event_prices;
DROP POLICY IF EXISTS "Allow update access" ON event_prices;

-- 모든 사용자 읽기 허용
CREATE POLICY "Allow public read access"
  ON event_prices
  FOR SELECT
  USING (true);

-- 모든 사용자 쓰기 허용 (admin 인증은 앱 레벨에서 처리)
CREATE POLICY "Allow write access"
  ON event_prices
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow update access"
  ON event_prices
  FOR UPDATE
  USING (true);

-- 5. 인덱스 생성 (JOIN 성능 향상)
CREATE INDEX IF NOT EXISTS idx_event_prices_booking_event_id 
  ON event_prices(booking_event_id);

CREATE INDEX IF NOT EXISTS idx_event_prices_metadata 
  ON event_prices USING GIN(price_metadata);

-- 6. booking_events_with_price VIEW 생성
CREATE OR REPLACE VIEW booking_events_with_price AS
SELECT 
  be.*,
  COALESCE(ep.calculated_price, 0) AS calculated_price,
  ep.price_type,
  ep.price_metadata,
  ep.updated_at AS price_updated_at
FROM booking_events be
LEFT JOIN event_prices ep ON be.id = ep.booking_event_id;

COMMENT ON VIEW booking_events_with_price IS 'booking_events + calculated_price (LEFT JOIN event_prices)';

-- 7. 기존 데이터 백필 (booking_events.price → event_prices)
-- 주의: 이미 event_prices에 데이터가 있으면 ON CONFLICT로 업데이트
INSERT INTO event_prices (booking_event_id, calculated_price, price_type, price_metadata)
SELECT 
  id, 
  COALESCE(price, 0) AS calculated_price,
  price_type,
  jsonb_build_object('source', 'backfill_from_booking_events', 'backfill_date', NOW()) AS price_metadata
FROM booking_events 
WHERE id IS NOT NULL
ON CONFLICT (booking_event_id) 
DO UPDATE SET 
  calculated_price = EXCLUDED.calculated_price,
  price_type = EXCLUDED.price_type,
  price_metadata = EXCLUDED.price_metadata,
  updated_at = NOW();

-- 8. 확인 쿼리 (실행 후 확인용)
SELECT 
  (SELECT COUNT(*) FROM booking_events) AS total_booking_events,
  (SELECT COUNT(*) FROM event_prices) AS total_event_prices,
  (SELECT COUNT(*) FROM booking_events_with_price) AS total_view_records;
