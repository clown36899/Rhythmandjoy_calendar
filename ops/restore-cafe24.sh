#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ENV="${TARGET_ENV:-$REPO_ROOT/ops/cafe24-production-target.env}"

if [[ ! -r "$TARGET_ENV" ]]; then
    echo "Missing canonical target file: $TARGET_ENV" >&2
    exit 1
fi

# shellcheck source=/dev/null
source "$TARGET_ENV"

require_var() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        echo "Missing required target setting: $name" >&2
        exit 1
    fi
}

abort_for_forbidden_target() {
    local label="$1"
    local value="$2"
    local forbidden

    for forbidden in \
        "/opt/swingenjoy" \
        "swingenjoy.service" \
        "swingenjoy-http.conf" \
        "swingenjoy-http-le-ssl.conf" \
        "/Users/inteyeo/Rhythmjoy2025555-5" \
        "127.0.0.1:3001"
    do
        if [[ "$value" == *"$forbidden"* ]]; then
            echo "Refusing to touch the separate swingenjoy project via $label=$value" >&2
            exit 1
        fi
    done
}

require_hostname() {
    local actual_hostname
    local actual_fqdn

    actual_hostname="$(hostname 2>/dev/null || true)"
    actual_fqdn="$(hostname -f 2>/dev/null || true)"
    if [[ "$actual_hostname" != "$VPS_HOSTNAME" && "$actual_fqdn" != "$VPS_HOSTNAME" ]]; then
        echo "Wrong host. Expected $VPS_HOSTNAME, got hostname=$actual_hostname fqdn=$actual_fqdn" >&2
        exit 1
    fi
}

require_exact_targets() {
    [[ "$APP_ROOT" == "/home/clown313python/myapp" ]] || {
        echo "Unexpected APP_ROOT: $APP_ROOT" >&2
        exit 1
    }
    [[ "$OPS_ROOT" == "/home/clown313python/rhythmjoy_ops" ]] || {
        echo "Unexpected OPS_ROOT: $OPS_ROOT" >&2
        exit 1
    }
    [[ "$APACHE_CONF_DIR" == "/etc/httpd/conf.d" ]] || {
        echo "Unexpected APACHE_CONF_DIR: $APACHE_CONF_DIR" >&2
        exit 1
    }
    [[ "$CACHE_SERVICE" == "rhythmjoy-calendar-cache.service" ]] || {
        echo "Unexpected CACHE_SERVICE: $CACHE_SERVICE" >&2
        exit 1
    }
    [[ "$LEGACY_EMAIL_SERVICE" == "my_email_service.service" ]] || {
        echo "Unexpected LEGACY_EMAIL_SERVICE: $LEGACY_EMAIL_SERVICE" >&2
        exit 1
    }
    [[ "$APACHE_HTTP_CONF" == "rhythmjoy-domain-http.conf" ]] || {
        echo "Unexpected APACHE_HTTP_CONF: $APACHE_HTTP_CONF" >&2
        exit 1
    }
    [[ "$APACHE_HTTPS_CONF" == "rhythmjoy-domain-ssl.conf" ]] || {
        echo "Unexpected APACHE_HTTPS_CONF: $APACHE_HTTPS_CONF" >&2
        exit 1
    }

    abort_for_forbidden_target "APP_ROOT" "$APP_ROOT"
    abort_for_forbidden_target "OPS_ROOT" "$OPS_ROOT"
    abort_for_forbidden_target "APACHE_CONF_DIR" "$APACHE_CONF_DIR"
    abort_for_forbidden_target "CACHE_SERVICE" "$CACHE_SERVICE"
    abort_for_forbidden_target "LEGACY_EMAIL_SERVICE" "$LEGACY_EMAIL_SERVICE"
    abort_for_forbidden_target "APACHE_HTTP_CONF" "$APACHE_HTTP_CONF"
    abort_for_forbidden_target "APACHE_HTTPS_CONF" "$APACHE_HTTPS_CONF"
}

# Cafe24 currently runs systemd 219, which does not support
# `systemctl show --value`. Keep property parsing compatible with that version
# so a missing CLI option can never silently skip a producer freeze.
systemctl_property() {
    local property="$1"
    local unit="$2"
    local output

    output="$(systemctl show -p "$property" "$unit" 2>/dev/null || true)"
    case "$output" in
        "$property="*)
            printf '%s\n' "${output#*=}"
            ;;
        *)
            printf '%s\n' ""
            ;;
    esac
}

require_unit_inactive() {
    local unit="$1"
    local active_state

    active_state="$(systemctl is-active "$unit" 2>/dev/null || true)"
    case "$active_state" in
        inactive|failed)
            ;;
        *)
            echo "Refusing schema handoff while $unit is ${active_state:-unknown}" >&2
            return 1
            ;;
    esac
}

