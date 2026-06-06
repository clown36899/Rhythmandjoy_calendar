# Cafe24 VPS backup and restore

This repository stores the deployable Rhythmjoy calendar site, Cafe24 Apache configuration, systemd loop service, certbot renewal hook, and sanitized Naver email import code.

## What is backed up in Git

- Static calendar site: `www/`
- Google Calendar cache loop: `ops/rhythmjoy_calendar_cache.py`
- systemd service: `ops/rhythmjoy-calendar-cache.service`
- Apache vhosts/static cache/modsecurity config: `ops/*.conf`
- certbot cron and reload hook: `ops/rhythmjoy-certbot.cron`, `ops/reload-httpd-after-certbot.sh`
- Legacy Naver email to Google Calendar import code, sanitized: `ops/naver_booking_googleimport/import_email.py`
- Python package snapshot from Cafe24: `ops/cafe24-requirements.txt`
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
4. Run as root from the repo:

```bash
bash ops/restore-cafe24.sh
```

5. If TLS files are missing, point DNS to the VPS and run certbot for `xn--xy1b23ggrmm5bfb82ees967e.com`.
6. Verify:

```bash
systemctl status rhythmjoy-calendar-cache.service
curl -I https://xn--xy1b23ggrmm5bfb82ees967e.com/
curl -s https://xn--xy1b23ggrmm5bfb82ees967e.com/calendar_set/calendar_v10/data/events.json | head
```

## Current production notes

- Domain root internally serves `/calendar_set/calendar_v10/calendar_10.html`.
- Google Calendar cache interval is 15 seconds.
- Browser-side polling reads the server cache every 15 seconds while the page is visible.
- Git push is backup/history only. Production is updated directly on the Cafe24 VPS unless a separate deployment process is added later.
