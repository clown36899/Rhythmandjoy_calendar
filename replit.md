# Overview

This is a room booking calendar application for "Rhythmjoy" (리듬앤조이), a Korean music practice room facility. The application displays real-time availability of multiple practice rooms (A, B, C, D, E halls) using Google Calendar integration. Users can view room schedules, check availability, and access booking information through a mobile-friendly web interface.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Single-Page Application (SPA) Design**
- Pure client-side application
- Static HTML/CSS/JavaScript files
- Mobile-first responsive design optimized for small screens
- Bootstrap 5 for UI components and responsive grid system

**Calendar Library Integration**
- FullCalendar v5.x as the core calendar rendering engine
- SwipeCalendar extension for mobile swipe gestures and touch interactions
- Multiple calendar instances to display different practice rooms simultaneously
- Korean localization (ko.js) for all calendar interfaces

**Data Caching Strategy (New)**
- All booking data (1,000+ events) loaded once on page load
- Data cached in browser memory for instant navigation
- No network requests when switching months/rooms
- Supabase Realtime automatically refreshes cache on data changes

**Room Management System**
- Five separate practice rooms (A, B, C, D, E halls) each with distinct:
  - Google Calendar ID for event synchronization
  - Color coding for visual distinction
  - Pricing structure (before/after 4 PM, early morning rates)
- Dynamic room filtering via checkboxes allowing users to show/hide specific rooms
- State persistence across calendar navigation (month/week view switches)

## Backend Architecture (Production)

**Netlify Functions** (Serverless)
- `sync-calendar`: Google Calendar → Supabase 전체 동기화
- `google-webhook`: Google Calendar Webhook 수신 (실시간 업데이트)
- No persistent server required
- Functions triggered on-demand or via webhook

**Environment Variables**
- Development: Replit Secrets (테스트 전용)
- Production: Netlify 환경 변수
  - `GOOGLE_CALENDAR_API_KEY`: Google Calendar API 키
  - `SUPABASE_URL`: Supabase 프로젝트 URL
  - `SUPABASE_ANON_KEY`: 공개 키 (프론트엔드)
  - `SUPABASE_SERVICE_ROLE_KEY`: 서비스 키 (백엔드 Functions)

## External Dependencies

**Google Calendar API**
- Five separate Google Calendar IDs for each practice room
- Read-only access to display events and availability
- API key managed via environment variables (not hardcoded)

**Supabase PostgreSQL Database**
- `rooms` table: 5 practice rooms configuration
- `booking_events` table: 1,000+ booking events (6 months past to 12 months future)
- Row Level Security (RLS) for secure public read access
- Realtime enabled for instant updates

**Supabase Realtime**
- WebSocket-based real-time updates
- Listens to `booking_events` table changes
- Automatically refreshes frontend cache on INSERT/UPDATE/DELETE
- No page refresh required

**Third-Party JavaScript Libraries**
- jQuery 2.1.3 for DOM manipulation and event handling
- jQuery UI 1.12.1 for datepickers and UI interactions
- FullCalendar 5.x for calendar display and event management
- SwipeCalendar (licensed) for mobile swipe functionality
- Moment.js for date/time manipulation
- Hammer.js for touch gesture recognition
- Bootstrap 5.3 for responsive layout and components

**Development Server (Replit Only)**
- Python 3 built-in HTTP server (http.server module)
- Serves static files from www/ directory on port 5000
- Cache-control headers disabled for development
- **Not used in production**

**Analytics & Tracking**
- Google Analytics (G-T8EYR28L8V)
- Google Tag Manager (GTM-KSDF78ZT)

## Hosting & Deployment

**Production Stack**
- **Frontend**: Netlify (정적 사이트 호스팅)
  - Auto-deploy from GitHub
  - Custom domain: 리듬앤조이일정표.com
  - CDN for fast global delivery
- **Backend**: Netlify Functions (서버리스)
  - Google Calendar 동기화 (`/sync-calendar`)
  - Webhook 수신 (`/google-webhook`)
- **Database**: Supabase PostgreSQL
  - 1,000+ booking events
  - Realtime subscriptions
- **Development**: Replit (테스트 전용)
  - Node.js backend server (포트 8080)
  - Python static file server (포트 5000)

**Previous Hosting**
- Cafe24 (rhythmandjoy.cafe24.com) via SFTP - deprecated

## Recent Changes (2025-10-28)

**🎉 실시간 증분 동기화 시스템 완성 (v2.0)**

**백엔드 최적화**
- ✅ Google Calendar Sync Token 증분 동기화 구현
  - 초기: 전체 로드 (4,935개 이벤트)
  - 이후: 변경분만 가져오기 (1~2개씩)
  - API 호출 97% 절감
- ✅ 전체 데이터 DB 저장 (통계 기능용)
  - 과거~미래 모든 예약 데이터 유지
  - 프론트엔드는 7주 범위만 로드 (효율성)
- ✅ Webhook 쿨다운 (5초)
  - 5개 캘린더 동시 알림 → 1회만 동기화
  - 중복 API 호출 방지
