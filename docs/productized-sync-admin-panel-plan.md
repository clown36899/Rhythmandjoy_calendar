# Productized Sync And Admin Panel Plan

Last reviewed: 2026-07-14 KST

This plan starts from the current working Ubuntu mini PC automation. The current
production path is stable and must remain recoverable while productized
multi-customer sync and an admin panel are developed.

## Stable Baseline

Do not lose this point:

```text
Git tag: stable/ubuntu-mini-pc-working-20260714
Commit: b22500e Add short-lived profile feed runner
```

Rollback rule:

1. Stop any new productized runner.
2. Keep or restore the current Cafe24 DB/email services.
3. Check out `stable/ubuntu-mini-pc-working-20260714`.
4. Run the existing Ubuntu watcher path from
   `docs/spacecloud-ubuntu-main-pc.md`.
5. Do not run the Mac watcher and Ubuntu watcher together.

## Current Working System To Preserve

- Cafe24 remains the server layer: DB, email importer, public calendar site,
  Google Calendar record writes, Telegram alerts, and Aligo SMS.
- Ubuntu mini PC remains the current browser automation runner.
- Current watcher queue mode stays available until the replacement is proven.
- The current Naver/SpaceCloud login sessions are browser profile state, not
  code or Git data.

No productized work should mutate the current working watcher behavior until it
has passed shadow-mode and dry-run checks.

## Productized Target

The sellable target is still narrow:

```text
Naver Reservation <-> SpaceCloud synchronization
```

Important decisions:

- Event detection interval: 3 minutes is enough.
- Naver access should use a customer-added manager/admin account where possible.
- SpaceCloud access should use the customer-authorized logged-in session method
  already proven in the current automation.
- No platform password storage.
- No hidden API/token extraction as a production method.
- Use visible logged-in platform screens and low-frequency sequential execution.
- Google Calendar is optional output/record only, not the source of truth.

## Optimized Runner Model

Use the short-lived profile model:

```text
for each tenant due for scan:
  acquire tenant lock
  open tenant browser profile
  read Naver visible feed
  read SpaceCloud visible feed
  normalize events into DB ledger
  create required cross-platform tasks
  process due tasks for that tenant
  verify visible result
  close browser profile
  release tenant lock
```

Default cadence:

```text
scan_interval_seconds = 180
max_parallel_browsers = 1 initially
max_parallel_browsers = 2 only after memory tests
per_tenant_lock = required
```

Reasoning:

- A 3-minute interval reduces platform load and bot-risk versus 30 or 60 second
  page loops.
- Opening profiles only when work is due reduces idle RAM use.
- Sequential tenant processing keeps an 8GB VPS realistic.

Initial capacity target:

```text
8GB runner = 5 tenants for paid beta
```

Increase only after real timing and memory data prove it.

## Admin Panel Target

Build a management panel backed by the DB ledger instead of Google Calendar.

The panel should show:

- room schedule by day/week/month;
- source platform: Naver, SpaceCloud, admin/manual;
- platform action status for each side;
- conflicts and needs-review items;
- pending/running/failed/done tasks;
- SMS sent/not-sent state for confirmations.

The panel should allow:

- add reservation manually;
- cancel/restore a manual reservation;
- retry a failed sync task;
- mark an ambiguous item as reviewed;
- open login-needed instructions for a tenant;
- view raw event/task audit history.

Manual admin entry behavior:

```text
admin creates reservation
  -> DB validates room/time conflict
  -> create Naver block task
  -> create SpaceCloud direct-add task
  -> after both platform actions succeed, mark manual reservation active
  -> optional Google Calendar record/write only after platform success
```

Manual cancellation behavior:

```text
admin cancels manual reservation
  -> create Naver restore task only for automation-owned blocks
  -> create SpaceCloud delete task only for automation-created direct-add rows
  -> after platform actions succeed, mark reservation canceled
```

Never release a Naver slot that was blocked manually outside this automation.

## Data Model Tasks

Add new tables without breaking current Rhythmjoy tables first.

- [ ] `sync_tenants`
  - customer/business identity
  - plan tier
  - scan interval
  - active flag

- [ ] `sync_platform_accounts`
  - tenant id
  - platform: `naver` or `spacecloud`
  - profile directory key
  - login status
  - last successful scan

- [ ] `sync_spaces`
  - tenant id
  - Naver business id
  - SpaceCloud product/space identifiers when known

- [ ] `sync_rooms`
  - tenant id
  - canonical room key
  - Naver room label/id
  - SpaceCloud room label/id
  - display order

- [ ] `sync_reservation_ledger`
  - immutable-ish reservation facts
  - source platform
  - source reservation id when available
  - room/date/start/end/name/phone hash
  - current status

- [ ] `sync_tasks`
  - platform action queue
  - idempotency key
  - action type: naver_block, naver_restore, spacecloud_add, spacecloud_delete
  - status, attempts, lock token, result text

- [ ] `sync_task_runs`
  - per-attempt logs and timing

- [ ] `sync_manual_events`
  - admin-created reservations
  - ownership markers for safe restore/delete

- [ ] `sync_conflicts`
  - duplicate/overlap records requiring review

