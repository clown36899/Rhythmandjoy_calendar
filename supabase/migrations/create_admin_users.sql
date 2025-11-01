-- 관리자 사용자 테이블 생성
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS 활성화 (보안)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- 정책: 서비스 롤만 접근 가능
CREATE POLICY "Only service role can access admin_users" ON admin_users
  USING (false);

COMMENT ON TABLE admin_users IS '관리자 계정 정보';
COMMENT ON COLUMN admin_users.password_hash IS 'bcrypt 해시된 비밀번호';
