# Email-Free Reservation Detection Test

This is a proof-of-concept for detecting Naver Reservation and SpaceCloud bookings without reading Naver email.

It is intentionally separate from production:

- It does not write Cafe24 DB rows.
- It does not create `rhythmjoy_spacecloud_tasks`.
- It does not send SMS or Telegram messages.
- It does not change Naver or SpaceCloud availability.
- It writes only local JSON snapshots under `state/platform-detect-test/`.

## Why This Exists

For a packaged service, asking customers for a Naver mail password is weak. The better operating model is:

1. Customer grants or logs in to the booking platform in a dedicated browser profile.
2. The detector reads booking pages or logged-in network responses.
3. DB comparison detects new, canceled, or changed reservations.
4. Production sync can later create the opposite-platform blocking task.

This file covers only step 2 and the local comparison proof.

## Commands

Open a normal Chrome test profile with a local debugging port. Do not use a
Playwright-launched login browser for Naver login testing; the user logs in
manually in normal Chrome, and the detector attaches after login.

```bash
open -na "Google Chrome" --args \
  --user-data-dir="$PWD/state/platform-detect-test/email-free-auth-profile" \
  --remote-debugging-port=9223 \
  --no-first-run \
  --no-default-browser-check
```

Open the old network-capture login pages in the test profile:

```bash
node tools/reservation-detect-test.mjs login --platform both --keep-open
```

Run one read-only scan:

```bash
node tools/reservation-detect-test.mjs scan --platform both --from 2026-07-14 --days 7
```

Run three 60-second cycles:

```bash
node tools/reservation-detect-test.mjs watch --platform both --interval-seconds 60 --cycles 3
```

Run parser self-checks without opening a browser:

```bash
node tools/reservation-detect-test.mjs self-test
```

Run the visible UI feed scanner against the already-open logged-in Chrome:

```bash
node tools/visible-reservation-feed-test.mjs scan \
  --cdp-url http://127.0.0.1:9223 \
  --platform both \
  --limit 10
```

Run two 60-second visible UI cycles:

```bash
node tools/visible-reservation-feed-test.mjs watch \
  --cdp-url http://127.0.0.1:9223 \
  --platform both \
  --limit 8 \
  --interval-seconds 60 \
  --cycles 2
```

Run the same visible UI feed scanner by briefly opening a saved customer profile
and closing it after each scan:

```bash
node tools/visible-reservation-feed-test.mjs scan \
  --profile-dir state/platform-detect-test/email-free-auth-profile \
  --platform both \
  --limit 10
```

Use this mode for cost testing. It avoids keeping one browser permanently open
per customer while still using a customer-authorized browser session.

If the local repo has no `playwright` install, use the bundled Codex runtime:

```bash
NODE_PATH=/Users/inteyeo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node tools/reservation-detect-test.mjs scan --platform both --from 2026-07-14 --days 7
```

## Output

The old network-capture scanner writes:

```text
state/platform-detect-test/snapshots/<timestamp>.json
state/platform-detect-test/latest.json
```

The visible UI feed scanner writes:

```text
state/platform-detect-test/visible-feed/snapshots/<timestamp>.json
state/platform-detect-test/visible-feed/latest.json
```

The snapshot contains:

- captured network responses that look booking-related
- extracted JSON reservation candidates
- visible DOM reservation-like blocks
- deduplicated reservation identities
- diff versus the previous local snapshot

## Test Criteria

This PoC is good enough to replace email as the primary detector only if:

1. Naver scan exposes reservation number, status, product/room, date, time, reserver name, and phone or detail link.
2. Naver cancellation or status change is visible in the scan within the target delay.
3. SpaceCloud scan exposes status, room, date, time, and reserver identity.
4. SpaceCloud cancellation disappears or changes status in a way the diff can detect.
5. Repeated scans produce stable identities with low duplicate noise.

If any platform misses cancellation state, keep email forwarding/parsing as a backup channel.

## Current Verification

Checked locally on 2026-07-14:

- `node --check tools/reservation-detect-test.mjs`
- `node tools/reservation-detect-test.mjs self-test`
- Naver read-only scan while logged out: correctly reports `loginRequired` and `0` reservation candidates.
- SpaceCloud read-only scan while logged out: correctly reports `loginRequired` and `0` reservation candidates.
- `node --check tools/visible-reservation-feed-test.mjs`
- Visible UI scan against an already logged-in normal Chrome CDP profile:
  - `naver_applications:10`
  - `naver_cancellations:10`
  - `spacecloud_confirmed:10`
  - `spacecloud_canceled:10`
- Visible UI watch test with 60-second interval and two cycles:
  - cycle 1: `naver_applications:8 naver_cancellations:8 spacecloud_confirmed:8 spacecloud_canceled:8`
  - cycle 2: `naver_applications:8 naver_cancellations:8 spacecloud_confirmed:8 spacecloud_canceled:8`

## Visible UI Feed Findings

This route is the preferred email-free product candidate because it uses pages
the operator can see after logging in. It does not call hidden platform APIs.

Naver SmartPlace:

- Reservation list URL:
  `https://partner.booking.naver.com/bizes/1257912/booking-list-view`
- New/confirmed candidate feed:
  - set `dateFilter=REGDATE`
  - use a recent application-date range
  - sort by `신청일시`
- Cancellation feed:
  - do not use `countFilter=CANCELLED`; in testing that returned `0` rows on
    the list page even though canceled rows existed.
  - read both future use-date rows and recent application-date rows.
  - sort each page by `취소일시`.
  - keep only rows whose visible status is `취소`.
- The SmartPlace main dashboard has useful shortcuts for `오늘 확정`,
  `오늘 이용`, and `오늘 취소`, but it is not enough for all future
  synchronization because it is scoped to today.

SpaceCloud:

- Reservation list URL:
  `https://partner.spacecloud.kr/reservation`
- Native visible status filters:
  - `RSCMP`: reservation confirmed
  - `RCCMP`: canceled/refunded
- Confirmed reservations expose reservation number, room, use date/time, masked
  reserver identity, and phone on the list.
- Canceled/refunded rows expose reservation number, room, use date/time, and
  identity on the list. Detail pages expose cancellation date/time.

## Product Caveats

- A 60-second reload/read cycle is required. Without refreshing or reopening
  the list pages, new events will not reliably appear.
- The detector should store the last seen reservation ids in DB and create work
  only for new or changed ids.
- SpaceCloud canceled list is not proven to sort by cancellation time from the
  visible list. For production, combine the `RCCMP` list with an active
  reservation status audit for previously seen SpaceCloud reservation numbers.
- If a page becomes blank, redirects to login, or shows repeated platform
  errors, stop the cycle and send a Telegram login-needed alert instead of
  retrying aggressively.
- Current Cafe24 VPS is not a safe browser runner: it has about 1GB RAM and only
  about 205MB available while DB, Apache, Node, email import, and calendar cache
  are active. Keep browser UI work on the Ubuntu mini PC or a larger VPS.
