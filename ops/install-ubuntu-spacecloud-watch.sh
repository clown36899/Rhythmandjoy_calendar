#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${SPACE_CLOUD_WATCH_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SERVICE_NAME="${SPACE_CLOUD_WATCH_SERVICE_NAME:-rhythmjoy-spacecloud-watch.service}"
SERVICE_PATH="$HOME/.config/systemd/user/$SERVICE_NAME"
LOG_DIR="${SPACE_CLOUD_WATCH_LOG_DIR:-$HOME/rhythmjoy-logs/spacecloud-watch}"
PROFILE_DIR="${SPACE_CLOUD_WATCH_PROFILE_DIR:-$HOME/.spacecloud-automation}"
ENV_FILE="${SPACE_CLOUD_WATCH_ENV_FILE:-$HOME/.rhythmjoy-ingestion.env}"
INTERVAL_SECONDS="${SPACE_CLOUD_WATCH_INTERVAL_SECONDS:-60}"
LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_LIMIT_PER_CYCLE:-1}"
DELETE_LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_DELETE_LIMIT_PER_CYCLE:-1}"
NAVER_BLOCK_LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_NAVER_BLOCK_LIMIT_PER_CYCLE:-1}"
NAVER_CANCEL_LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_NAVER_CANCEL_LIMIT_PER_CYCLE:-1}"
SPACECLOUD_CANCEL_LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_SPACECLOUD_CANCEL_LIMIT_PER_CYCLE:-1}"
NOW_MODE="${SPACE_CLOUD_WATCH_NOW_MODE:-0}"
URGENT_WINDOW_MINUTES="${SPACE_CLOUD_WATCH_URGENT_WINDOW_MINUTES:-180}"
URGENT_INTERVAL_SECONDS="${SPACE_CLOUD_WATCH_URGENT_INTERVAL_SECONDS:-15}"
URGENT_COOLDOWN_SECONDS="${SPACE_CLOUD_WATCH_URGENT_COOLDOWN_SECONDS:-300}"
RESTORE_GRACE_SECONDS="${SPACE_CLOUD_WATCH_RESTORE_GRACE_SECONDS:-45}"
SESSION_CHECK_INTERVAL_SECONDS="${SPACE_CLOUD_WATCH_SESSION_CHECK_INTERVAL_SECONDS:-180}"
DAILY_RECONCILE_HOUR="${SPACE_CLOUD_WATCH_DAILY_RECONCILE_HOUR:-5}"
ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES="${SPACE_CLOUD_WATCH_ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES:-30}"
ADMIN_PLATFORM_AUDIT_LIMIT="${SPACE_CLOUD_WATCH_ADMIN_PLATFORM_AUDIT_LIMIT:-2}"
CUSTOMER_PLATFORM_AUDIT_INTERVAL_MINUTES="${SPACE_CLOUD_WATCH_CUSTOMER_PLATFORM_AUDIT_INTERVAL_MINUTES:-240}"
CUSTOMER_PLATFORM_AUDIT_LIMIT="${SPACE_CLOUD_WATCH_CUSTOMER_PLATFORM_AUDIT_LIMIT:-1}"
ENABLE_SERVICE="${1:-}"

NODE_BIN="$(command -v node || true)"
XVFB_RUN_BIN="$(command -v xvfb-run || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "node is required. Install nodejs/npm first." >&2
  exit 1
fi

if [[ -z "$XVFB_RUN_BIN" ]]; then
  echo "xvfb-run is required. Install xvfb first." >&2
  exit 1
fi

mkdir -p "$(dirname "$SERVICE_PATH")" "$LOG_DIR" "$PROFILE_DIR"

EXTRA_ARGS=""
if [[ "$NOW_MODE" == "1" ]]; then
  EXTRA_ARGS="--now-mode --urgent-window-minutes $URGENT_WINDOW_MINUTES --urgent-interval-seconds $URGENT_INTERVAL_SECONDS --urgent-cooldown-seconds $URGENT_COOLDOWN_SECONDS --restore-grace-seconds $RESTORE_GRACE_SECONDS --session-check-interval-seconds $SESSION_CHECK_INTERVAL_SECONDS"
fi

cat > "$SERVICE_PATH" <<SERVICE
[Unit]
Description=Rhythmjoy SpaceCloud/Naver automation watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
Environment=HOME=$HOME
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$XVFB_RUN_BIN -a $NODE_BIN $REPO_ROOT/tools/spacecloud-watch.mjs watch --interval-seconds $INTERVAL_SECONDS --limit-per-cycle $LIMIT_PER_CYCLE --delete-limit-per-cycle $DELETE_LIMIT_PER_CYCLE --naver-block-limit-per-cycle $NAVER_BLOCK_LIMIT_PER_CYCLE --naver-cancel-limit-per-cycle $NAVER_CANCEL_LIMIT_PER_CYCLE --spacecloud-cancel-limit-per-cycle $SPACECLOUD_CANCEL_LIMIT_PER_CYCLE $EXTRA_ARGS --daily-reconcile-hour $DAILY_RECONCILE_HOUR --daily-reconcile-state $LOG_DIR/daily-reconcile-state.json --admin-platform-audit-interval-minutes $ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES --admin-platform-audit-limit $ADMIN_PLATFORM_AUDIT_LIMIT --admin-platform-audit-state $LOG_DIR/admin-platform-audit-state.json --customer-platform-audit --customer-platform-audit-interval-minutes $CUSTOMER_PLATFORM_AUDIT_INTERVAL_MINUTES --customer-platform-audit-limit $CUSTOMER_PLATFORM_AUDIT_LIMIT --customer-platform-audit-state $LOG_DIR/customer-platform-audit-state.json --no-reflection-audit --env-file $ENV_FILE --profile-dir $PROFILE_DIR --work-dir $LOG_DIR
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload

if [[ "$ENABLE_SERVICE" == "--enable" ]]; then
  systemctl --user enable --now "$SERVICE_NAME"
else
  echo "Service installed but not enabled: $SERVICE_NAME"
  echo "Enable after Naver and SpaceCloud login are confirmed:"
  echo "  systemctl --user enable --now $SERVICE_NAME"
fi

systemctl --user status "$SERVICE_NAME" --no-pager || true