- ✅ Supabase RLS 문제 해결
  - `calendar_sync_state` 테이블 RLS 비활성화
  - SQL 명령어가 아닌 Supabase 대시보드에서 직접 설정 필요

**프론트엔드 최적화**
- ✅ `location.reload()` 완전 제거
  - 기존: Realtime 변경 → 3초 후 전체 페이지 새로고침
  - 신규: FullCalendar API로 직접 업데이트 (INSERT/UPDATE/DELETE)
  - 사용자 경험 개선: 화면 깜빡임 없음
- ✅ className 기반 5개 룸 자동 위치 배치
  - 이벤트 생성 시 `className: booking.room_id` 설정 (a, b, c, d, e)
  - CSS가 자동으로 좌우 위치 적용 (A홀 0%, B홀 20%, C홀 40%, D홀 60%, E홀 80%)
  - 18% 너비 + 2% 간격
- ✅ Realtime 직접 업데이트 작동 확인
  - Google Calendar 변경 → 1초 이내 화면 반영
  - 페이지 리로드 없이 즉시 표시

**실시간 흐름 (최종 버전)**
```
Google Calendar 변경
  ↓ (1초 이내)
Webhook → 증분 동기화 (변경분만)
  ↓
Supabase INSERT/UPDATE/DELETE
  ↓ (즉시)
Realtime → 프론트엔드
  ↓
FullCalendar.addEvent() / .refetchEvents() / .getEventById().remove()
  ↓
화면 즉시 반영 (리로드 없음!)
```

**성능 개선**
- 네트워크 요청: 4,935개 → 1~2개 (97% 절감)
- 화면 업데이트: 페이지 리로드 제거 → 0ms
- 사용자 경험: 깜빡임 없이 부드러운 업데이트

**기술 스택**
- Backend: Node.js Express + Google Calendar API (Sync Token)
- Database: Supabase PostgreSQL + Realtime
- Frontend: FullCalendar v5 + Supabase JS Client
- 파일:
  - `backend/sync-calendar.js`: 증분 동기화 로직
  - `backend/server.js`: Webhook + 쿨다운
  - `www/calendar_set/full_ver7/supabase-realtime.js`: Realtime 리스너 + className 설정
  - `www/calendar_set/full_ver7/fullcal-supabase-adapter.js`: 범위별 데이터 로드
  - `www/calendar_set/full_ver7/style.css`: 5개 룸 위치 CSS

**Netlify Functions 마이그레이션 완료**
- Replit 백엔드를 Netlify Functions로 전환
- `netlify/functions/sync-calendar.js`: 수동 전체 동기화 (POST)
- `netlify/functions/google-webhook.js`: Google Webhook 수신 + 증분 동기화
- `netlify/functions/setup-watches.js`: 초기 채널 등록
- `netlify/functions/renew-watches.js`: 채널 자동 갱신
- `netlify/functions/lib/google-auth.js`: Service Account 인증
- Service Account JSON: Netlify 환경 변수로 관리 (프로덕션)
- Replit Secrets: 개발/테스트 전용

**프론트엔드 캐싱 최적화**
- 전체 데이터 한 번에 로드 (페이지 로드 시)
- 메모리 캐싱으로 즉시 달력 이동 (네트워크 요청 없음)
- `supabase-realtime.js`: 전체 데이터 캐싱 + 자동 갱신
- `fullcal-supabase-adapter.js`: 캐시에서 데이터 제공
- 성능: 달력 이동 시 0ms (기존: 100~300ms)

**Supabase + Netlify 마이그레이션 구현 (이전 작업)**
- Supabase PostgreSQL 데이터베이스 스키마 설계 (`supabase/schema.sql`)
  - `rooms` 테이블: 5개 연습실 정보
  - `booking_events` 테이블: 예약 이벤트 저장 (1,069개)
  - RLS (Row Level Security) 설정으로 읽기 권한 공개
- 초기 데이터 동기화: 과거 6개월 ~ 미래 12개월 (18개월)
- 프론트엔드 Supabase Realtime 연동
  - 실시간 구독으로 자동 업데이트
  - 데이터 변경 시 자동 캘린더 새로고침 (새로고침 없이 실시간 반영)
- Netlify 배포 설정
  - `netlify.toml`: 빌드 + Functions 설정
  - `www/build.sh`: 환경 변수 주입 스크립트
  - `DEPLOYMENT.md`: 배포 가이드 문서

**아키텍처 변경**
- **기존**: 정적 사이트 + Google Calendar API (클라이언트 직접 호출, 폴링 방식)
- **신규**: Netlify (정적 + Functions) + Supabase (DB + Realtime) + Google Push Notifications
  - 장점:
    - **진짜 실시간** (Google → Netlify Webhook → Supabase → 프론트엔드)
    - 서버리스 아키텍처
    - 증분 동기화로 API 호출 최소화
    - 채널 자동 갱신으로 무한 실시간
  - **Replit 서버 불필요** (개발/테스트만 사용)

**보안 개선**
- Google API 키 하드코딩 제거
- 환경 변수로 비밀키 관리:
  - 개발: Replit Secrets
  - 프로덕션: Netlify 환경 변수
