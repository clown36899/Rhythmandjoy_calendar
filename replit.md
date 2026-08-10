# Overview

This is a room booking calendar application for "Rhythmjoy" (리듬앤조이), a Korean music practice room facility. The application displays availability for multiple practice rooms (A, B, C, D, E halls) from the DB-backed public schedule cache. Users can view room schedules, check availability, and access booking information through a mobile-friendly web interface.

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
  - DB-ledger event identity and room mapping
  - Color coding for visual distinction
  - Pricing structure (before/after 4 PM, early morning rates)
- Dynamic room filtering via checkboxes allowing users to show/hide specific rooms
- State persistence across calendar navigation (month/week view switches)

## External Dependencies

**Public Schedule Cache**
- Cafe24 builds one JSON cache from the DB booking ledger and administrator reservations.
- The public site reads this cache and does not call an external calendar API.

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
- This repository deploys only `리듬앤조이일정표.com` (`xn--xy1b23ggrmm5bfb82ees967e.com`) to the Cafe24 VPS `clown313python.cafe24.com` / `1.234.23.64`.
- Canonical non-secret deployment settings live in `ops/cafe24-production-target.env`; secrets stay out of Git.
- Server web root is `/home/clown313python/myapp`; ops files live under `/home/clown313python/rhythmjoy_ops`.
- Do not use `rhythmandjoy.cafe24.com` as the VPS target because it currently resolves to `210.114.6.137`.
- The shared VPS also hosts a separate `swingenjoy.com` project. This repo must not touch `/opt/swingenjoy`, `swingenjoy.service`, `127.0.0.1:3001`, or `swingenjoy-*.conf`.

**Revenue Calculation Module**
- Integrated into `/sync-admin/` and backed by DB ledger events
- Aggregates DB events for the selected month
- Calculates revenue based on time-based pricing rules
- Different rates for each room type and time slots
