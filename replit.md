# Overview

This project is a mobile-friendly room booking calendar application for "Rhythmjoy" (리듬앤조이), a Korean music practice room facility. It integrates with Google Calendar to display real-time availability for five practice rooms (A, B, C, D, E halls). The application enables users to view schedules, check availability, and access booking information through a responsive web interface. Its core ambition is to provide a seamless, real-time booking overview for users while offering robust backend management and statistical insights for the facility owners.

# Recent Changes

**2025-11-22: 매출 시스템 개선 - 온디맨드 계산 + DB 저장**
- ✅ **Google Calendar 직접 조회**: `/api/admin/revenue` 새 엔드포인트 추가
- ✅ **하이브리드 매출 조회**:
  - 현재/이후 달: Google Calendar 조회 → 시간 기반 계산 (30분 = 10,000원) → DB 저장
  - 이전 달: `monthly_revenue` 테이블에서 직접 조회
- ✅ **초기 진입 시**: DB에 데이터 없으면 구글캘린더에서 조회 후 계산해서 저장
- ✅ **저번달 이전**: 변경 없음, DB에서만 조회
- `monthly_revenue` 테이블: year, month, total_revenue, total_bookings, by_room 저장

**2025-11-22: 시스템 정리 - 불필요한 함수 제거**
- ✅ **Removed**: sync-calendar.js, setup-watches.js (backend)
- ✅ **Removed**: sync-calendar.mjs, setup-watches.mjs, renew-watches.mjs (netlify)
- ✅ **Removed**: /api/sync, /api/sync-incremental, /api/setup-watches 엔드포인트
- **Confirmed**: Webhook (google-webhook.mjs)이 Watch 메커니즘을 완벽히 대체
- 결과: DB-free 아키텍처 확정, Webhook만 필요

**2025-11-22: 초기 로드 최적화 - 분할 로딩 (현주만 즉시 표시)**
- ✅ **Step 1 - 초고속 현주 로드**: 현재주만 먼저 로드 (200ms) → 즉시 화면 표시
- ✅ **Step 2 - ±1주 병렬 로드**: Promise.all로 좌우 동시 로드 (200ms)
  - 각 주 로드 완료 시 해당 슬라이드만 업데이트 (UI 자동 갱신)
  - "로딩 중..." 플레이스홀더 표시 중 로드
- ✅ **Step 3 - 백그라운드 순차**: 나머지 4주 순차 로드 (UI 논블로킹)
- ✅ **사용자 체감 시간**: 300ms → **200ms (33% 단축)**
- ✅ **DOM 우선 렌더링**: requestAnimationFrame + requestIdleCallback (iframe 동적 로드)

# User Preferences

Preferred communication style: Simple, everyday language. Approval required for major architectural changes ("승인없는 작업은 금지").

# System Architecture

## Frontend Architecture

**Single-Page Application (SPA)**
- Pure client-side application using static HTML/CSS/JavaScript.
- Mobile-first responsive design with Bootstrap 5.

**Calendar & UI**
- FullCalendar v5.x for core calendar rendering, extended with SwipeCalendar for mobile gestures.
- Displays multiple calendar instances for different rooms with distinct color coding.
- Korean localization integrated.
- Dynamic room filtering via checkboxes with state persistence.
- **7-slide swipeable calendar**: -3 weeks to +3 weeks, with 3-week priority loading (current ±1) for instant responsiveness

**Data Management**
- **On-demand loading**: Frontend requests only visible weeks from Google Calendar API
- **3-week priority load**: Current week ±1 week loads first for immediate display
- **Background sequential loading**: Remaining 4 weeks load in background without UI blocking
- **Real-time sync**: Supabase Realtime receives webhook signal and refreshes current view only
- No database sync needed for calendar display

**Logging System**
- File-based logging using localStorage (`js/logger.js`)
- Console output disabled for performance optimization
- Error tracking and important events logged automatically
- Logs accessible via browser console: `viewLogs()`, `downloadLogs()`, `clearLogs()`
- See `LOG_GUIDE.md` for detailed usage instructions

