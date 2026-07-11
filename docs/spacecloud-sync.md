# SpaceCloud Sync

This is the first safe automation layer for uploading Rhythmjoy calendar events to SpaceCloud.

It does not store SpaceCloud login credentials. The tool only builds a dry-run plan and can optionally read SpaceCloud iCal export URLs for duplicate checks.

## Setup

Create a local config file:

```bash
cp config/spacecloud-sync.example.json config/spacecloud-sync.local.json
```

If you want iCal duplicate checks, open SpaceCloud Host, click `캘린더 내보내기` for each room, and paste each room's iCal URL into `config/spacecloud-sync.local.json`.

Do not commit `config/spacecloud-sync.local.json`. The iCal URL includes a private token.

## Dry Run

Check one room and one day:

```bash
node tools/spacecloud-sync.mjs plan --from 2026-07-09 --days 1 --rooms b
```

Check the coming week:

```bash
node tools/spacecloud-sync.mjs plan --days 7
```

Print JSON for automation:

```bash
node tools/spacecloud-sync.mjs plan --days 7 --json
```

## Current Manual Browser Upload Flow

This is the verified recovery path if we need to come back later.

1. User logs in to SpaceCloud Host manually.
2. Build a plan from the Rhythmjoy Google Calendar cache:

```bash
node tools/spacecloud-sync.mjs plan --from YYYY-MM-DD --to YYYY-MM-DD --rooms a,b,c,d,e --json > /tmp/spacecloud-plan.json
```

3. Upload only `plan.upload` events. Each upload row already includes:
   - `spacecloudCreatePayload` for API-mode registration.
   - `spacecloudUiInput` for UI-mode registration.
4. Select the room before opening the modal:
   - A: `space=66056`, `product=108673`
   - B: `space=66056`, `product=108674`
   - C: `space=66056`, `product=108675`
   - D: `space=66056`, `product=108989`
   - E: `space=66056`, `product=108676`
5. Click `예약추가`.
6. Fill modal fields:
   - `#start_day`
   - `#shour`
   - `#ehour`
   - `#reserve_name`
   - `#reserve_tel` stays blank when not available
   - `#reserve_memo`
7. Submit with `#_addExternalSchedule`.
8. Confirm the modal closes and the monthly calendar shows the `추HH~HH` item.
9. Mark successful rows:

```bash
node tools/spacecloud-sync.mjs mark-uploaded --fingerprint 'room|YYYY-MM-DD|HH:mm|HH:mm' --source-event-id '...' --reservation-no '...'
```

Known verified batches:

- `2026-07-05 <= date < 2026-07-10`: 42 submitted, 0 failed. A follow-up dry-run showed 0 remaining upload candidates.
- `2026-07-10 <= date < 2026-08-01`: 61 submitted, 0 final failures. A follow-up dry-run showed 0 remaining upload candidates. Immediate screen spot-check on D room showed newly added rows on the SpaceCloud calendar.
- `2026-08-01 <= date < 2026-12-23`: 126 submitted, 0 final failures. A follow-up dry-run showed 0 remaining upload candidates: 126 skipped by `already-uploaded-local-log:source-event-id`, 5 skipped by `reservation-number-missing-likely-spacecloud-origin`. Local uploaded log count after this batch: 230.

## Low-Resource Operating Mode

The login boundary is fixed: the user logs in manually, and this tool does not extract, print, store, or manage SpaceCloud/Naver credentials or tokens.

Use the program for deterministic work and keep AI/browser observation only for failures:

1. Build the upload plan:

```bash
node tools/spacecloud-sync.mjs plan --from YYYY-MM-DD --to YYYY-MM-DD --rooms a,b,c,d,e --json > /tmp/spacecloud-plan.json
```

2. Review only counts and skipped reasons.
3. Use `spacecloudUiInput` to drive the logged-in browser with fixed selectors and values.
4. Submit one event at a time, with no parallel requests.
5. Mark successful rows in the local log.
6. Re-run the same plan command. The expected final result is `upload.length === 0`.

