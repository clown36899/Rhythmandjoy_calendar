# Cafe24 VPS deploy, backup, and restore

This repository is only for `리듬앤조이일정표.com` (`xn--xy1b23ggrmm5bfb82ees967e.com`). It stores the deployable Rhythmjoy calendar site, Cafe24 Apache configuration, systemd loop service, certbot renewal hook, and sanitized Naver email import code.

The Cafe24 VPS is shared with a separate `swingenjoy.com` project, but this repository must never manage that project. Do not use `/opt/swingenjoy`, `swingenjoy.service`, `127.0.0.1:3001`, `swingenjoy-http.conf`, or `swingenjoy-http-le-ssl.conf` here.

## Canonical production target

Non-secret production target settings live in `ops/cafe24-production-target.env`.

- VPS hostname: `clown313python.cafe24.com`
- VPS IP / SSH target: `root@1.234.23.64`
- Server web root: `/home/clown313python/myapp`
- Server ops dir: `/home/clown313python/rhythmjoy_ops`
- Main entry: `/calendar_set/calendar_v10/calendar_10.html`
- Cache service: `rhythmjoy-calendar-cache.service`
- Legacy email service name: `my_email_service.service`
- Server env file: `/home/clown313python/myapp/.env`

Do not put DB passwords, API keys, tokens, Google service account JSON, or TLS private keys in the canonical target file or anywhere else in Git.

## What is backed up in Git

- Static calendar site: `www/`
- Google Calendar cache loop: `ops/rhythmjoy_calendar_cache.py`
- systemd service: `ops/rhythmjoy-calendar-cache.service`
- Apache vhosts/static cache/modsecurity config: `ops/*.conf`
- certbot cron and reload hook: `ops/rhythmjoy-certbot.cron`, `ops/reload-httpd-after-certbot.sh`
- Active Naver email to Google Calendar import service: `ops/rhythmjoy_email_import.py`
- Legacy Naver email import code, sanitized for reference: `ops/naver_booking_googleimport/import_email.py`
- Python package snapshot from Cafe24: `ops/cafe24-requirements.txt`
- Canonical non-secret production target: `ops/cafe24-production-target.env`
- Deploy helper: `ops/deploy-cafe24.sh`
- Restore helper: `ops/restore-cafe24.sh`

## What is intentionally not backed up

- Server login passwords and SFTP configs
- `/home/clown313python/myapp/.env`
- Google service account JSON such as `static/rhythmjoycalendar-*.json`
- Let's Encrypt private keys and live certificates
- Runtime cache files such as `calendar_set/calendar_v10/data/events.json`
- Flask session files, uploads, logs, and other user/runtime data

Keep the omitted secret files in a separate password manager or private offline backup.

## Restore outline

1. Provision a Cafe24 VPS with Apache/httpd, Python 3.8.12 pyenv environment, and certbot.
2. Clone this repository on the VPS.
3. Restore secret files manually using `ops/env.example` as the checklist.
4. Confirm the target is `clown313python.cafe24.com`; `restore-cafe24.sh` also refuses to run if `hostname`/`hostname -f` does not match.
5. Run as root from the repo:

```bash
bash ops/restore-cafe24.sh
```

6. If TLS files are missing, point DNS to the VPS and run certbot for `xn--xy1b23ggrmm5bfb82ees967e.com`.
7. Verify:

```bash
systemctl status rhythmjoy-calendar-cache.service
curl -I https://xn--xy1b23ggrmm5bfb82ees967e.com/
curl -s https://xn--xy1b23ggrmm5bfb82ees967e.com/calendar_set/calendar_v10/data/events.json | head
```

## Deploy outline

From the local repository at `/Users/inteyeo/Rhythmjoy_calendar`:

```bash
bash ops/deploy-cafe24.sh
```

The deploy helper reads `ops/cafe24-production-target.env`, verifies the remote hostname is `clown313python.cafe24.com` before uploading, syncs a release copy under `/home/clown313python/rhythmjoy_ops/release`, then runs the guarded restore script on the VPS.

## Apache scope

This repository may manage only these Apache config names:

- `rhythmjoy-domain-*.conf`
- `rhythmjoy-calendar-*.conf`
- `clown313python-root-redirect.conf`

The restore script refuses any Apache config outside that allowlist.

## Current production notes

- Domain root internally serves `/calendar_set/calendar_v10/calendar_10.html`.
- Google Calendar cache interval is 15 seconds.
- Browser-side polling reads the server cache every 15 seconds while the page is visible.
- `rhythmandjoy.cafe24.com` currently resolves to `210.114.6.137`; do not use it as the deployment target for this VPS.
- Git push is backup/history only. Production is updated through the guarded Cafe24 deploy/restore scripts.

## Naver email DB ledger

`ops/rhythmjoy_email_import.py` writes a DB record before creating or deleting Google Calendar events when `DB_SERVERNAME`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_NAME` are set in `/home/clown313python/myapp/.env`. The DB ledger is the audit/recovery layer; it should not block the existing Google Calendar importer in normal operation.

- `rhythmjoy_naver_email_events`: durable record of each Naver/SpaceCloud reservation or cancellation email and its processing status. Cancellation rows are retained instead of deleted, so a later audit can distinguish "cancellation email arrived" from "platform action completed".
- `rhythmjoy_spacecloud_tasks`: durable queue for cross-platform follow-up work. Naver-origin cancellation delete tasks for mapped hall rooms are consumed by the Mac SpaceCloud watcher and marked `done`, `already_gone`, `needs_review`, `google_pending`, or `failed`. SpaceCloud-origin cancellation emails create `naver_restore` tasks that restore Naver SmartPlace availability before Google Calendar is deleted.

Keep `RHYTHMJOY_EMAIL_DB_REQUIRED=0` for normal operation so DB errors fall back to calendar-only processing. Keep `RHYTHMJOY_EMAIL_DEDUPE_GOOGLE=0` unless you intentionally want the importer to search Google Calendar by reservation number before creating a new event.

`RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED=1` makes mapped hall Naver reservation emails create `upload` tasks instead of writing Google Calendar immediately. The local Mac watcher uploads the SpaceCloud direct-added reservation first, then writes Google Calendar from the DB payload.

`RHYTHMJOY_SPACECLOUD_EMAIL_ENABLED=1` enables SpaceCloud reservation-complete and cancellation-complete email intake from the Naver mail folder displayed as `스페이스클라우드`. The Naver email plus DB row is the source of truth; Google Calendar checks are only downstream verification. With `RHYTHMJOY_SPACECLOUD_NAVER_BLOCK_ENABLED=1`, parsed SpaceCloud confirmations create `naver_block` tasks that the local Mac watcher applies to Naver SmartPlace before writing Google Calendar, and parsed SpaceCloud cancellations create `naver_restore` tasks that restore Naver availability before deleting Google Calendar. Set the relevant flag back to `0` and restart `my_email_service.service` to disable the new intake or queue without affecting the rest of the importer.

SpaceCloud cancellation emails may omit the SpaceCloud reservation id. The importer first tries to recover it from an earlier `spacecloud_reservation` DB row with the same calendar, date/time, and reserver name. If no id is available, the task is retained for review instead of changing Naver availability automatically.
