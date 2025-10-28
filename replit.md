# Overview

This is a room booking calendar application for "Rhythmjoy" (리듬앤조이), a Korean music practice room facility. The application displays real-time availability of multiple practice rooms (A, B, C, D, E halls) using Google Calendar integration. Users can view room schedules, check availability, and access booking information through a mobile-friendly web interface.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Single-Page Application (SPA) Design**
- Pure client-side application with no backend server logic
- Static HTML/CSS/JavaScript files served via simple Python HTTP server
- Mobile-first responsive design optimized for small screens
- Bootstrap 5 for UI components and responsive grid system

**Calendar Library Integration**
- FullCalendar v5.x as the core calendar rendering engine
- SwipeCalendar extension for mobile swipe gestures and touch interactions
- Multiple calendar instances to display different practice rooms simultaneously
- Korean localization (ko.js) for all calendar interfaces

**Room Management System**
- Five separate practice rooms (A, B, C, D, E halls) each with distinct:
  - Google Calendar ID for event synchronization
  - Color coding for visual distinction
  - Pricing structure (before/after 4 PM, early morning rates)
- Dynamic room filtering via checkboxes allowing users to show/hide specific rooms
- State persistence across calendar navigation (month/week view switches)

## External Dependencies

**Google Calendar API**
- API Key: AIzaSyCLqM39X5vTjrNt1Vl5miRryXWkLYPqky8
- Five separate Google Calendar IDs for each practice room
- Read-only access to display events and availability
- No write operations - calendars managed externally

**Third-Party JavaScript Libraries**
- jQuery 2.1.3 for DOM manipulation and event handling
- jQuery UI 1.12.1 for datepickers and UI interactions
- FullCalendar 5.x for calendar display and event management
- SwipeCalendar (licensed) for mobile swipe functionality
- Moment.js for date/time manipulation
- Hammer.js for touch gesture recognition
- Bootstrap 5.3 for responsive layout and components

**Development Server**
- Python 3 built-in HTTP server (http.server module)
- Serves static files from www/ directory on port 5000
- Cache-control headers disabled for development
- No database or server-side processing

**Analytics & Tracking**
- Google Analytics (G-T8EYR28L8V)
- Google Tag Manager (GTM-KSDF78ZT)

**Hosting & Deployment**
- **현재 호스팅**: Cafe24 (rhythmandjoy.cafe24.com) via SFTP
- **마이그레이션 계획**: Netlify + Supabase
  - Frontend: Netlify (정적 사이트 호스팅)
  - Database: Supabase PostgreSQL
  - Realtime: Supabase Realtime (WebSocket)
  - Backend: Replit (Google Calendar 동기화 서버, 포트 8080)

**Revenue Calculation Module**
- Standalone feature in google_month_settlement_amount/
- Fetches events from all calendars for a given month
- Calculates revenue based on time-based pricing rules
- Different rates for each room type and time slots

## Recent Changes (2025-10-28)

**Supabase + Netlify 마이그레이션 구현**
- Supabase PostgreSQL 데이터베이스 스키마 설계 (`supabase/schema.sql`)
  - `rooms` 테이블: 5개 연습실 정보
  - `booking_events` 테이블: 예약 이벤트 저장
  - RLS (Row Level Security) 설정으로 읽기 권한 공개
- Node.js 백엔드 서버 구축 (`backend/server.js`, 포트 8080)
  - Google Calendar Webhook 수신 엔드포인트
  - Supabase 연동 API
- 초기 데이터 동기화 스크립트 (`backend/sync-calendar.js`)
  - Google Calendar API → Supabase 데이터 이관
- 프론트엔드 Supabase Realtime 연동
  - `supabase-realtime.js`: Supabase 클라이언트 및 실시간 구독
  - `fullcal-supabase-adapter.js`: FullCalendar 어댑터 (Google Calendar → Supabase)
  - 데이터 변경 시 자동 캘린더 새로고침 (새로고침 없이 실시간 반영)
- Netlify 배포 설정
  - `netlify.toml`: 빌드 설정
  - `www/build.sh`: 환경 변수 주입 스크립트
  - `DEPLOYMENT.md`: 배포 가이드 문서

**아키텍처 변경**
- 기존: 정적 사이트 + Google Calendar API (클라이언트 직접 호출)
- 신규: Netlify (정적) + Supabase (DB + Realtime) + Replit 백엔드 (동기화)
  - 장점: 실시간 업데이트, 데이터베이스 기반 확장성, 오프라인 대응 가능