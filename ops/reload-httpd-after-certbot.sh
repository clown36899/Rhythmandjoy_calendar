#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_ENV="${TARGET_ENV:-$SCRIPT_DIR/cafe24-production-target.env}"

if [[ ! -r "$TARGET_ENV" && -r /home/clown313python/rhythmjoy_ops/cafe24-production-target.env ]]; then
    TARGET_ENV="/home/clown313python/rhythmjoy_ops/cafe24-production-target.env"
fi

if [[ ! -r "$TARGET_ENV" ]]; then
    echo "Missing canonical target file: $TARGET_ENV" >&2
    exit 1
fi

# shellcheck source=/dev/null
source "$TARGET_ENV"

actual_hostname="$(hostname 2>/dev/null || true)"
actual_fqdn="$(hostname -f 2>/dev/null || true)"
if [[ "$actual_hostname" != "$VPS_HOSTNAME" && "$actual_fqdn" != "$VPS_HOSTNAME" ]]; then
    echo "Wrong host. Expected $VPS_HOSTNAME, got hostname=$actual_hostname fqdn=$actual_fqdn" >&2
    exit 1
fi

for value in "${APACHE_CONF_DIR:-}" "${CACHE_SERVICE:-}"; do
    case "$value" in
        *"/opt/swingenjoy"*|*"swingenjoy.service"*|*"swingenjoy-http.conf"*|*"swingenjoy-http-le-ssl.conf"*|*"127.0.0.1:3001"*)
            echo "Refusing to reload while configured for the separate swingenjoy project: $value" >&2
            exit 1
            ;;
    esac
done

[[ "${APACHE_CONF_DIR:-}" == "/etc/httpd/conf.d" ]] || {
    echo "Unexpected APACHE_CONF_DIR: ${APACHE_CONF_DIR:-}" >&2
    exit 1
}

systemctl reload httpd
