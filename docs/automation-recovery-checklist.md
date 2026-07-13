# Rhythmjoy Automation Recovery Checklist

Last reviewed: 2026-07-14 KST

This document records the current recovery point for the Rhythmjoy reservation automation. It is intentionally safe for Git: it records service names, file paths, and rebuild steps, but does not include passwords, API keys, private SSH keys, browser cookies, or login sessions.

## Git Source Of Truth

Repository:

```text
https://github.com/clown36899/Rhythmandjoy_calendar.git
```

The working branch is:

```text
main
```

Confirm local `main` and `origin/main` before rebuilding or deploying:

```bash
git status --short
git rev-parse main
git ls-remote origin refs/heads/main
```

If Codex or the local Mac workspace is removed, restore the code with:

```bash
git clone https://github.com/clown36899/Rhythmandjoy_calendar.git
cd Rhythmandjoy_calendar
```

## Current Production Roles

- Cafe24 is the server/source-of-truth layer: email ingestion, DB ledger, public website, Google Calendar record updates, and Aligo SMS environment.
- Ubuntu mini PC is the browser automation runner: it reads the Cafe24 DB queue and applies changes through Naver SmartPlace and SpaceCloud browser sessions.
- MacBook watcher is disabled during normal operation, but remains a usable rollback/manual execution path. Running Mac and Ubuntu watchers together can race on the same DB queue.

Development history, major issues, and before/after watcher state are recorded in:

```text
docs/automation-development-history.md
```

## Ubuntu Mini PC Runtime

Primary document:

```text
docs/spacecloud-ubuntu-main-pc.md
```

Important Ubuntu-side paths:

```text
/home/kiosk-j/Rhythmjoy_calendar
/home/kiosk-j/.spacecloud-automation
/home/kiosk-j/.rhythmjoy-ingestion.env
/home/kiosk-j/.ssh/swingenjoy_cafe24_ed25519
/home/kiosk-j/rhythmjoy-logs/spacecloud-watch
/home/kiosk-j/bin/rhythmjoy-sync-logs-to-cafe24.sh
```

Important user services on Ubuntu:

```text
rhythmjoy-spacecloud-watch.service
kiosk-chrome.service
rhythmjoy-reverse-ssh.service
rhythmjoy-log-sync.timer
```

Expected status:

```text
rhythmjoy-spacecloud-watch.service active + enabled
kiosk-chrome.service active + enabled
rhythmjoy-reverse-ssh.service active + enabled
rhythmjoy-log-sync.timer active + enabled
loginctl linger for kiosk-j = yes
```

## Remote Control Path

The mini PC does not expose SSH publicly. It keeps an outbound reverse SSH tunnel to Cafe24:

```text
Ubuntu localhost:22 -> Cafe24 127.0.0.1:22013
```

From Cafe24, connect to the mini PC with:

```bash
ssh -i /root/.ssh/rhythmjoy_ubuntu_control_ed25519 -p 22013 kiosk-j@127.0.0.1
```

The setup script is:

```text
ops/setup-ubuntu-remote-control.sh
```

## Logs And Monitoring

Durable state is in Cafe24 DB:

```text
rhythmjoy_spacecloud_tasks
rhythmjoy_sms_deliveries
email event tables used by ops/rhythmjoy_email_import.py
```

Ubuntu browser runner logs are copied to Cafe24 every 5 minutes:

```text
/home/clown313python/rhythmjoy_ops/runtime/ubuntu-mini-pc
```

Useful synced files:

```text
synced-at.txt
systemd/spacecloud-watch.active
systemd/kiosk-chrome.active
systemd/reverse-ssh.active
spacecloud-watch/launchd.log
spacecloud-watch/runs.jsonl
processes.txt
```

## Login Sessions

Naver and SpaceCloud login sessions are not stored in Git. They live in the Ubuntu Chrome automation profile:

```text
/home/kiosk-j/.spacecloud-automation
```

If a session expires:

1. Cafe24 email ingestion and DB ledger continue to record reservation/cancellation emails.
2. The Ubuntu watcher leaves browser work pending or retryable.
3. Telegram alerts should report that login is required.
4. Open the mini PC remote screen and log in manually.
5. The watcher processes remaining work on the next cycle.

## Mac Rollback

The MacBook is no longer the main watcher. It remains a rollback path only.

To re-enable the Mac watcher from the Mac workspace:

```bash
cd /Users/inteyeo/Rhythmjoy_calendar
bash ops/install-spacecloud-watch.sh
```

Before enabling Mac rollback, stop the Ubuntu watcher:

```bash
systemctl --user disable --now rhythmjoy-spacecloud-watch.service
```

Do not run both watchers at the same time.

## Not Stored In Git

These are intentionally not committed:

```text
private SSH keys
Cafe24 DB/API secrets
Telegram bot token
Aligo API key
Chrome browser cookies/session profile
local .env files with secrets
DB dumps and live reservation/customer data
```

If rebuilding on a new machine, recover secrets from the existing Cafe24/Ubuntu environment or re-create them manually, then re-login to Naver and SpaceCloud.

Use `ops/backup-cafe24-db.sh` on Cafe24 for DB backups. The restore script installs `/etc/cron.d/rhythmjoy-db-backup`, which creates one DB dump per day under `/home/clown313python/rhythmjoy_ops/backups/db` and keeps 30 days by default. Store important dump files in a private backup location outside Git if recovery after total Cafe24 loss is required.