This avoids repeated screen interpretation. The AI should not re-discover room ids, selectors, time select values, or duplicate policy unless SpaceCloud changes the page.

UI-mode implementation notes from the July 2026 batch:

- Use only the visible `예약추가` button because hidden responsive duplicates can exist.
- `#start_day` is readonly. If the modal default date is wrong, open the datepicker and click the date inside `#_dpicker1`.
- For dates `28` through `31`, ignore disabled previous-month anchors by selecting `#_dpicker1 a:not(.disable)`.

## Automatic Watch Mode

The watch mode is for near-unattended operation on the same Mac. It reuses a dedicated Chrome profile instead of storing SpaceCloud/Naver passwords.

Default profile:

```text
/Users/inteyeo/.spacecloud-automation
```

First-time login:

```bash
node tools/spacecloud-watch.mjs login
```

The user logs in manually in the Chrome window. The command exits once the SpaceCloud reservation calendar add button is visible.

Check saved login:

```bash
node tools/spacecloud-watch.mjs check-login
```

Check saved Naver SmartPlace login:

```bash
node tools/spacecloud-watch.mjs check-naver-login
```

Dry-run one polling cycle:

```bash
node tools/spacecloud-watch.mjs once --dry-run
```

Run one upload cycle:

```bash
node tools/spacecloud-watch.mjs once --limit-per-cycle 3
```

Run continuous watch mode:

```bash
node tools/spacecloud-watch.mjs watch --interval-seconds 60 --limit-per-cycle 3
```

What it does each cycle:

1. Builds a fresh plan from the Rhythmjoy Google Calendar cache.
2. Skips local-log duplicates, reservation-number-missing events, non-paid events, and optional iCal duplicates.
3. Opens the dedicated Chrome profile.
4. Uploads only `plan.upload` rows through the SpaceCloud UI.
5. Marks successful rows in `state/spacecloud-sync-log.json`.
6. Consumes pending SpaceCloud delete tasks from `rhythmjoy_spacecloud_tasks`.
7. Consumes pending Naver SmartPlace block tasks from `rhythmjoy_spacecloud_tasks`.
8. Writes operational files under `state/spacecloud-watch/`.

Operational limits:

- This is not password automation. If SpaceCloud or Naver expires the session, the watcher sends a Telegram login-needed alert, keeps the Chrome profile open, and retries on the normal watch interval after the host logs in again.
- It detects the Google Calendar cache, not raw Gmail. The server-side cache currently syncs Google Calendar every 15 seconds, so a 60-second local watch interval is usually enough.
- New confirmed Google Calendar events are automatically uploaded to SpaceCloud by the local watcher.
- Cancellation detection is handled earlier at the Naver email import layer: `ops/rhythmjoy_email_import.py` records the cancellation as a retained DB event and creates a follow-up task instead of removing the DB row. Naver-origin cancellations create a SpaceCloud `delete` task for mapped hall rooms. The local watcher consumes that task and deletes the matching direct-added SpaceCloud schedule through the logged-in UI.
- Automatic SpaceCloud deletion only proceeds when the clicked popup is a direct-added schedule and the room, date/time, and `naverReservationNo` in the memo match the DB task. Tasks without a reservation number are left as `needs_review` instead of being deleted automatically.
- Google Calendar deletion and SpaceCloud deletion are reported separately. `Google Calendar 자동삭제 완료` does not mean SpaceCloud was deleted; SpaceCloud task status must be `done` or `already_gone`.
- Telegram alerts are sent for host action items and state changes: successful SpaceCloud uploads, SpaceCloud login/session expiry, upload failures, delete tasks that need review, Naver SmartPlace block success or review-needed states, watcher cycle errors, Naver cancellation detection, and cancellation email parse failures.
- SpaceCloud reservation-complete and cancellation-complete email intake starts from the Naver mail folder displayed as `스페이스클라우드`. When `RHYTHMJOY_SPACECLOUD_EMAIL_ENABLED=1`, the Cafe24 email importer records parsed SpaceCloud emails in the DB, checks Google Calendar only as downstream verification data, and sends Telegram reports.
- If `RHYTHMJOY_SPACECLOUD_NAVER_BLOCK_ENABLED=1` is also enabled, SpaceCloud reservation-complete emails create a `naver_block` task even when Google Calendar already has a conflicting record. Naver mail plus DB is the source of truth; Google Calendar is a record after the platform-side action. The local Mac watcher opens Naver SmartPlace weekly calendar, selects the mapped room/date/time, splits overnight or multi-hour reservations into hourly slots, and changes available slots to `예약불가`. Only after that Naver-side change is verified does the watcher create the mapped Google Calendar event. If Naver already has a confirmed or sold-out slot there, the watcher does not overwrite it and marks the task `needs_review`.
- SpaceCloud cancellation-complete emails create a retained `spacecloud_cancellation` DB event and a `naver_restore` task. The local Mac watcher processes `naver_block` and `naver_restore` in DB creation order, restores only slots that are still `예약불가`, and deletes the matching Google Calendar record only after the Naver-side restore succeeds or is already available. Confirmed/sold-out/unknown Naver slots are left as `needs_review`.
- SpaceCloud cancellation emails may not include the SpaceCloud reservation id. In that case the importer tries to enrich the cancellation from an earlier `spacecloud_reservation` DB row with the same calendar, room/date/time, and reserver name. If no reservation id can be recovered, the restore task is left for review instead of changing Naver availability automatically.

