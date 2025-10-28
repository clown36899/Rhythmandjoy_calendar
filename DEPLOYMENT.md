# Rhythmjoy Supabase + Netlify 배포 가이드

## 📋 목차
1. [Supabase 데이터베이스 설정](#supabase-데이터베이스-설정)
2. [초기 데이터 동기화](#초기-데이터-동기화)
3. [Netlify 배포](#netlify-배포)
4. [환경 변수 설정](#환경-변수-설정)

---

## 1. Supabase 데이터베이스 설정

### 1-1. Supabase 대시보드 접속
- URL: https://izcdhoozlvcmjcbnvwoe.supabase.co
- Table Editor 또는 SQL Editor로 이동

### 1-2. SQL 스키마 실행
`supabase/schema.sql` 파일의 내용을 Supabase SQL Editor에 복사하여 실행:

```sql
-- 전체 스키마 실행 (supabase/schema.sql 파일 내용)
```

실행 후 확인사항:
- ✅ `rooms` 테이블 생성 (5개 연습실 데이터 포함)
- ✅ `booking_events` 테이블 생성
- ✅ 인덱스 및 RLS 정책 설정

### 1-3. Realtime 활성화
Supabase 대시보드에서:
1. Database → Replication 메뉴
2. `booking_events` 테이블에서 **Realtime** 활성화

---

## 2. 초기 데이터 동기화

### 2-1. Replit에서 동기화 실행
```bash
cd backend
npm run sync
```

이 명령은:
- Google Calendar API를 통해 최근 3개월 예약 데이터 가져오기
- Supabase `booking_events` 테이블에 저장

### 2-2. 동기화 확인
Supabase Table Editor에서 `booking_events` 테이블 확인
- A, B, C, D, E 각 홀의 예약 데이터가 들어있는지 확인

---

## 3. Netlify 배포

### 3-1. GitHub 저장소 준비
```bash
git add .
git commit -m "Supabase 실시간 연동 완료"
git push origin main
```

### 3-2. Netlify 사이트 생성
1. Netlify 대시보드 접속: https://app.netlify.com
2. **Add new site** → **Import an existing project**
3. GitHub 저장소 선택

### 3-3. 빌드 설정
- **Base directory**: `www`
- **Build command**: (비워두기 - 정적 사이트)
- **Publish directory**: `calendar_set/full_ver7`

또는 root에 `netlify.toml` 파일 사용:
```toml
[build]
  base = "www"
  publish = "calendar_set/full_ver7"

[[redirects]]
  from = "/*"
  to = "/calendar_7.html"
  status = 200
```

### 3-4. 환경 변수 설정
Netlify → Site settings → Environment variables

**필수 환경 변수:**
```
SUPABASE_URL=https://izcdhoozlvcmjcbnvwoe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 4. 프론트엔드 환경 변수 주입

### 4-1. build 스크립트 생성
`www/build.sh` 파일:
```bash
#!/bin/bash
cat > calendar_set/full_ver7/env.js << EOF
window.SUPABASE_URL = '${SUPABASE_URL}';
window.SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
EOF
```

### 4-2. Netlify 빌드 명령 업데이트
```toml
[build]
  base = "www"
  command = "bash build.sh"
  publish = "calendar_set/full_ver7"
```

### 4-3. HTML에 env.js 추가
`calendar_7.html`의 `<head>` 섹션에:
```html
<script src="env.js"></script>
<script type="module" src="supabase-realtime.js"></script>
```

---

## 5. 백엔드 서버 배포 (선택사항)

백엔드는 Google Calendar Webhook 수신용으로, Replit에서 계속 실행 가능:
- **URL**: https://[your-repl-name].repl.co
- **Webhook endpoint**: `/api/calendar-webhook`

또는 Netlify Functions로 마이그레이션 가능 (추후 구현)

---

## 6. 테스트

### 6-1. Netlify 사이트 접속
- 배포된 URL로 이동 (예: https://rhythmjoy.netlify.app)
- 캘린더가 정상적으로 로드되는지 확인

### 6-2. 실시간 동기화 테스트
1. Google Calendar에서 예약 추가/수정
2. Replit 백엔드에서 동기화 실행: `npm run sync`
3. Netlify 사이트에서 자동으로 업데이트되는지 확인 (새로고침 없이)

---

## 7. 도메인 설정 (선택사항)

Netlify에서 커스텀 도메인 설정:
1. Site settings → Domain management
2. Add custom domain
3. DNS 설정 업데이트

---

## 🔧 트러블슈팅

### Realtime이 작동하지 않을 때
- Supabase Realtime이 활성화되어 있는지 확인
- 브라우저 콘솔에서 WebSocket 연결 확인

### 환경 변수가 로드되지 않을 때
- Netlify 환경 변수가 올바르게 설정되었는지 확인
- `env.js` 파일이 빌드 시 생성되는지 확인

### Google Calendar 데이터가 안 보일 때
- `npm run sync` 명령으로 수동 동기화 실행
- Supabase `booking_events` 테이블에 데이터가 있는지 확인
