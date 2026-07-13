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

Open the login pages in the test profile:

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

If the local repo has no `playwright` install, use the bundled Codex runtime:

```bash
NODE_PATH=/Users/inteyeo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node tools/reservation-detect-test.mjs scan --platform both --from 2026-07-14 --days 7
```

## Output

Each scan writes:

```text
state/platform-detect-test/snapshots/<timestamp>.json
state/platform-detect-test/latest.json
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

The next required test is manual login in the test profile, then `scan` over a date range that contains known Naver and SpaceCloud reservations/cancellations.
