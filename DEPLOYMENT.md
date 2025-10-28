# Netlify 배포 가이드

리듬앤조이 일정표 시스템을 Netlify에 배포하는 가이드입니다.

---

## 📋 배포 전 준비사항

### 1. Google Service Account 설정 (필수!)

**중요:** 실시간 동기화를 위해 Service Account가 필수입니다.

자세한 설정 방법은 **`GOOGLE_WEBHOOK_SETUP.md`** 파일을 참조하세요.

**요약:**
1. Google Cloud Console에서 Service Account 생성
2. JSON 키 파일 다운로드
3. 5개 캘린더에 Service Account 공유
4. Domain Verification 완료

### 2. Supabase 프로젝트 준비

- Supabase 프로젝트 생성 완료
- 필요한 테이블 생성 완료:
  - `rooms`
  - `booking_events`
  - `calendar_channels` (새로 추가됨)
  - `calendar_sync_state` (새로 추가됨)

---

## 🚀 Netlify 배포

### 1단계: GitHub 연결

1. 이 프로젝트를 GitHub에 push
2. Netlify 대시보드에서 **Add new site** → **Import an existing project**
3. GitHub 저장소 선택

### 2단계: 빌드 설정

Netlify는 `netlify.toml`을 자동으로 인식합니다.

**확인할 설정:**
```toml
[build]
  base = "www"
  command = "bash build.sh"
  publish = "calendar_set/full_ver7"
  functions = "../netlify/functions"
```

### 3단계: 환경 변수 설정

**Site settings** → **Environment variables**에서 다음 변수를 추가:

#### 필수 환경 변수:

| 변수명 | 값 | 설명 |
|--------|-----|------|
| `SUPABASE_URL` | `https://your-project.supabase.co` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | `eyJhbGc...` | Supabase 공개 키 (프론트엔드용) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` | Supabase 서비스 키 (백엔드용) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",...}` | Service Account JSON 전체 내용 |
| `WEBHOOK_URL` | `https://리듬앤조이일정표.com/.netlify/functions/google-webhook` | Webhook URL (도메인 설정 후) |

**주의:**
- `GOOGLE_SERVICE_ACCOUNT_JSON`은 JSON 파일 전체를 **한 줄로** 붙여넣기
- `WEBHOOK_URL`은 커스텀 도메인 설정 후 업데이트

### 4단계: 배포 실행

1. **Deploy site** 클릭
2. 빌드 로그 확인
3. 배포 완료 후 URL 확인 (예: `https://rhythmandjoy.netlify.app`)

---

## 🔧 배포 후 설정

### 1. 커스텀 도메인 설정

1. **Domain management** → **Add custom domain**
2. 도메인 입력: `리듬앤조이일정표.com`
3. DNS 설정 (도메인 제공업체에서):
   ```
   CNAME @ rhythmandjoy.netlify.app
   ```
4. SSL 인증서 자동 발급 대기 (수 분 소요)

### 2. 환경 변수 업데이트

커스텀 도메인 설정 후, `WEBHOOK_URL` 업데이트:

```
https://리듬앤조이일정표.com/.netlify/functions/google-webhook
```

### 3. Google Calendar Watch 채널 등록

**한 번만 실행:**

```bash
curl -X POST https://리듬앤조이일정표.com/.netlify/functions/setup-watches
```

**결과 확인:**
```json
{
  "message": "Watch 채널 등록 완료",
  "results": [
    {
      "room": "a",
      "channelId": "uuid-123...",
      "expiration": "2025-11-04T..."
    },
    ...
  ]
}
```

---

## ✅ 배포 확인

### 1. 사이트 접속
- https://리듬앤조이일정표.com 접속
- 캘린더가 정상 표시되는지 확인

### 2. 실시간 동기화 테스트

1. Google Calendar에서 예약 추가
2. **1~2초 이내** 사이트에 자동 반영 확인
3. 브라우저 개발자 도구 콘솔 확인:
   ```
   🔔 실시간 변경 감지: INSERT
   🔄 데이터 변경 감지, 캘린더 새로고침 중...
   ✅ 캘린더 새로고침 완료
   ```

### 3. Netlify Functions 로그 확인

**Netlify 대시보드** → **Functions** → **google-webhook**

Google Calendar 변경 시 로그:
```
📨 Google Calendar Webhook 수신
🔔 a홀 변경 감지
🔄 a홀 증분 동기화 시작...
  📌 1개 변경 감지
  ✅ 업데이트: 예약 제목
✅ a홀 동기화 완료
```

### 4. Supabase 데이터 확인

```sql
-- 채널 상태 확인
SELECT 
  room_id,
  channel_id,
  TO_TIMESTAMP(expiration / 1000) AS expires_at
FROM calendar_channels
ORDER BY room_id;

-- 최근 동기화 확인
SELECT 
  room_id,
  last_synced_at,
  sync_token IS NOT NULL AS has_sync_token
FROM calendar_sync_state
ORDER BY last_synced_at DESC;
```

---

## 🔄 유지보수

### 채널 자동 갱신

- **Scheduled Function**이 매일 오전 3시 자동 실행
- 24시간 이내 만료 예정 채널 자동 갱신
- 수동 실행 (필요 시):
  ```bash
  curl -X POST https://리듬앤조이일정표.com/.netlify/functions/renew-watches
  ```

### 수동 전체 동기화

문제 발생 시 수동으로 전체 동기화:

```bash
curl -X POST https://리듬앤조이일정표.com/.netlify/functions/sync-calendar
```

---

## 🐛 문제 해결

### 실시간 업데이트가 작동하지 않음

1. **채널 상태 확인:**
   ```sql
   SELECT * FROM calendar_channels WHERE expiration > EXTRACT(EPOCH FROM NOW()) * 1000;
   ```
   - 만료되었다면 `setup-watches` 다시 실행

2. **Webhook URL 확인:**
   - 환경 변수 `WEBHOOK_URL`이 정확한지 확인
   - HTTPS 인증서 유효한지 확인

3. **Service Account 권한 확인:**
   - 5개 캘린더에 모두 공유되었는지 확인
   - 권한이 "일정 변경 권한"인지 확인

### Sync Token 만료

자동으로 처리되지만, 수동 리셋 필요 시:

```sql
UPDATE calendar_sync_state SET sync_token = NULL WHERE room_id = 'a';
```

그 다음 Webhook 호출 시 전체 동기화 후 새 토큰 생성됨.

---

## 📊 모니터링

### Netlify Analytics

- **Site overview**: 방문자 수, 페이지 뷰
- **Functions**: 호출 횟수, 에러율, 응답 시간

### Supabase Dashboard

- **Table Editor**: 데이터 직접 확인
- **SQL Editor**: 커스텀 쿼리 실행
- **Logs**: Realtime 연결 상태

---

## 🔐 보안

### 환경 변수 보안

- **절대로** GitHub에 커밋하지 말 것:
  - `GOOGLE_SERVICE_ACCOUNT_JSON`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Netlify 환경 변수로만 관리

### Service Account 권한

- 5개 캘린더에만 최소 권한 부여
- JSON 키 파일 안전하게 보관

---

**배포 완료! 🎉**

이제 Google Calendar에 예약을 추가하면 1초 이내에 사이트에 자동 반영됩니다.