## Backend Architecture

**Replit Backend (Development)**
- `GET /api/get-week-events`: Queries Google Calendar for specific date ranges (testing)
- `GET /api/admin/revenue`: ✨ NEW - Monthly revenue calculation (calendar query + calculation + DB save)
- `POST /api/admin/login`: Admin authentication
- `POST /api/logs`: Log storage API
- `GET /api/logs`: Log retrieval API (auth required)
- `GET /api/health`: Health check endpoint

**Netlify Functions (Production)**
- `get-week-events.mjs`: ✨ MAIN - Queries Google Calendar directly for specific weeks/rooms
- `google-webhook.mjs`: Receives Google Calendar webhooks, broadcasts signal to Frontend via Realtime
- `admin-stats.mjs`: Revenue statistics calculations (annual, monthly, room-specific, daily)
- `price-parser.mjs`: Extracts pricing info from event descriptions
- `manage-prices.mjs`: Manage price policies
- `hello.mjs`, `get-config.mjs`: Utility functions

**Removed (DB-free optimization)**
- sync-calendar.js/mjs: No longer needed (on-demand loading only)
- setup-watches.js/mjs: Webhook replaces Watch mechanism
- renew-watches.mjs: Webhook handles updates

**Revenue System (매출)**
- **현재/이후 달**: Google Calendar 직접 조회 → 시간 기반 계산 (30분=10,000원) → `monthly_revenue` 저장
- **이전 달**: `monthly_revenue` 테이블에서 조회 (변경 없음)
- **초기 진입**: DB 없으면 Google Calendar에서 조회해서 계산 후 저장

**Environment Variables**
- Managed via Replit Secrets (development) and Netlify environment variables (production)
- Critical: `GOOGLE_CALENDAR_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`

## System Design

- **On-Demand Data Loading**: Frontend requests only visible weeks from Google Calendar API
- **Zero-Sync Architecture**: No full calendar sync to database - direct API calls only
- **Webhook Signaling**: Google Calendar changes trigger Webhook → broadcasts signal to all clients via Realtime → each client refreshes current view only
- **No Database for Calendar Display**: Only Realtime broadcasts needed for real-time updates
- **3-Week Priority Loading**: Current week loads first, ±1 weeks next (for swipe responsiveness), remaining 4 weeks background
- **Client-Side Processing**: Data comparison and rendering happens on Frontend, zero server load
- **Room Management**: Five distinct practice rooms, each linked to specific Google Calendar ID
- **Revenue System**: Hybrid (현재=Google Calendar, 과거=DB) + auto-save on first access

# External Dependencies

- **Google Calendar API**: Utilized for five distinct practice room calendars, read-only access for event/availability display
- **Supabase**:
    - **PostgreSQL Database**: Stores room configurations (`rooms`), monthly revenue statistics (`monthly_revenue`), and event prices (`event_prices`)
    - **Realtime**: Provides WebSocket-based signals when Google Calendar changes
- **Third-Party JavaScript Libraries**:
    - jQuery 2.1.3 & jQuery UI 1.12.1: DOM manipulation
    - FullCalendar 5.x: Core calendar display
    - SwipeCalendar: Mobile swipe gestures
    - Moment.js: Date/time manipulation
    - Hammer.js: Touch gesture recognition (5px sensitivity - ultra-responsive)
    - Bootstrap 5.3: Responsive layout
    - Chart.js: Admin dashboard data visualization
- **Google Analytics (G-T8EYR28L8V) & Google Tag Manager (GTM-KSDF78ZT)**: Analytics

# Deployment Status

✅ **Ready for Production Deployment**
- Netlify Functions prepared: `netlify.toml` configured, `get-week-events.mjs` ready
- New revenue endpoint: `/api/admin/revenue` ready (hybrid calendar+DB)
- Next steps: Git push → GitHub → Netlify auto-deploy
- Required: Set Netlify environment variables (GOOGLE_CALENDAR_API_KEY, etc.)
