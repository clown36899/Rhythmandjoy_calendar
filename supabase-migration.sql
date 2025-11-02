-- event_prices 테이블만 생성
-- booking_event_id로 연결해서 가격만 저장

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

-- updated_at 트리거
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

-- RLS
ALTER TABLE event_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON event_prices;
DROP POLICY IF EXISTS "Allow write access" ON event_prices;
DROP POLICY IF EXISTS "Allow update access" ON event_prices;

CREATE POLICY "Allow public read access" ON event_prices FOR SELECT USING (true);
CREATE POLICY "Allow write access" ON event_prices FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update access" ON event_prices FOR UPDATE USING (true);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_event_prices_booking_event_id ON event_prices(booking_event_id);

SELECT 'event_prices 테이블 생성 완료' AS status;
