-- price_history 테이블: 날짜별 가격 정책 관리
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to DATE,
  price_weekday_before16 INTEGER NOT NULL,
  price_weekday_after16 INTEGER NOT NULL,
  price_weekend INTEGER NOT NULL,
  price_dawn_hourly INTEGER NOT NULL DEFAULT 5000,
  price_overnight INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 날짜 범위 겹침 방지 제약조건 (같은 방에서 날짜가 겹치면 안됨)
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE price_history 
ADD CONSTRAINT price_history_no_overlap 
EXCLUDE USING GIST (
  room_id WITH =, 
  daterange(effective_from, COALESCE(effective_to, '9999-12-31'::date), '[]') WITH &&
);

-- 조회 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_price_history_lookup 
  ON price_history(room_id, effective_from, effective_to);

-- RLS 설정
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON price_history;
DROP POLICY IF EXISTS "Allow write access" ON price_history;
DROP POLICY IF EXISTS "Allow update access" ON price_history;
DROP POLICY IF EXISTS "Allow delete access" ON price_history;

CREATE POLICY "Allow public read access" ON price_history FOR SELECT USING (true);
CREATE POLICY "Allow write access" ON price_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update access" ON price_history FOR UPDATE USING (true);
CREATE POLICY "Allow delete access" ON price_history FOR DELETE USING (true);

-- updated_at 트리거 적용
DROP TRIGGER IF EXISTS update_price_history_updated_at ON price_history;
CREATE TRIGGER update_price_history_updated_at
  BEFORE UPDATE ON price_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

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
