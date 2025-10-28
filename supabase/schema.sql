-- Rhythmjoy 예약 캘린더 데이터베이스 스키마

-- 연습실 정보 테이블
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  google_calendar_id TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 예약 이벤트 테이블
CREATE TABLE IF NOT EXISTS booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  google_event_id TEXT UNIQUE,
  title TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_booking_events_room_id ON booking_events(room_id);
CREATE INDEX IF NOT EXISTS idx_booking_events_start_time ON booking_events(start_time);
CREATE INDEX IF NOT EXISTS idx_booking_events_google_event_id ON booking_events(google_event_id);

-- RLS (Row Level Security) 활성화
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기 가능하도록 정책 설정
CREATE POLICY "Allow public read access to rooms" ON rooms
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access to booking_events" ON booking_events
  FOR SELECT USING (true);

-- 초기 데이터 입력 (5개 연습실)
INSERT INTO rooms (id, name, google_calendar_id, color) VALUES
  ('a', 'A홀', '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com', '#F6BF26'),
  ('b', 'B홀', '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com', 'rgb(87, 150, 200)'),
  ('c', 'C홀', 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com', 'rgb(129, 180, 186)'),
  ('d', 'D홀', '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com', 'rgb(125, 157, 106)'),
  ('e', 'E홀', 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com', '#4c4c4c')
ON CONFLICT (id) DO NOTHING;