require_unit_active() {
    local unit="$1"
    local active_state

    active_state="$(systemctl is-active "$unit" 2>/dev/null || true)"
    if [[ "$active_state" != "active" ]]; then
        echo "Restore did not bring $unit back to active state (state=${active_state:-unknown})" >&2
        return 1
    fi
}

# Once the schema/code handoff begins, any later failure must leave both
# Cafe24 writers stopped. The runtime mask also prevents an accidental start
# (including Restart=always or an operator start) until this script reaches
# the verified restart phase or the host reboots.
handoff_freeze_active=0
handoff_succeeded=0

fail_closed_on_restore_exit() {
    local exit_code="$?"

    trap - EXIT
    if [[ "$handoff_freeze_active" == "1" && "$handoff_succeeded" != "1" ]]; then
        systemctl mask --runtime --now "$LEGACY_EMAIL_SERVICE" >/dev/null 2>&1 || true
        systemctl stop httpd >/dev/null 2>&1 || true
        echo "Restore failed; $LEGACY_EMAIL_SERVICE remains runtime-masked and httpd remains stopped." >&2
    fi
    exit "$exit_code"
}

trap fail_closed_on_restore_exit EXIT

install_apache_conf() {
    local source_path="$1"
    local filename

    filename="$(basename "$source_path")"
    case "$filename" in
        rhythmjoy-domain-*.conf|rhythmjoy-calendar-*.conf|clown313python-root-redirect.conf)
            ;;
        *)
            echo "Refusing to manage Apache conf outside the Rhythmjoy allowlist: $filename" >&2
            exit 1
            ;;
    esac

    install -m 0644 "$source_path" "$APACHE_CONF_DIR/$filename"
}

for required in VPS_HOSTNAME APP_ROOT OPS_ROOT APACHE_CONF_DIR CACHE_SERVICE LEGACY_EMAIL_SERVICE APACHE_HTTP_CONF APACHE_HTTPS_CONF SERVER_ENV_FILE PYTHON_BIN; do
    require_var "$required"
done

if [[ "$(id -u)" != "0" ]]; then
    echo "Run as root on the Cafe24 VPS." >&2
    exit 1
fi

require_hostname
require_exact_targets

RHYTHMJOY_ENV_FILE="$SERVER_ENV_FILE" "$PYTHON_BIN" "$REPO_ROOT/ops/rhythmjoy_email_import_selftest.py"
"$PYTHON_BIN" "$REPO_ROOT/ops/rhythmjoy_email_import.py" --event-order-selftest
"$PYTHON_BIN" "$REPO_ROOT/ops/rhythmjoy_ledger_invariant_selftest.py"

# Fail closed during schema/code handoff. A running old importer must not
# update timestamp-only ledger state while the new event-id ordering columns
# are being added and backfilled.
legacy_email_load_state="$(systemctl_property LoadState "$LEGACY_EMAIL_SERVICE")"
case "$legacy_email_load_state" in
    loaded|masked)
        ;;
    *)
        echo "Refusing schema handoff: $LEGACY_EMAIL_SERVICE LoadState is ${legacy_email_load_state:-unknown}" >&2
        exit 1
        ;;
esac

handoff_freeze_active=1
systemctl mask --runtime --now "$LEGACY_EMAIL_SERVICE"
require_unit_inactive "$LEGACY_EMAIL_SERVICE"

install -d "$APP_ROOT" "$OPS_ROOT"
install -d -m 0700 "$OPS_ROOT/backups/db"
install -d -o clown313python -g clown313python "$OPS_ROOT/logs" "$OPS_ROOT/runtime"

# Freeze both Cafe24 producers before schema projection. The Ubuntu browser
# watcher is stopped by the outer deployment runbook before this script runs.
# Keeping Apache down here prevents an old PHP request from writing a
# timestamp-only ledger row between the deterministic replay and code copy.
systemctl stop httpd
require_unit_inactive httpd
RHYTHMJOY_APP_ROOT="$APP_ROOT" \
RHYTHMJOY_OPS_ROOT="$OPS_ROOT" \
RHYTHMJOY_ENV_FILE="$SERVER_ENV_FILE" \
    "$PYTHON_BIN" "$REPO_ROOT/ops/rhythmjoy_email_import.py" --check-config

install -m 0644 "$TARGET_ENV" "$OPS_ROOT/cafe24-production-target.env"
rsync -a --delete \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='static/rhythmjoycalendar-*.json' \
    --exclude='static/email_log/' \
    --exclude='calendar_set/calendar_v10/data/*.json' \
    --exclude='flask_session/' \
    --exclude='uploads/' \
    "$REPO_ROOT/www/" "$APP_ROOT/"

