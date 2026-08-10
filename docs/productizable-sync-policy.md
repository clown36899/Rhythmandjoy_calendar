# Productizable Reservation Sync Policy

Last reviewed: 2026-07-14 KST

This document defines what can be used for a sellable reservation-sync service.
It is intentionally conservative: if a method depends on hidden endpoints, broad
scraping, or unclear platform permission, it must stay out of production.

## Non-Negotiable Product Constraints

These are hard constraints for this project:

1. Naver Reservation and SpaceCloud are mandatory channels. The product exists
   only to synchronize these two services and prevent double bookings.
2. Assume there is no official Naver/SpaceCloud booking sync API available to
   this project. Do not design around future official API access unless a real
   written partner/API agreement exists.
3. The sellable product must use techniques that can be explained to a customer
   as operator-authorized automation. It must not depend on bypassing login,
   CAPTCHA, access controls, or rate limits.
4. Automation must run at a human-scale cadence with backoff and alerts. Avoid
   behavior likely to be classified as bot abuse.
5. The product must be cost-competitive with SPACE UP-like direct competitors.
   A customer-per-dedicated-VPS architecture is not acceptable for the default
   plan because it cannot compete with low monthly pricing.
6. Extra features such as SMS, landing pages, AI reports, settlement tools, or
   custom reservation pages are secondary. They must never obscure or compromise
   the core Naver/SpaceCloud synchronization.

## Product Rule

Use only methods that can be explained to a customer and defended operationally:

1. The customer explicitly authorizes access.
2. The automation does not store the customer's platform password.
3. The automation does not bypass login, CAPTCHA, rate limits, or access controls.
4. The automation does not call undocumented platform endpoints as a standalone API client.
5. The automation runs at a low human-scale cadence and backs off on errors.
6. Personal data is stored only for booking operation, SMS sending, audit, and retry.

## Allowed Source Channels

### 1. Authorized Email Intake

This is the preferred sellable source of truth when official booking APIs are not
available.

The customer does not need to share a Naver password. Acceptable setups are:

- platform notification emails forwarded to a service mailbox;
- a dedicated receiving mailbox configured during onboarding;
- OAuth or app-password based mail access only when the mail provider supports it
  and the customer approves it.

The service records the email event first, then creates platform work tasks. This
matches the current Rhythmjoy production architecture.

### 2. Official Export Or Official API

Use official exports or APIs only when they are documented, enabled for the
customer account, and the usage terms allow the intended service.

Examples:

- iCal export may be used as a backup or audit source, but only if its delay is
  acceptable.
- If Naver or SpaceCloud provides an official partner API later, move detection
  to that API after reviewing its terms and quota.

### 3. Logged-In Browser RPA For Platform Actions

Browser automation is allowed for applying changes when the customer owns the
account and logs in manually:

- block or restore Naver SmartPlace availability through the visible host UI;
- add or delete SpaceCloud direct-added schedules through the visible host UI;
- verify the result from the visible host UI.

This must be implemented as low-rate RPA, not a high-frequency scraper.

### 4. Logged-In Visible UI Feed Reading

Browser-based detection is allowed only when it reads reservation list pages that
the logged-in operator can normally see.

Allowed examples:

- Naver SmartPlace reservation list sorted by application time or cancellation
  time.
- SpaceCloud reservation list filtered by visible status such as reservation
  confirmed or canceled/refunded.
- Reading only the first small page range every 60 seconds, with a DB ledger for
  deduplication.

The implementation must use a customer-authorized browser profile, must not
store platform passwords, and must stop with an alert if the platform asks for
login or extra verification.

## Not Allowed For A Sellable Product

The following are not product features:

- direct polling of undocumented Naver/SpaceCloud internal API endpoints;
- extracting access tokens from browser storage and using them as a backend API key;
- using hidden endpoints as if they were an official integration;
- bypassing platform login or second-factor requirements;
- running multiple watchers against one account;
- aggressive polling that creates unnecessary platform load.

These may be used only as temporary diagnostics during development, and must not
be enabled in a customer deployment.

## Detection Strategy For Product

Use the email ledger as the most reliable event source when the customer permits
email forwarding or a dedicated notification mailbox:

1. Receive Naver/SpaceCloud booking and cancellation emails.
2. Save the raw event and parsed fields in the DB.
3. Update the booking ledger without deleting historical rows.
4. Create a cross-platform work task.
5. Use browser RPA to apply the opposite-side block/add/delete/restore.
6. Write the verified platform result back to the DB task and audit log.
7. Send SMS only for confirmed reservations, never for cancellations.

If the customer refuses email forwarding and no official API is available, the
service may use logged-in visible UI feed reading only with these constraints:

1. The customer's browser runner stays logged in to Naver SmartPlace and
   SpaceCloud.
2. The detector reads only visible list pages at a human-scale interval.
3. The service stores seen reservation ids and statuses in DB before creating
   cross-platform work.
4. Naver cancellations are read from both future use-date rows and recent
   application-date rows, sorted by cancellation time.
5. SpaceCloud cancellations require an extra audit path for previously seen
   active reservation numbers, because the visible canceled list is not proven
   to be cancellation-time sorted.
6. If a session expires, the service alerts the operator and leaves work pending
   instead of attempting login.

This is sellable as operator-authorized UI synchronization, not as an official
platform API integration.

## Cost-Competitive Architecture Rule

The default commercial architecture must minimize always-on browser cost:

1. Prefer email/notification intake or visible list-feed detection for event
   discovery.
2. Do not keep one full browser permanently active per customer unless the plan
   price explicitly pays for that dedicated runner.
3. Prefer short-lived browser action sessions: start or attach to a customer
   profile only when work exists, apply/verify the platform change, then release
   resources.
4. Use shared runners only with strict customer profile isolation and per-account
   rate limits.
5. Keep dedicated VPS/runner as a premium plan, not the default.

If a design cannot plausibly fit a 29,000 to 39,000 KRW/month entry-level price,
it is not competitive with SPACE UP-like services and should be treated as an
internal/managed premium design only.

## Monitoring Cadence

Recommended production cadence:

- email intake: 30 to 60 seconds;
- visible UI detection: 60 seconds, one small page per feed;
- browser worker: 30 to 60 seconds with small task limits;
- platform verification: only after a task action, not continuous scraping;
- backoff: increase interval and alert by Telegram after repeated login, network,
  or platform errors.

Current Cafe24 VPS is not the correct browser runner for this model. It is a
1GB-class server already running DB, Apache, Node, email import, and calendar
cache. Browser UI detection should run on the Ubuntu mini PC or on a larger VPS
with Chrome, Node, Xvfb, and enough memory.

## Sales Positioning

Describe the service as:

> Operator-authorized reservation synchronization using booking notification
> intake or visible booking-list reading plus logged-in browser operations.

Do not describe it as an official Naver or SpaceCloud API integration unless a
written partner/API arrangement exists.
