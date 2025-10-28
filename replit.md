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
- SFTP deployment to rhythmandjoy.cafe24.com
- Cafe24 hosting service (Korean web hosting provider)
- Credentials stored in .vscode/sftp.json for automated uploads

**Revenue Calculation Module**
- Standalone feature in google_month_settlement_amount/
- Fetches events from all calendars for a given month
- Calculates revenue based on time-based pricing rules
- Different rates for each room type and time slots