## Naver Email DB Ledger

The Cafe24 email importer now writes a DB ledger before cross-platform side effects. The ledger is an operational queue and audit layer; Google Calendar is a downstream record after the real booking platform has been applied.

Tables:

- `rhythmjoy_naver_email_events`: one row per booking/cancellation email. Cancellations are not deleted from this table; they remain as `cancellation` or `spacecloud_cancellation` events with parse and processing status, so later audits can distinguish "mail arrived", "task saved", and "platform action completed".
- `rhythmjoy_booking_ledger`: one row per booking identity. This is the current-state ledger used to decide whether a booking is `confirmed` or `canceled`. Confirmed and canceled email event ids are linked back to `rhythmjoy_naver_email_events`; raw email event rows are retained as the audit trail.
- `rhythmjoy_spacecloud_tasks`: durable work queue for cross-platform actions. Naver reservation emails for mapped hall rooms create an `upload` task when enabled. Naver cancellation emails for mapped hall rooms create a `delete` task with `pending` status. SpaceCloud reservation-complete emails can create a `naver_block` task when enabled. SpaceCloud cancellation-complete emails can create a `naver_restore` task. The Mac watcher claims pending tasks, performs the matching UI action, and writes `done`, `already_gone`, `needs_review`, `google_pending`, or `failed`.

Default production behavior uses the Naver email DB row as the durable source before cross-platform work:

1. Naver email is read.
2. The email is saved or updated in `rhythmjoy_naver_email_events`.
3. The booking identity is upserted into `rhythmjoy_booking_ledger` as `confirmed` or `canceled`.
4. For mapped hall reservation emails, a SpaceCloud `upload` task is saved in `rhythmjoy_spacecloud_tasks` when `RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED=1`.
5. For cancellation emails, a SpaceCloud `delete` task is saved in `rhythmjoy_spacecloud_tasks`. With `RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED=1`, Google Calendar deletion is deferred until the watcher confirms the SpaceCloud delete task.
6. For SpaceCloud-origin reservation emails, a Naver SmartPlace `naver_block` task is saved in `rhythmjoy_spacecloud_tasks`.
7. For SpaceCloud-origin cancellation emails, a Naver SmartPlace `naver_restore` task is saved in `rhythmjoy_spacecloud_tasks`.
8. The Mac watcher polls `rhythmjoy_spacecloud_tasks` over SSH and performs the real platform-side UI action through the already logged-in Chrome profile.
9. Google Calendar is written or deleted after the platform-side action succeeds, so it stays a record layer instead of becoming the booking source.
10. DB status records the result for verification, retry, and recovery.

Booking ledger identity:

