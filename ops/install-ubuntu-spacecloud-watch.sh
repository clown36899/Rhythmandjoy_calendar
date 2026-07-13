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
ExecStart=$XVFB_RUN_BIN -a $NODE_BIN $REPO_ROOT/tools/spacecloud-watch.mjs watch --interval-seconds $INTERVAL_SECONDS --limit-per-cycle $LIMIT_PER_CYCLE --delete-limit-per-cycle $DELETE_LIMIT_PER_CYCLE --naver-block-limit-per-cycle $NAVER_BLOCK_LIMIT_PER_CYCLE --env-file $ENV_FILE --profile-dir $PROFILE_DIR --work-dir $LOG_DIR
Restart=always
RestartSec=10
StandardOutput=append:$LOG_DIR/launchd.log
StandardError=append:$LOG_DIR/launchd.log

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
