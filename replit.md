# Overview

This project is a mobile-friendly room booking calendar application for "Rhythmjoy" (리듬앤조이), a Korean music practice room facility. It integrates with Google Calendar to display real-time availability for five practice rooms (A, B, C, D, E halls). The application enables users to view schedules, check availability, and access booking information through a responsive web interface. Its core ambition is to provide a seamless, real-time booking overview for users while offering robust backend management and statistical insights for the facility owners.

# Recent Changes

**2025-11-22: System Cleanup & Optimization**
- ✅ **Removed unnecessary backend functions**: Deleted sync-calendar.js, setup-watches.js (no longer needed)
- ✅ **Removed unnecessary Netlify functions**: Deleted sync-calendar.mjs, setup-watches.mjs, renew-watches.mjs (DB-free architecture)
- ✅ **Removed sync/watch endpoints**: POST /api/sync, /api/sync-incremental, /api/setup-watches (not used)
- **Confirmed**: Webhook (google-webhook.mjs) replaces Watch mechanism - receives real-time signals from Google Calendar → broadcasts to Frontend via Supabase Realtime
- **3-week priority loading**: Initial render loads current week ±1 week for instant swipe response
- **Background loading**: Remaining 4 weeks load in background (no UI blocking)

**2025-11-22: Architecture Redesign - On-Demand Google Calendar Loading**
- Removed dependency on full database sync - now loads only visible weeks from Google Calendar
- New API endpoint `get-week-events.mjs` - queries Google Calendar directly for specific date ranges
- Webhook simplified - sends signal via Realtime broadcast (no DB needed)
- Frontend receives Webhook signal instantly via Realtime → refreshes current view without page reload
- Navigation (week/month changes) automatically fetches fresh data from Google Calendar
- **No database needed for calendar display** - only Webhook → Realtime broadcast → Frontend
- Result: Ultra-simplified architecture, no 500 errors, real-time updates

**2025-11-20: File-based Logging System**
- Implemented localStorage-based logging system (`js/logger.js`)
- Disabled console output for all debug logs to reduce browser load
- Only ERROR, WARN, INFO logs are recorded to localStorage
- Console logs can be viewed with `viewLogs()`, downloaded with `downloadLogs()`, or cleared with `clearLogs()`
- Maximum 1,000 log entries retained automatically
- Room label swipe synchronization fixed - labels now move with parent slides automatically

**2025-11-14: Mobile Reservation Info Page Separation**
- Created independent `info.html` page for reservation information (separate from calendar offcanvas)
- Added top header with back-to-calendar and home buttons
- Implemented deep linking with URL encoding/decoding (info.html?section=xxx)
- Added DOMContentLoaded event for automatic deep link processing
- Updated share URLs from calendar_7.html?section=xxx to info.html?section=xxx
- Added "📱 예약정보" link in calendar_7.html offcanvas menu

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
- `POST /api/admin/login`: Admin authentication
- `POST /api/logs`: Log storage API
- `GET /api/logs`: Log retrieval API (auth required)
- `POST /api/reset-sync`: Clear all event data (admin only, for testing)
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
- cleanup-watches.mjs: Not needed

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
- **Admin Dashboard**: Login-protected dashboard provides revenue statistics, visualized with Chart.js

# External Dependencies

- **Google Calendar API**: Utilized for five distinct practice room calendars, read-only access for event/availability display
- **Supabase**:
    - **PostgreSQL Database**: Stores room configurations (`rooms`) and admin revenue statistics (not calendar events)
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
- Next steps: Git push → GitHub → Netlify auto-deploy
- Required: Set Netlify environment variables (GOOGLE_CALENDAR_API_KEY, etc.)
