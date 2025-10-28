# Google Calendar 실시간 동기화 설정 가이드

Google Calendar에 예약을 올리면 **즉시 (1초 이내)** 사이트에 반영되도록 설정합니다.

---

## 📋 준비물

- Google Cloud Console 접근 권한
- 5개 Google Calendar 관리 권한
- Netlify 배포 환경 접근 권한

---

## 1단계: Google Cloud Console 설정

### 1-1. Google Cloud 프로젝트 생성/선택

1. https://console.cloud.google.com/ 접속
2. 기존 프로젝트 선택 또는 새 프로젝트 생성
3. **프로젝트 ID**를 메모하세요

### 1-2. Google Calendar API 활성화

1. 좌측 메뉴: **API 및 서비스** → **라이브러리**
2. "Google Calendar API" 검색
3. **사용 설정** 클릭

### 1-3. Service Account 생성

1. 좌측 메뉴: **API 및 서비스** → **사용자 인증 정보**
2. 상단 **+ 사용자 인증 정보 만들기** → **서비스 계정** 선택
3. 서비스 계정 세부정보:
   - **이름**: `rhythmjoy-calendar-sync` (또는 원하는 이름)
   - **설명**: `리듬앤조이 캘린더 실시간 동기화`
4. **만들기 및 계속하기** 클릭
5. 역할은 **건너뛰기** (캘린더별로 직접 공유할 예정)
6. **완료** 클릭

### 1-4. Service Account 키 생성

1. 방금 만든 서비스 계정 클릭
2. 상단 **키** 탭 선택
3. **키 추가** → **새 키 만들기**
4. **JSON** 선택 → **만들기**
5. **JSON 파일이 자동 다운로드됩니다** (중요! 안전하게 보관)

**다운로드된 파일 예시:**
```json
{
  "type": "service_account",
  "project_id": "your-project-123456",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "rhythmjoy-calendar-sync@your-project-123456.iam.gserviceaccount.com",
  "client_id": "123456789...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

**중요:** 이 파일의 `client_email` (서비스 계정 이메일)을 복사하세요!

---

## 2단계: Google Calendar 공유 설정

5개 캘린더 각각에 Service Account를 공유해야 합니다.

### 각 캘린더별 작업:

1. **Google Calendar** 웹사이트 접속 (https://calendar.google.com)
2. 좌측에서 해당 캘린더 찾기
3. 캘린더 이름 옆 **⋮** (더보기) → **설정 및 공유**
4. **특정 사용자와 공유** 섹션에서 **+ 사용자 추가**
5. **이메일 주소** 입력란에 Service Account 이메일 붙여넣기
   ```
   rhythmjoy-calendar-sync@your-project-123456.iam.gserviceaccount.com
   ```
6. **권한**: **일정 변경 권한 만들기** 선택
7. **전송** 클릭

**5개 캘린더 모두 반복:**
- A홀 캘린더
- B홀 캘린더
- C홀 캘린더
- D홀 캘린더
- E홀 캘린더

---

## 3단계: Domain Verification (Netlify 도메인)

Google은 Webhook URL의 도메인을 인증해야 합니다.

### 3-1. Google Search Console 설정

1. https://search.google.com/search-console 접속
2. **속성 추가** 클릭
3. **URL 접두어** 선택
4. Netlify 도메인 입력:
   ```
   https://리듬앤조이일정표.com
   ```
   (또는 `https://rhythmandjoy.netlify.app`)
5. 소유권 확인:
   - **HTML 태그** 방법 선택
   - 제공된 메타 태그를 사이트 `<head>`에 추가
   - 또는 **DNS 레코드** 방법 사용 (도메인 관리자에서)

### 3-2. Google Cloud Console에서 도메인 등록

1. Google Cloud Console로 돌아가기
2. 좌측 메뉴: **API 및 서비스** → **사용자 인증 정보**
3. 상단 **도메인 확인** 클릭
4. 인증된 도메인 추가:
   ```
   리듬앤조이일정표.com
   ```

---

## 4단계: Netlify 환경 변수 설정

1. Netlify 사이트 대시보드 접속
2. **Site settings** → **Environment variables**
3. **Add a variable** 클릭
4. 새 환경 변수 추가:

   **이름:** `GOOGLE_SERVICE_ACCOUNT_JSON`  
   **값:** 다운로드한 JSON 파일 전체 내용 붙여넣기

   ```json
   {"type":"service_account","project_id":"your-project-123456",...}
   ```

5. **Create variable** 클릭

---

## 5단계: 초기 Watch 채널 등록

코드 배포 후, 한 번만 실행하면 됩니다:

### 방법 1: Netlify Function 직접 호출

```bash
curl -X POST https://리듬앤조이일정표.com/.netlify/functions/setup-watches
```

### 방법 2: 백엔드에서 수동 실행 (Replit)

```bash
cd backend
node setup-watch.js
```

**결과 확인:**
```
✅ A홀 Watch 등록 완료 (만료: 7일 후)
✅ B홀 Watch 등록 완료 (만료: 7일 후)
✅ C홀 Watch 등록 완료 (만료: 7일 후)
✅ D홀 Watch 등록 완료 (만료: 7일 후)
✅ E홀 Watch 등록 완료 (만료: 7일 후)
```

---

## ✅ 완료!

이제 Google Calendar에 예약을 추가/수정/삭제하면:

1. Google이 즉시 Netlify Webhook으로 알림 전송 (1초 이내)
2. Webhook이 변경 사항만 Supabase에 업데이트
3. Supabase Realtime이 프론트엔드에 즉시 반영
4. 사용자가 캘린더에서 자동으로 새로고침 확인

---

## 🔧 문제 해결

### "Unauthorized WebHook callback channel" 에러

- Domain verification 재확인
- Netlify 도메인이 정확한지 확인
- HTTPS 인증서 유효한지 확인

### Watch 채널이 작동하지 않음

- Service Account 이메일이 5개 캘린더 모두에 공유되었는지 확인
- 권한이 "일정 변경 권한"인지 확인

### 채널 만료 (7일 후)

- 자동 갱신 Scheduled Function이 작동 중입니다
- Supabase `calendar_channels` 테이블에서 만료일 확인 가능

---

## 📊 모니터링

Supabase에서 실시간 상태 확인:

```sql
-- 활성 채널 확인
SELECT * FROM calendar_channels WHERE expiration > NOW();

-- 최근 동기화 확인
SELECT * FROM calendar_sync_state ORDER BY last_synced_at DESC;
```

---

**문의사항이 있으시면 언제든지 알려주세요!**