install -d "$APP_ROOT/static/email_log"
chown -R clown313python:clown313python "$APP_ROOT/static/email_log"
install -m 0755 "$REPO_ROOT/ops/rhythmjoy_calendar_cache.py" "$OPS_ROOT/rhythmjoy_calendar_cache.py"
install -m 0755 "$REPO_ROOT/ops/rhythmjoy_email_import.py" "$OPS_ROOT/rhythmjoy_email_import.py"
install -m 0755 "$REPO_ROOT/ops/rhythmjoy_reflection_audit.py" "$OPS_ROOT/rhythmjoy_reflection_audit.py"
install -m 0755 "$REPO_ROOT/ops/aligo_sms.py" "$OPS_ROOT/aligo_sms.py"
install -m 0755 "$REPO_ROOT/ops/backup-cafe24-db.sh" "$OPS_ROOT/backup-cafe24-db.sh"
rm -f "$OPS_ROOT/cafe24_sms.py"
install -d "$APP_ROOT/naver_booking_googleimport"
install -m 0644 "$REPO_ROOT/ops/naver_booking_googleimport/import_email.py" "$APP_ROOT/naver_booking_googleimport/import_email.py"

# Verify the installed importer sees the exact same durable schema before any
# Cafe24 producer is allowed to resume.
RHYTHMJOY_ENV_FILE="$SERVER_ENV_FILE" "$PYTHON_BIN" "$OPS_ROOT/rhythmjoy_email_import.py" --check-config

install -m 0644 "$REPO_ROOT/ops/rhythmjoy-calendar-cache.service" "/etc/systemd/system/$CACHE_SERVICE"
install -m 0644 "$REPO_ROOT/ops/my_email_service.service" "/etc/systemd/system/$LEGACY_EMAIL_SERVICE"
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-reflection-audit.service" /etc/systemd/system/rhythmjoy-reflection-audit.service
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-reflection-audit.timer" /etc/systemd/system/rhythmjoy-reflection-audit.timer
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-logrotate" /etc/logrotate.d/rhythmjoy
install_apache_conf "$REPO_ROOT/ops/clown313python-root-redirect.conf"
install_apache_conf "$REPO_ROOT/ops/rhythmjoy-calendar-modsecurity.conf"
install_apache_conf "$REPO_ROOT/ops/rhythmjoy-calendar-static.conf"
install_apache_conf "$REPO_ROOT/ops/$APACHE_HTTP_CONF"
install_apache_conf "$REPO_ROOT/ops/$APACHE_HTTPS_CONF"
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-certbot.cron" /etc/cron.d/rhythmjoy-certbot
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-db-backup.cron" /etc/cron.d/rhythmjoy-db-backup
install -d /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "$REPO_ROOT/ops/reload-httpd-after-certbot.sh" /etc/letsencrypt/renewal-hooks/deploy/reload-httpd-after-certbot.sh

systemctl daemon-reload
systemctl enable "$CACHE_SERVICE"
systemctl restart "$CACHE_SERVICE"
require_unit_active "$CACHE_SERVICE"
systemctl enable rhythmjoy-reflection-audit.timer
systemctl restart rhythmjoy-reflection-audit.timer
require_unit_active rhythmjoy-reflection-audit.timer
systemctl unmask --runtime "$LEGACY_EMAIL_SERVICE"
systemctl daemon-reload
legacy_email_load_state="$(systemctl_property LoadState "$LEGACY_EMAIL_SERVICE")"
if [[ "$legacy_email_load_state" != "loaded" ]]; then
    echo "Restore could not unmask $LEGACY_EMAIL_SERVICE (LoadState=${legacy_email_load_state:-unknown})" >&2
    exit 1
fi
systemctl reset-failed "$LEGACY_EMAIL_SERVICE" 2>/dev/null || true
systemctl enable "$LEGACY_EMAIL_SERVICE"
systemctl restart "$LEGACY_EMAIL_SERVICE"
require_unit_active "$LEGACY_EMAIL_SERVICE"
logrotate -d /etc/logrotate.d/rhythmjoy >/dev/null 2>&1
httpd -t
systemctl start httpd
systemctl reload httpd
require_unit_active httpd

handoff_succeeded=1
handoff_freeze_active=0
trap - EXIT

cat <<'EOF'
Restore finished.

Secrets are intentionally not restored from Git. Put these files/values back separately:
EOF
cat <<EOF
- $SERVER_ENV_FILE
- $APP_ROOT/static/rhythmjoycalendar-ce0594fe594b.json
EOF
cat <<'EOF'
- NAVER_MAIL_PASSWORD and other private values from ops/env.example
- Let's Encrypt certificates, or rerun certbot after DNS points here
EOF
