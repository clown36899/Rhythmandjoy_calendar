# Overview

This project is a mobile-friendly room booking calendar application for "Rhythmjoy" (리듬앤조이), a Korean music practice room facility. It integrates with Google Calendar to display real-time availability for five practice rooms (A, B, C, D, E halls). The application enables users to view schedules, check availability, and access booking information through a responsive web interface. Its core ambition is to provide a seamless, real-time booking overview for users while offering robust backend management and statistical insights for the facility owners.

# Recent Changes

**2025-11-22: Architecture Redesign - On-Demand Google Calendar Loading**
- Removed dependency on full database sync - now loads only visible weeks from Google Calendar
- New API endpoint `get-week-events.mjs` - queries Google Calendar directly for specific date ranges
- Webhook simplified - sends signal via Realtime broadcast (no DB needed)
- Frontend receives Webhook signal instantly via Realtime → refreshes current view without page reload
- Navigation (week/month changes) automatically fetches fresh data from Google Calendar
- **No database needed** - only Webhook → Realtime broadcast → Frontend
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

Preferred communication style: Simple, everyday language.

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

**Data Management**
- Data caching strategy loads all booking events (1,000+) once on page load and caches them in browser memory for instant navigation.
- Supabase Realtime automatically refreshes the cache upon data changes, eliminating network requests when navigating months/rooms.

**Logging System**
- File-based logging using localStorage (`js/logger.js`)
- Console output disabled for performance optimization
- Error tracking and important events logged automatically
- Logs accessible via browser console: `viewLogs()`, `downloadLogs()`, `clearLogs()`
- See `LOG_GUIDE.md` for detailed usage instructions

## Backend Architecture

**Serverless Functions (Netlify Functions)**
- `get-week-events`: ✨ NEW - Queries Google Calendar directly for specific weeks/rooms
- `google-webhook`: Receives Google Calendar webhooks, broadcasts signal to Frontend via Realtime
- `admin-stats`: API for various revenue statistics (annual, monthly, room-specific, daily, weekly, hourly).
- `price-parser`: Extracts pricing information from Google Calendar event descriptions.

**Environment Variables**
- Managed via Replit Secrets (development) and Netlify environment variables (production) for Google Calendar API Key, Supabase URLs, and admin credentials.

## System Design

- **On-Demand Data Loading**: Frontend requests only visible weeks from Google Calendar API → data compared with existing cache → only changes rendered
- **Webhook Signaling**: Google Calendar changes trigger Webhook → signal sent to all viewing clients via Realtime → each client refreshes only their current view
- **No Full Database Sync**: Eliminated unnecessary monthly ALL-event synchronization → replaced with targeted per-week API calls
- **Client-Side Processing**: Data comparison and patching happens on Frontend, reducing server load
- **Room Management**: Five distinct practice rooms, each linked to a specific Google Calendar ID
- **Admin Dashboard**: Login-protected dashboard provides detailed revenue statistics, visualized with Chart.js

# External Dependencies

- **Google Calendar API**: Utilized for five distinct practice room calendars, primarily for read-only access to display events and availability.
- **Supabase**:
    - **PostgreSQL Database**: Stores room configurations (`rooms`) and booking events (`booking_events`). Features Row Level Security (RLS) for secure public read access.
    - **Realtime**: Provides WebSocket-based real-time updates for `booking_events`, automatically refreshing frontend cache on data changes.
- **Third-Party JavaScript Libraries**:
    - jQuery 2.1.3 & jQuery UI 1.12.1: DOM manipulation and UI interactions.
    - FullCalendar 5.x: Core calendar display and event management.
    - SwipeCalendar: Mobile swipe gestures for calendar navigation.
    - Moment.js: Date/time manipulation.
    - Hammer.js: Touch gesture recognition.
    - Bootstrap 5.3: Responsive layout and UI components.
    - Chart.js: Used for data visualization in the admin dashboard.
- **Google Analytics (G-T8EYR28L8V) & Google Tag Manager (GTM-KSDF78ZT)**: For analytics and tracking.