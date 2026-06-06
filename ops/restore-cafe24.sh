#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/clown313python/myapp}"
OPS_ROOT="${OPS_ROOT:-/home/clown313python/rhythmjoy_ops}"
PYTHON_BIN="${PYTHON_BIN:-/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(id -u)" != "0" ]]; then
    echo "Run as root on the Cafe24 VPS." >&2
    exit 1
fi

install -d "$APP_ROOT" "$OPS_ROOT" "$APP_ROOT/static/email_log"
rsync -a --delete \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='static/rhythmjoycalendar-*.json' \
    --exclude='calendar_set/calendar_v10/data/*.json' \
    --exclude='flask_session/' \
    --exclude='uploads/' \
    "$REPO_ROOT/www/" "$APP_ROOT/"

install -m 0755 "$REPO_ROOT/ops/rhythmjoy_calendar_cache.py" "$OPS_ROOT/rhythmjoy_calendar_cache.py"
install -d "$APP_ROOT/naver_booking_googleimport"
install -m 0644 "$REPO_ROOT/ops/naver_booking_googleimport/import_email.py" "$APP_ROOT/naver_booking_googleimport/import_email.py"

install -m 0644 "$REPO_ROOT/ops/rhythmjoy-calendar-cache.service" /etc/systemd/system/rhythmjoy-calendar-cache.service
install -m 0644 "$REPO_ROOT/ops/clown313python-root-redirect.conf" /etc/httpd/conf.d/clown313python-root-redirect.conf
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-calendar-modsecurity.conf" /etc/httpd/conf.d/rhythmjoy-calendar-modsecurity.conf
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-calendar-static.conf" /etc/httpd/conf.d/rhythmjoy-calendar-static.conf
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-domain-http.conf" /etc/httpd/conf.d/rhythmjoy-domain-http.conf
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-domain-ssl.conf" /etc/httpd/conf.d/rhythmjoy-domain-ssl.conf
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-certbot.cron" /etc/cron.d/rhythmjoy-certbot
install -d /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "$REPO_ROOT/ops/reload-httpd-after-certbot.sh" /etc/letsencrypt/renewal-hooks/deploy/reload-httpd-after-certbot.sh

systemctl daemon-reload
systemctl enable --now rhythmjoy-calendar-cache.service
httpd -t
systemctl reload httpd

cat <<'EOF'
Restore finished.

Secrets are intentionally not restored from Git. Put these files/values back separately:
- /home/clown313python/myapp/.env
- /home/clown313python/myapp/static/rhythmjoycalendar-ce0594fe594b.json
- NAVER_MAIL_PASSWORD and other private values from ops/env.example
- Let's Encrypt certificates, or rerun certbot after DNS points here
EOF
