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

require_exact_targets() {
    [[ "$LOCAL_REPO" == "/Users/inteyeo/Rhythmjoy_calendar" ]] || {
        echo "Unexpected LOCAL_REPO: $LOCAL_REPO" >&2
        exit 1
    }
    [[ "$REPO_ROOT" == "$LOCAL_REPO" ]] || {
        echo "Run this from the Rhythmjoy calendar repository: $LOCAL_REPO" >&2
        echo "Current repository root: $REPO_ROOT" >&2
        exit 1
    }
    [[ "$APP_ROOT" == "/home/clown313python/myapp" ]] || {
        echo "Unexpected APP_ROOT: $APP_ROOT" >&2
        exit 1
    }
    [[ "$OPS_ROOT" == "/home/clown313python/rhythmjoy_ops" ]] || {
        echo "Unexpected OPS_ROOT: $OPS_ROOT" >&2
        exit 1
    }
    [[ "$REMOTE_RELEASE_DIR" == "$OPS_ROOT/"* ]] || {
        echo "REMOTE_RELEASE_DIR must stay under OPS_ROOT: $REMOTE_RELEASE_DIR" >&2
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

    abort_for_forbidden_target "LOCAL_REPO" "$LOCAL_REPO"
    abort_for_forbidden_target "APP_ROOT" "$APP_ROOT"
    abort_for_forbidden_target "OPS_ROOT" "$OPS_ROOT"
    abort_for_forbidden_target "REMOTE_RELEASE_DIR" "$REMOTE_RELEASE_DIR"
    abort_for_forbidden_target "APACHE_CONF_DIR" "$APACHE_CONF_DIR"
    abort_for_forbidden_target "CACHE_SERVICE" "$CACHE_SERVICE"
}

remote_quote() {
    printf "%q" "$1"
}

for required in VPS_HOSTNAME SSH_TARGET SSH_KEY LOCAL_REPO APP_ROOT OPS_ROOT REMOTE_RELEASE_DIR APACHE_CONF_DIR CACHE_SERVICE; do
    require_var "$required"
done
require_exact_targets

if [[ ! -r "$SSH_KEY" ]]; then
    echo "SSH key not readable: $SSH_KEY" >&2
    exit 1
fi

ssh_opts=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

remote_hostnames="$(
    ssh "${ssh_opts[@]}" "$SSH_TARGET" 'printf "%s\n" "$(hostname 2>/dev/null || true)" "$(hostname -f 2>/dev/null || true)"' \
        | awk 'NF { print }'
)"
if ! grep -Fxq "$VPS_HOSTNAME" <<<"$remote_hostnames"; then
    echo "Wrong remote host. Expected $VPS_HOSTNAME, got:" >&2
    echo "$remote_hostnames" >&2
    exit 1
fi

ssh "${ssh_opts[@]}" "$SSH_TARGET" "install -d $(remote_quote "$REMOTE_RELEASE_DIR")"
rsync -az --delete \
    -e "ssh -i $(remote_quote "$SSH_KEY") -o IdentitiesOnly=yes" \
    --exclude='.git/' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='.DS_Store' \
    --exclude='.claude/' \
    --exclude='.codex/' \
    --exclude='.playwright-mcp/' \
    --exclude='.vscode/sftp.json' \
    --exclude='www/.vscode/' \
    --exclude='static/rhythmjoycalendar-*.json' \
    --exclude='www/calendar_set/calendar_v10/data/*.json' \
    --exclude='flask_session/' \
    --exclude='uploads/' \
    "$REPO_ROOT/" "$SSH_TARGET:$REMOTE_RELEASE_DIR/"

ssh "${ssh_opts[@]}" "$SSH_TARGET" \
    "TARGET_ENV=$(remote_quote "$REMOTE_RELEASE_DIR/ops/cafe24-production-target.env") bash $(remote_quote "$REMOTE_RELEASE_DIR/ops/restore-cafe24.sh")"