- If a Naver email has a reservation number, the ledger key is based on `source_platform + reservation_number`.
- SpaceCloud email identity never relies on a reservation number. SpaceCloud ledger keys are based on `source_platform + calendar + date + start/end + normalized reserver name`.
- If an email has no reservation number, the fallback key is based on `source_platform + calendar + date + start/end + reserver name`.
- Reserver names are normalized before SpaceCloud matching: whitespace is removed and trailing `님` suffixes are stripped repeatedly, so `김보현`, `김보현님`, and `김 보현 님` match the same ledger identity.
- Current production samples show Naver reservation emails include reservation numbers. SpaceCloud emails are treated as having no reliable reservation number even when a URL contains an internal numeric id. Earlier SpaceCloud cancellation emails stored before this parser change were `spacecloud_ignored`, so they have no parsed reservation number in the DB. Future SpaceCloud cancellation emails are parsed and then matched from the existing ledger or reservation email record by room/date/time/name.
- SpaceCloud settlement/admin notices in the same mail folder are not bookings. They are recorded only as ignored admin mail with reason `spacecloud_admin_settlement` and never update the booking ledger or automation task queue.

The older Google Calendar plan upload path remains as a legacy/backfill path for calendar records that already existed before the DB upload queue was enabled. New mapped hall reservations should enter through `upload` tasks instead.

With `RHYTHMJOY_EMAIL_DB_REQUIRED=0`, DB errors are logged and the importer falls back to calendar-only processing. Keep this as the normal operating mode while the DB is used as insurance.

Environment flags:

```text
DB_SERVERNAME=
DB_PORT=3306
DB_USERNAME=
DB_PASSWORD=
DB_NAME=
RHYTHMJOY_EMAIL_DB_REQUIRED=0
RHYTHMJOY_EMAIL_STORE_RAW_BODY=1
RHYTHMJOY_EMAIL_DEDUPE_GOOGLE=0
RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED=0
RHYTHMJOY_SPACECLOUD_EMAIL_ENABLED=0
RHYTHMJOY_SPACECLOUD_NAVER_BLOCK_ENABLED=0
```

`RHYTHMJOY_EMAIL_DEDUPE_GOOGLE=0` preserves the old behavior. Set it to `1` only if you intentionally want the importer to search Google Calendar by reservation number before creating an event.
Set `RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED=1` only when the local Mac watcher is installed, logged into SpaceCloud, and ready to consume `upload` tasks. With this enabled, mapped hall Naver reservation emails no longer create Google Calendar immediately; the watcher uploads to SpaceCloud first, then creates the Google Calendar record from the DB payload.

Set `RHYTHMJOY_SPACECLOUD_EMAIL_ENABLED=1` for SpaceCloud reservation email intake. Add `RHYTHMJOY_SPACECLOUD_NAVER_BLOCK_ENABLED=1` only when the local Mac watcher is installed, logged into Naver SmartPlace, and ready to consume `naver_block` tasks. Google Calendar creation for SpaceCloud-origin reservations is intentionally done by the local watcher after Naver SmartPlace availability is applied. Toggle the relevant flag back to `0` and restart `my_email_service.service` to return to the previous importer behavior.

LaunchAgent example:

```text
ops/com.rhythmjoy.spacecloud-watch.plist.example
```

Install or reinstall the LaunchAgent for the current checkout:

```bash
bash ops/install-spacecloud-watch.sh
```

## Rebuild On A New Mac

Use this when the automation Mac is replaced or the local machine is lost.

1. Clone the repository:

```bash
git clone https://github.com/clown36899/Rhythmandjoy_calendar.git /Users/inteyeo/Rhythmjoy_calendar
cd /Users/inteyeo/Rhythmjoy_calendar
```

2. Install runtime dependencies:

```bash
brew install node
brew install --cask google-chrome
npm install playwright
```

If this repository does not use a local `package.json`, keeping Playwright installed in one of the fallback workspaces is also supported by `tools/spacecloud-playwright-uploader.mjs`.

3. Create local config:

```bash
cp config/spacecloud-sync.example.json config/spacecloud-sync.local.json
```