- [ ] `sync_audit_log`
  - admin actions, automation actions, retry decisions

## Code Tasks

### Phase 0: Freeze And Observe

- [x] Tag the current working baseline:
  `stable/ubuntu-mini-pc-working-20260714`.
- [x] Confirm Ubuntu watcher, reverse SSH, and kiosk Chrome are active from
  Cafe24 synced logs.
- [x] Capture one current production status report from Cafe24 synced logs.

Observed on 2026-07-14 14:06 KST:

```text
synced-at: 2026-07-14T14:06:13+09:00
rhythmjoy-spacecloud-watch.service: active
rhythmjoy-reverse-ssh.service: active
kiosk-chrome.service: active
watcher log: cycle idle; candidates=0; attempted=0; remaining=0
watcher current memory: about 354MB, observed peak about 612MB
kiosk Chrome current memory: about 450MB, observed peak about 1.0GB
```

### Phase 1: Tenant Config Layer

- [ ] Extract hardcoded Rhythmjoy room/platform mappings into a tenant config
  loader.
- [ ] Keep current single-tenant defaults exactly matching Rhythmjoy.
- [ ] Add a dry-run command that prints resolved tenant configuration.
- [ ] Add validation for missing room mappings and duplicate room labels.

### Phase 2: Read-Only Detector

- [ ] Extend the visible UI detector into tenant-aware mode.
- [ ] Add Naver visible feed scan using manager/admin login session.
- [ ] Add SpaceCloud visible feed scan using the known logged-in session method.
- [ ] Store detected events into the new ledger in shadow mode.
- [ ] Run every 180 seconds in shadow mode without creating platform tasks.
- [ ] Compare shadow ledger against current email-origin DB ledger for Rhythmjoy.

### Phase 3: Task Creation

- [ ] Convert new confirmed Naver events into SpaceCloud add/block tasks.
- [ ] Convert new Naver cancellations into SpaceCloud delete/restore tasks.
- [ ] Convert new confirmed SpaceCloud events into Naver block tasks.
- [ ] Convert new SpaceCloud cancellations into Naver restore tasks.
- [ ] Deduplicate by platform id where available.
- [ ] Fallback match by room/date/time/name only where platform id is missing.
- [ ] On conflict, prefer Naver reservation and alert instead of overwriting.

### Phase 4: Short-Lived Action Runner

- [ ] Make SpaceCloud add/delete actions run through the short-lived profile
  pattern.
- [ ] Make Naver block/restore actions run through the short-lived profile
  pattern.
- [ ] Close browser after each tenant cycle.
- [ ] Keep action idempotency keys so restarts do not duplicate platform writes.
- [ ] Add login-needed detection and Telegram alerts.

### Phase 5: Admin Panel MVP

- [ ] Choose implementation path:
  - simple server-rendered HTML first, or
  - existing static calendar + JSON API, or
  - FullCalendar admin view.
- [ ] Add authenticated admin route.
- [ ] Show weekly schedule with room filters.
- [ ] Add manual reservation form.
- [ ] Add conflict validation before saving.
- [ ] Create platform sync tasks from manual reservations.
- [ ] Add task status and retry controls.

### Phase 6: Migration And VPS Readiness

- [ ] Produce install script for Ubuntu mini PC and VPS with the same steps.
- [ ] Move runtime paths into environment/config values.
- [ ] Add systemd service templates for:
  - detector scheduler;
  - action runner;
  - admin panel;
  - log sync.
- [ ] Add backup/restore notes for config and DB schema.
- [ ] Document customer re-login flow after migration.

## Test Plan

Read-only first:

- [ ] Run detector against current Rhythmjoy Naver and SpaceCloud sessions.
- [ ] Confirm it sees newly confirmed reservations within 3 minutes.
- [ ] Confirm it sees cancellations within 3 minutes.
- [ ] Confirm it does not mutate platform state in read-only mode.

Dry-run task generation:

- [ ] Generate expected tasks from detected events.
- [ ] Verify task identity and idempotency keys.
- [ ] Verify duplicate booking scenarios are marked conflict/review.

Controlled live test:

- [ ] Create a test reservation or manual admin event in a safe time slot.
- [ ] Apply SpaceCloud side.
- [ ] Apply Naver side.
- [ ] Verify both platform UI results.
- [ ] Cancel the test event and verify restore/delete.

Load test:

- [ ] Create 5 fake tenant profiles or logged-out profiles.
- [ ] Run 180-second scheduler loop.
- [ ] Measure elapsed time and peak memory.
- [ ] Confirm no more than configured browser concurrency is used.

## Open Questions

- Whether the admin panel should live on the current Cafe24 server or on the
  browser runner server.
- Whether each customer gets a local mini PC option, a shared VPS option, or
  both.
- Whether SMS is included in the sync product or sold as an add-on.
- Whether Google Calendar output remains enabled for Rhythmjoy only or becomes
  optional per tenant.

## Do Not Do Yet

- Do not replace the current Ubuntu watcher.
- Do not delete the Mac rollback path.
- Do not convert current production tables until shadow mode proves equivalent.
- Do not rely on hidden platform API calls as the product source.
- Do not run multiple active workers against the same tenant account.
