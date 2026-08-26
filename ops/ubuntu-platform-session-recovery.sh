#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${RHYTHMJOY_REPO_ROOT:-/home/kiosk-j/Rhythmjoy_calendar}"
PROFILE_DIR="${RHYTHMJOY_AUTOMATION_PROFILE:-/home/kiosk-j/.spacecloud-automation}"
WORK_DIR="${RHYTHMJOY_AUTOMATION_WORK_DIR:-/home/kiosk-j/rhythmjoy-logs/spacecloud-watch}"
ENV_FILE="${RHYTHMJOY_AUTOMATION_ENV_FILE:-/home/kiosk-j/.rhythmjoy-ingestion.env}"
WATCHER_SERVICE="${RHYTHMJOY_WATCHER_SERVICE:-rhythmjoy-spacecloud-watch.service}"
KIOSK_SERVICE="${RHYTHMJOY_KIOSK_SERVICE:-kiosk-chrome.service}"

cd "$REPO_ROOT"

# A persistent Chromium profile can only have one owner. Keep all background
# browsers stopped for the entire human login and verification transaction.
systemctl --user stop "$WATCHER_SERVICE" "$KIOSK_SERVICE"

echo "platform session recovery started"
echo "manual login window will close only after both platforms are ready"

node tools/spacecloud-watch.mjs login \
  --profile-dir "$PROFILE_DIR" \
  --work-dir "$WORK_DIR" \
  --env-file "$ENV_FILE" \
  --no-telegram

# Reopen the saved profile and verify both sites through authenticated platform
# responses. A timeout or page observation alone must never prove readiness.
node tools/spacecloud-watch.mjs check-sessions \
  --profile-dir "$PROFILE_DIR" \
  --work-dir "$WORK_DIR" \
  --env-file "$ENV_FILE" \
  --no-telegram \
  --json

# Force the watcher to re-read both sessions immediately instead of retaining
# a cached login_required result for its normal three-minute interval.
rm -f "$WORK_DIR/session-check-state.json"
systemctl --user reset-failed "$WATCHER_SERVICE" "$KIOSK_SERVICE" 2>/dev/null || true
systemctl --user start "$WATCHER_SERVICE" "$KIOSK_SERVICE"

echo "platform session recovery verified; watcher and kiosk restarted"
