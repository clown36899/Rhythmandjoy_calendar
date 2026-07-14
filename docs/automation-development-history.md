# Rhythmjoy Reservation Automation Development History

Last reviewed: 2026-07-14 KST

This document records how the current reservation automation was built, why the architecture changed, and what should be remembered before future maintenance. It is safe for Git and does not include passwords, private keys, browser cookies, or API secrets.

## Current State

- Cafe24 is the source/server layer: Naver mail ingestion, DB ledger, public calendar site, Google Calendar record writes, and Aligo SMS sending.
- Ubuntu mini PC is the current main browser automation runner: it uses the saved Chrome profile to apply SpaceCloud and Naver SmartPlace browser actions.
- MacBook watcher is not deleted. It remains a working rollback/manual execution path, but it must not run at the same time as the Ubuntu watcher.
- Google Calendar is a record/output layer, not the booking source of truth.
- The booking source of truth starts from Naver email intake and the DB rows written by `ops/rhythmjoy_email_import.py`.
- Stable rollback tag before productized sync/admin-panel work:
  `stable/ubuntu-mini-pc-working-20260714`.

## Development Timeline

1. Manual SpaceCloud entry was tested first.
   - The user logged in manually.
   - Browser automation learned the SpaceCloud host calendar flow.
   - Room selection happens before the add-reservation modal.
   - SpaceCloud direct-added schedules show as `추`.

2. Google Calendar based upload was tried as the first automation source.
   - Existing confirmed events were read from the Rhythmjoy Google Calendar cache.
   - This worked for initial backfill and bulk upload.
   - Later it was demoted because Google Calendar can already contain platform-origin reservations and should not be treated as the primary source.

3. Duplicate handling was clarified.
   - Naver-origin reservations uploaded to SpaceCloud should skip or tolerate existing schedules.
   - SpaceCloud itself blocks overlapping entries.
   - For reliable deletion, Naver-origin SpaceCloud direct-add entries include the Naver reservation number where available.

4. Email DB ledger was added.
   - Naver email ingestion writes DB records before side effects.
   - Confirmations and cancellations are retained instead of deleting rows.
   - This makes cancellation state auditable and supports retry after service interruption.

5. Cancellation automation was added.
   - Naver-origin cancellations create SpaceCloud `delete` tasks.
   - SpaceCloud-origin cancellations create Naver `naver_restore` tasks.
   - Deletion/restoration only happens after matching room/date/time and identity.
   - Cancellation does not send reservation-confirmation SMS.

6. SpaceCloud email intake was added.
   - SpaceCloud reservation and cancellation emails are collected from the Naver mail folder displayed as `스페이스클라우드`.
   - Settlement/admin emails in that folder are ignored.
   - SpaceCloud emails do not reliably include a reservation number, so matching uses room/date/time/reserver name.

7. Naver SmartPlace blocking/restoring was added.
   - SpaceCloud-origin reservation emails create `naver_block` tasks.
   - SpaceCloud-origin cancellation emails create `naver_restore` tasks.
   - Naver availability is changed in weekly calendar view by room/date/hour slot.
   - Overnight or multi-hour reservations are split into hourly slots.

8. SMS provider was changed to Aligo only.
   - Cafe24 SMS was tested and then removed from the sending path.
   - Aligo is the only provider used by `ops/aligo_sms.py`.
   - Confirmation SMS is sent only after the opposite platform action succeeds.

9. Reservation guide page and short SMS link were added.
   - SMS stays short and links to the guide page.
   - The guide page contains entry info, restrictions, schedule link, and platform-specific change/cancel guidance.

10. Main browser runner moved from MacBook to Ubuntu mini PC.
   - MacBook watcher was stopped and disabled to avoid duplicate queue processing.
   - Ubuntu watcher was installed as `rhythmjoy-spacecloud-watch.service`.
   - Ubuntu kiosk stays separate with its own Chrome profile.
   - Ubuntu opens a reverse SSH tunnel to Cafe24 so it can be controlled off-site.

## Important Architecture Decisions

- Naver email plus DB is the durable starting point.
- Browser automation is a worker that consumes DB tasks.
- Google Calendar is written only after the real platform-side action succeeds.
- Cancellation rows remain in DB, so the system can distinguish "cancellation email arrived" from "platform deletion/restoration completed".
- Do not run two browser watchers at once. They claim the same DB queue and can race.
- Browser login sessions are not stored in Git. If sessions expire, the watcher must pause/retry and Telegram should request manual login.

