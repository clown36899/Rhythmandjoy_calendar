# 로컬 개발 가이드

## 환경 변수 설정

### 로컬 개발 (Replit/localhost)

1. **env.js 파일 생성**:
   ```bash
   cd www/calendar_set/full_ver7
   cp env.example.js env.js
   ```

2. **env.js 수정** (실제 값 입력):
   ```javascript
   window.SUPABASE_URL = 'https://izcdhoozlvcmjcbnvwoe.supabase.co';
   window.SUPABASE_ANON_KEY = 'eyJhbGci...';
   window.GOOGLE_CALENDAR_API_KEY = 'AIzaSy...';
   window.ENV = { ADMIN_PASSWORD: 'your_password_here' };
   ```

3. **정적 서버 실행**:
   ```bash
   cd www
   python3 -m http.server 5000 --bind 0.0.0.0
   ```

4. **브라우저에서 테스트**:
   - 메인 달력: `http://localhost:5000/calendar_set/full_ver7/`
   - 관리자: `http://localhost:5000/calendar_set/full_ver7/admin.html`

---

### Netlify 배포

1. **Netlify 환경 변수 설정**:
   - Site settings → Environment variables에서 추가:
   ```
   ADMIN_PASSWORD=your_admin_password
   GOOGLE_CALENDAR_API_KEY=AIzaSy...
   SUPABASE_URL=https://izcdhoozlvcmjcbnvwoe.supabase.co
   SUPABASE_ANON_KEY=eyJhbGci...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
   ```

2. **배포 방법**:
   ```bash
   git push
   ```

3. **자동 작동**:
   - Netlify Functions가 환경 변수 제공
   - 브라우저에서 서버 API로 설정 로드
   - env.js 파일 불필요 (서버가 자동 제공)

---

## 환경별 동작 방식

### 로컬 개발 (Replit/localhost)
```
config-loader.js
  ├─ 1단계: 서버 API 시도 (실패)
  ├─ 2단계: env.js 로드 (성공) ✅
  └─ 3단계: Fallback (읽기 전용)
```

### Netlify 배포
```
config-loader.js
  ├─ 1단계: 서버 API 시도 (성공) ✅
  ├─ 2단계: env.js 로드 (건너뜀)
  └─ 3단계: Fallback (건너뜀)
```

---

## 보안 주의사항

⚠️ **env.js는 절대 Git에 커밋하지 마세요!**
- `.gitignore`에 이미 추가되어 있음
- 배포 시 Netlify Functions가 안전하게 제공

✅ **배포 환경**:
- 비밀번호는 서버에서만 검증
- 브라우저에 노출 안 됨

✅ **로컬 환경**:
- 개발 편의를 위해 env.js 사용
- 공개 저장소에 올리지 않도록 주의
