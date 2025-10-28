# 🚀 Netlify + Supabase 배포 가이드

## 📋 개요

이 프로젝트는 다음 구조로 배포됩니다:

```
Netlify (프론트엔드 + 백엔드 Functions)
    ↓
Supabase (데이터베이스 + Realtime)
    ↓
Google Calendar API (예약 데이터 동기화)
```

**⚠️ Replit은 개발/테스트 전용입니다. 프로덕션은 Netlify를 사용합니다.**

---

## 1️⃣ Supabase 설정

### 데이터베이스 생성

1. [Supabase](https://supabase.com) 로그인
2. 새 프로젝트 생성
3. `supabase/schema.sql` 파일 내용을 SQL Editor에서 실행

### API 키 확인

Supabase 대시보드에서 다음 정보 확인:
- **SUPABASE_URL**: `https://your-project.supabase.co`
- **SUPABASE_ANON_KEY**: 공개 키 (프론트엔드용)
- **SUPABASE_SERVICE_ROLE_KEY**: 서비스 키 (백엔드용, 비공개!)

---

## 2️⃣ Netlify 배포

### GitHub 연결

1. [Netlify](https://netlify.com) 로그인
2. **New site from Git** 클릭
3. GitHub 리포지토리 선택
4. 빌드 설정은 `netlify.toml`에서 자동으로 인식됨

### 환경 변수 설정

Netlify 대시보드 → **Site settings** → **Environment variables**

**필수 환경 변수** (4개):

```bash
# Supabase (프론트엔드용)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Supabase (백엔드 Functions용)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Google Calendar API
GOOGLE_CALENDAR_API_KEY=AIzaSyCLqM39X5vTjrNt1Vl5miRryXWkLYPqky8
```

---

## 3️⃣ 초기 데이터 동기화

배포 후 **한 번만** 실행:

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/sync-calendar
```

**응답 예시**:
```json
{
  "success": true,
  "message": "전체 캘린더 동기화 완료",
  "results": [
    { "room": "a", "count": 388 },
    { "room": "b", "count": 383 },
    { "room": "c", "count": 72 },
    { "room": "d", "count": 88 },
    { "room": "e", "count": 138 }
  ]
}
```

---

## 4️⃣ Netlify Functions 설명

### `/sync-calendar` (POST)

**용도**: Google Calendar → Supabase 전체 동기화

**사용 시점**:
- 초기 배포 후 1회
- 수동 동기화가 필요할 때

**실행 방법**:
```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/sync-calendar
```

### `/google-webhook` (POST)

**용도**: Google Calendar Webhook 수신 (실시간 업데이트용)

**설정 방법**: Google Cloud Console에서 설정 필요 (선택사항)

---

## 5️⃣ 커스텀 도메인 연결

### Netlify에서 도메인 추가

1. Netlify 대시보드 → **Domain settings**
2. **Add custom domain** 클릭
3. `리듬앤조이일정표.com` 입력

### DNS 설정 (Cafe24)

Cafe24 도메인 관리에서 다음 레코드 추가:

| 타입 | 이름 | 값 |
|------|------|-----|
| A | @ | 75.2.60.5 |
| CNAME | www | your-site.netlify.app |

**전파 시간**: 최대 48시간

---

## 6️⃣ 배포 확인

### 프론트엔드 확인
```
https://your-site.netlify.app
```

브라우저 콘솔에서 확인:
```
🚀 전체 예약 데이터 로드 시작...
✅ 전체 데이터 로드 완료 (548ms)
   총합: 1000개
✅ Supabase Realtime 구독 성공
```

### Functions 확인

```bash
# 동기화 함수 테스트
curl -X POST https://your-site.netlify.app/.netlify/functions/sync-calendar

# Webhook 함수 테스트
curl https://your-site.netlify.app/.netlify/functions/google-webhook
```

Netlify 대시보드 → **Functions** 탭에서 로그 확인

---

## 🔄 업데이트 방법

### 코드 변경 시

```bash
git add .
git commit -m "업데이트"
git push origin main
```

Netlify가 자동으로 재배포합니다.

### 환경 변수 변경 시

1. Netlify 대시보드 → **Environment variables**
2. 변수 수정
3. **Trigger deploy** 클릭

### 데이터 재동기화

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/sync-calendar
```

---

## 🛠️ 문제 해결

### 데이터가 안 보일 때

1. Netlify Functions 로그 확인:
   - Netlify 대시보드 → **Functions** → 로그 확인

2. 환경 변수 확인:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` 올바른지 확인

3. 수동 동기화 실행:
   ```bash
   curl -X POST https://your-site.netlify.app/.netlify/functions/sync-calendar
   ```

### Realtime이 작동 안 할 때

1. Supabase 대시보드 → **Database** → **Replication**
2. `booking_events` 테이블의 **Realtime** 활성화 확인

3. 브라우저 콘솔에서 확인:
   ```javascript
   window.SupabaseCalendar.supabase
   ```

### Functions 오류 발생 시

1. Netlify Functions 로그 확인
2. 환경 변수 누락 확인:
   - `GOOGLE_CALENDAR_API_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

---

## 📊 비용 안내

### Netlify (무료 플랜)
- 대역폭: 100GB/월
- Functions: 125,000 요청/월 ✅
- 빌드 시간: 300분/월

### Supabase (무료 플랜)
- 데이터베이스: 500MB ✅
- 대역폭: 5GB/월
- Realtime 연결: 200개 동시

### Google Calendar API (무료)
- 100만 요청/일 ✅

**예상 사용량**: 무료 플랜으로 충분합니다!

---

## ✅ 배포 체크리스트

- [ ] Supabase 프로젝트 생성
- [ ] 데이터베이스 스키마 적용 (`supabase/schema.sql`)
- [ ] GitHub 리포지토리 연결
- [ ] Netlify 환경 변수 설정 (4개)
- [ ] Netlify 자동 배포 확인
- [ ] 초기 데이터 동기화 실행 (curl 명령)
- [ ] 브라우저에서 캘린더 표시 확인
- [ ] Realtime 구독 확인 (브라우저 콘솔)
- [ ] 커스텀 도메인 연결 (선택)

---

## 🎯 완료!

모든 설정이 완료되면:
- ✅ 프론트엔드: Netlify 자동 배포
- ✅ 백엔드: Netlify Functions (서버리스)
- ✅ 데이터베이스: Supabase PostgreSQL
- ✅ 실시간 업데이트: Supabase Realtime
- ✅ **Replit 서버 불필요!** (개발/테스트만 사용)

**배포 구조**:
```
GitHub → Netlify (자동 배포) → Supabase (데이터베이스)
```

**Google API 키 관리**:
- 개발: Replit Secrets
- 프로덕션: Netlify 환경 변수 🔒