## Known Issues And Resolutions

### Google Calendar As Source Was Too Ambiguous

Issue:
Google Calendar already contained Naver and SpaceCloud confirmed reservations, so reading it as the source could create duplicates.

Resolution:
Use Naver email DB rows as the source. Google Calendar is now a record after platform action.

### SpaceCloud Has No Reservation Number In Email

Issue:
SpaceCloud emails do not reliably include a reservation number.

Resolution:
Match SpaceCloud-origin work by room, date, start/end time, and normalized reserver name. Strip whitespace and trailing `님` for matching.

### Direct Deletion Could Remove The Wrong Item

Issue:
SpaceCloud deletion must click the exact calendar event. Coordinate-based selection is not safe.

Resolution:
The automation searches candidates by visible event text and verifies direct-added `추` schedules. For Naver-origin tasks, reservation number is used when available; name/time/room are fallback only.

### Duplicate Watchers Are Dangerous

Issue:
Mac and Ubuntu watchers can both claim DB work.

Resolution:
Current normal operation keeps Ubuntu watcher enabled and Mac watcher disabled. Mac watcher remains a rollback tool only.

### Session Expiration Still Requires Human Login

Issue:
Naver and SpaceCloud sessions can expire. The automation cannot and should not store user login credentials.

Resolution:
Use Telegram login-required alerts. Use Cafe24 reverse SSH plus a remote screen tool when available, or local mini PC screen, for the user to log in manually.

### SMS Cost And Message Length

Issue:
Long SMS/LMS content is expensive.

Resolution:
Send a short confirmation SMS with a guide link. Full instructions live on the guide page.

### Cafe24 SMS Was Replaced

Issue:
Cafe24 SMS setup was separate and unnecessary once Aligo was chosen.

Resolution:
Aligo is the only SMS provider. Cafe24 remains the server, DB, and email-ingestion host, but not the SMS sender.

### DB Backup Script Must Not Source The Whole Server Env

Issue:
The Cafe24 server `.env` can contain lines that are valid for the app but not valid as a Bash `source` file.

Resolution:
`ops/backup-cafe24-db.sh` parses only the DB variables it needs (`DB_SERVERNAME`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, and optional `DB_PORT`) instead of sourcing the full file.

## Mac Watcher State

Mac watcher files remain in Git:

```text
ops/install-spacecloud-watch.sh
ops/com.rhythmjoy.spacecloud-watch.plist.example
tools/spacecloud-watch.mjs
tools/spacecloud-playwright-uploader.mjs
tools/naver-playwright-availability.mjs
```

Normal current state on the Mac:

```text
com.rhythmjoy.spacecloud-watch stopped
com.rhythmjoy.spacecloud-watch disabled
```

Rollback to Mac is possible, but first stop Ubuntu:

```bash
# On Ubuntu mini PC
systemctl --user disable --now rhythmjoy-spacecloud-watch.service

# On Mac
cd /Users/inteyeo/Rhythmjoy_calendar
bash ops/install-spacecloud-watch.sh
```

Before switching back to Ubuntu, stop and disable the Mac watcher again:

```bash
launchctl bootout gui/$(id -u)/com.rhythmjoy.spacecloud-watch 2>/dev/null || true
launchctl disable gui/$(id -u)/com.rhythmjoy.spacecloud-watch
```

## Ubuntu Main Runner State

Ubuntu watcher files remain in Git:

```text
ops/install-ubuntu-spacecloud-watch.sh
ops/setup-ubuntu-remote-control.sh
docs/spacecloud-ubuntu-main-pc.md
```

Normal current state on Ubuntu:

```text
rhythmjoy-spacecloud-watch.service active + enabled
kiosk-chrome.service active + enabled
rhythmjoy-reverse-ssh.service active + enabled
rhythmjoy-log-sync.timer active + enabled
```

## Data Recovery Notes

Git can restore the code and service definitions. It cannot restore live secrets or browser login sessions.

Not stored in Git:

```text
Cafe24 .env secrets
Google service account JSON
private SSH keys
Aligo API key
Telegram bot token
Naver/SpaceCloud browser cookies
DB dumps and live reservation/customer data
```

For DB data, use:

```bash
/home/clown313python/rhythmjoy_ops/backup-cafe24-db.sh
```

Store important dump files in a private backup location outside Git.