If available, paste SpaceCloud `캘린더 내보내기` iCal URLs into `config/spacecloud-sync.local.json`. Do not commit this file because iCal URLs include private tokens.

4. Restore local upload state if you have a backup:

```bash
mkdir -p state
cp /path/to/backup/spacecloud-sync-log.json state/spacecloud-sync-log.json
```

If the local upload state is unavailable, run a dry-run first and rely on SpaceCloud duplicate blocking or iCal duplicate checks before enabling unattended upload.

5. Log in manually:

```bash
node tools/spacecloud-watch.mjs login
```

6. Check login and dry-run:

```bash
node tools/spacecloud-watch.mjs check-login
node tools/spacecloud-watch.mjs check-naver-login
node tools/spacecloud-watch.mjs once --dry-run
```

7. Install LaunchAgent:

```bash
bash ops/install-spacecloud-watch.sh
```

8. Confirm it is running:

```bash
launchctl list | rg spacecloud
tail -n 20 state/spacecloud-watch/launchd.log
```

Telegram alerts are read from `/Users/inteyeo/.rhythmjoy-ingestion.env`, the same file used by the existing ingestion job. Keep that file out of Git.

## Duplicate Policy

The default policy is conservative:

- Upload only events with `예약번호:` in the Google Calendar description.
- Upload only events with `결제상태: 결제완료`.
- Skip events without a reservation number because those are likely already SpaceCloud-origin events in the Rhythmjoy calendar.
- Skip events already recorded in the local upload log at `state/spacecloud-sync-log.json`.
- If iCal URLs are configured, skip any SpaceCloud event with the same room/date/start/end slot.

## Time Normalization

Rhythmjoy reservations are handled as one-hour unit slots. Keep this simple:

- `23:59` as an end time is normalized to `24:00`.
- An event ending at next-day `00:00` is also treated as same-day `24:00`.
- Other non-hour-unit times should be treated as data mistakes and reviewed only if they appear in the upload date range.

## Current Limits

SpaceCloud's iCal export may take up to 24 hours to include newly added reservations. For immediate post-upload verification, use the SpaceCloud calendar screen. Use iCal as a later reconciliation check.

After a successful manual or browser-assisted upload, mark the event in the local log so the next dry-run skips it immediately:

```bash
node tools/spacecloud-sync.mjs mark-uploaded --fingerprint 'b|YYYY-MM-DD|HH:mm|HH:mm' --source-event-id 'b:google-event-id' --reservation-no 'naver-reservation-no'
```

## API Findings

The SpaceCloud Host React bundle shows that the modal submit calls the API directly:

- Create: `POST https://api.spacecloud.kr/partner/products/:productId/external_schedules`
- Update: `PUT https://api.spacecloud.kr/partner/products/:productId/external_schedules/:externalReservationId`
- Delete: `DELETE https://api.spacecloud.kr/partner/products/:productId/external_schedules/:externalReservationId`
- Calendar read: `GET https://api.spacecloud.kr/partner/reservations/calendar?year=YYYY&month=MM&product_id=:productId`

Create payload from the frontend:

```json
{
  "SDATE": "YYYYMMDD",
  "EDATE": "YYYYMMDD",
  "SHOUR": "19",
  "EHOUR": "21",
  "NAME": "예약자명",
  "TEL": "",
  "MEMO": "memo",
  "REPEAT_TYPE": "-1",
  "REPEAT_END_DATE": "YYYYMMDD"
}
```

Unauthenticated direct calls return `401 {"error":"Missing token"}`. The endpoint exists, but an API-mode uploader needs a safe way to use the logged-in browser token/session without printing or storing it in Git.

Per the current operating rule, do not use keychain extraction or direct token handling. API-mode remains a possible future optimization only if it can run inside the already logged-in browser session without exposing credentials.

Resource-saving path:

1. Keep `plan` and local upload log as-is.
2. Use UI-mode from `spacecloudUiInput` as the default low-resource path.
3. Revisit API-mode only when credential/session handling can stay fully inside the logged-in browser boundary.
