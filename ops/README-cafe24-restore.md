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

Do not put DB passwords, API keys, tokens, or TLS private keys in the canonical target file or anywhere else in Git.

## What is backed up in Git

- Static calendar site: `www/`
- DB ledger public calendar cache loop: `ops/rhythmjoy_calendar_cache.py`
- systemd service: `ops/rhythmjoy-calendar-cache.service`
- Apache vhosts/static cache/modsecurity config: `ops/*.conf`
- certbot cron and reload hook: `ops/rhythmjoy-certbot.cron`, `ops/reload-httpd-after-certbot.sh`
- Active reservation email to DB ledger/Outbox import service: `ops/rhythmjoy_email_import.py`
- Legacy Naver email import code, sanitized for reference: `ops/naver_booking_googleimport/import_email.py`
- Python package snapshot from Cafe24: `ops/cafe24-requirements.txt`
- Canonical non-secret production target: `ops/cafe24-production-target.env`
- DB backup helper: `ops/backup-cafe24-db.sh`
- DB backup cron: `ops/rhythmjoy-db-backup.cron`
- Deploy helper: `ops/deploy-cafe24.sh`
- Restore helper: `ops/restore-cafe24.sh`

## What is intentionally not backed up

- Server login passwords and SFTP configs
- `/home/clown313python/myapp/.env`
- Let's Encrypt private keys and live certificates
- Runtime cache files such as `calendar_set/calendar_v10/data/events.json`
- Database dump files, because they contain reservation/customer data
- Flask session files, uploads, logs, and other user/runtime data

Keep the omitted secret files in a separate password manager or private offline backup.

## Database backups

Git stores the DB schema-creating importer code, but it must not store live DB rows because those rows can contain reservation/customer data. Back up the live Cafe24 DB outside Git:

```bash
/home/clown313python/rhythmjoy_ops/backup-cafe24-db.sh
```

The helper reads DB credentials from `/home/clown313python/myapp/.env`, writes compressed dumps under:

```text
/home/clown313python/rhythmjoy_ops/backups/db
```

and keeps 30 days by default. Copy important dump files to a private offline backup if the goal is recovery after total Cafe24 loss.

The restore script also installs `/etc/cron.d/rhythmjoy-db-backup`, which runs the helper once per day at 04:23 server time.

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
- DB ledger public cache interval is 60 seconds.
- Browser-side polling reads the server cache every 60 seconds while the page is visible.
- `rhythmandjoy.cafe24.com` currently resolves to `210.114.6.137`; do not use it as the deployment target for this VPS.
- Git push is backup/history only. Production is updated through the guarded Cafe24 deploy/restore scripts.

## Naver email DB ledger

The reservation email pipeline uses the Transactional Inbox + Outbox rules documented in [`docs/transactional-inbox-outbox-runbook.md`](../docs/transactional-inbox-outbox-runbook.md). Read that runbook before changing IMAP fetch behavior, transaction boundaries, ledger identity, Outbox deduplication, or reflection audits.

`ops/rhythmjoy_email_import.py` first stores the source email as a durable Inbox record. It then locks that Inbox row and atomically writes the booking ledger, required cross-platform Outbox task, and final Inbox processing status. Only after that transaction commits may the source email be marked read. With `RHYTHMJOY_EMAIL_DB_REQUIRED=1`, a DB handoff failure intentionally stops processing and leaves the email unread for retry.

- `rhythmjoy_naver_email_events`: durable record of each Naver/SpaceCloud reservation or cancellation email and its processing status. Cancellation rows are retained instead of deleted, so a later audit can distinguish "cancellation email arrived" from "platform action completed".
- `rhythmjoy_booking_ledger`: current-state booking ledger. Each parsed confirmation/cancellation email upserts a booking identity as `confirmed` or `canceled`, while linking back to the original confirmed/canceled email event ids. This is the booking-state layer; email events remain the source audit trail.
- `rhythmjoy_spacecloud_tasks`: durable queue for cross-platform follow-up work. Naver-origin reservation/cancellation tasks update SpaceCloud, and SpaceCloud-origin reservation/cancellation tasks update Naver. Final states are `done`, `already_gone`, `needs_review`, or `failed`; old `google_pending` values are historical only.

Keep `RHYTHMJOY_EMAIL_DB_REQUIRED=1` for normal operation so DB errors stop the importer before any platform side effect. This leaves unread mail available for retry after DB recovery.

`RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED=1` makes mapped hall Naver reservation emails create `upload` tasks. The Ubuntu mini PC watcher uploads the SpaceCloud direct-added reservation and records the result in the DB task.

The Ubuntu mini PC watcher runs only in DB queue mode. It does not scan a calendar cache for work.

`RHYTHMJOY_SPACECLOUD_EMAIL_ENABLED=1` enables SpaceCloud reservation-complete and cancellation-complete email intake from the Naver mail folder displayed as `스페이스클라우드`. With `RHYTHMJOY_SPACECLOUD_NAVER_BLOCK_ENABLED=1`, confirmations create `naver_block` tasks and cancellations create `naver_restore` tasks for the Ubuntu watcher. Set the relevant flag back to `0` and restart `my_email_service.service` to disable that intake or queue.

SpaceCloud emails are matched without reservation numbers. The importer uses calendar/room, date, start/end time, and normalized reserver name; whitespace is removed and trailing `님` suffixes are stripped before matching. SpaceCloud cancellation emails are matched from an earlier `rhythmjoy_booking_ledger` or `spacecloud_reservation` DB row with the same normalized identity. If no matching identity is available, the task is retained for review instead of changing Naver availability automatically.

The Cafe24 timer `rhythmjoy-reflection-audit.timer` supports an email-ledger reflection audit. `rhythmjoy_booking_ledger` is the trusted booking source, and `rhythmjoy_reflection_audits` compares final confirmed rows with the opposite-platform task result and DB-backed public cache. The server timer runs every 30 minutes and sends Telegram only when issues are present. Use `/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8 /home/clown313python/rhythmjoy_ops/rhythmjoy_reflection_audit.py --json --notify` on Cafe24, or `node tools/spacecloud-watch.mjs reflection-audit --json --no-telegram` from this repo, for a one-off audit.

The Ubuntu watcher can additionally enable `--customer-platform-audit`. It reuses the existing persistent Naver/SpaceCloud session and checks one customer reservation every four hours by default. Local macOS installation explicitly disables this audit so it cannot open a visible browser unexpectedly. A list-search miss is not a confirmed mismatch; only an identity-verified explicit canceled state is promoted immediately, while read failures require a second failed pass.

Confirmation SMS is sent by the active browser watcher after a booking has been successfully applied to the opposite platform. Current production uses the Ubuntu mini PC watcher. SMS uses Aligo only. `ALIGO_SMS_USER_ID`, `ALIGO_SMS_API_KEY`, and `ALIGO_SMS_SENDER` must be present in `/home/clown313python/myapp/.env`; otherwise SMS sending fails without using another provider. Register the Cafe24 server IP `1.234.23.64` in Aligo before enabling Aligo.

Run this after restoring a DB backup or deploying the ledger for the first time:

```bash
/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8 /home/clown313python/rhythmjoy_ops/rhythmjoy_email_import.py --backfill-ledger
```
