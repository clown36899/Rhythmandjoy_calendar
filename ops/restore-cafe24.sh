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
    abort_for_forbidden_target "APACHE_HTTP_CONF" "$APACHE_HTTP_CONF"
    abort_for_forbidden_target "APACHE_HTTPS_CONF" "$APACHE_HTTPS_CONF"
}

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

for required in VPS_HOSTNAME APP_ROOT OPS_ROOT APACHE_CONF_DIR CACHE_SERVICE APACHE_HTTP_CONF APACHE_HTTPS_CONF SERVER_ENV_FILE PYTHON_BIN; do
    require_var "$required"
done

if [[ "$(id -u)" != "0" ]]; then
    echo "Run as root on the Cafe24 VPS." >&2
    exit 1
fi

require_hostname
require_exact_targets

install -d "$APP_ROOT" "$OPS_ROOT" "$APP_ROOT/static/email_log"
install -m 0644 "$TARGET_ENV" "$OPS_ROOT/cafe24-production-target.env"
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

install -m 0644 "$REPO_ROOT/ops/rhythmjoy-calendar-cache.service" "/etc/systemd/system/$CACHE_SERVICE"
install_apache_conf "$REPO_ROOT/ops/clown313python-root-redirect.conf"
install_apache_conf "$REPO_ROOT/ops/rhythmjoy-calendar-modsecurity.conf"
install_apache_conf "$REPO_ROOT/ops/rhythmjoy-calendar-static.conf"
install_apache_conf "$REPO_ROOT/ops/$APACHE_HTTP_CONF"
install_apache_conf "$REPO_ROOT/ops/$APACHE_HTTPS_CONF"
install -m 0644 "$REPO_ROOT/ops/rhythmjoy-certbot.cron" /etc/cron.d/rhythmjoy-certbot
install -d /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "$REPO_ROOT/ops/reload-httpd-after-certbot.sh" /etc/letsencrypt/renewal-hooks/deploy/reload-httpd-after-certbot.sh

systemctl daemon-reload
systemctl enable --now "$CACHE_SERVICE"
httpd -t
systemctl reload httpd

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
