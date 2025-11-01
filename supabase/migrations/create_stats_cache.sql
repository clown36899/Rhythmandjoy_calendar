-- 통계 캐시 테이블 생성
CREATE TABLE IF NOT EXISTS stats_cache (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  stat_type VARCHAR(50) NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(year, month, stat_type)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_stats_cache_year_month ON stats_cache(year, month);
CREATE INDEX IF NOT EXISTS idx_stats_cache_type ON stats_cache(stat_type);

-- RLS 활성화 (읽기 전용 공개)
ALTER TABLE stats_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stats_cache 읽기 허용" ON stats_cache
  FOR SELECT
  USING (true);

COMMENT ON TABLE stats_cache IS '월별 통계 캐시 테이블 - 지나간 달 통계는 여기서 빠르게 조회';
COMMENT ON COLUMN stats_cache.stat_type IS 'monthly, room, hourly 등 통계 타입';
COMMENT ON COLUMN stats_cache.data IS '계산된 통계 데이터 (JSON)';
