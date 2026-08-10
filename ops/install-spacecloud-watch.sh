#!/bin/bash
set -euo pipefail

REPO_ROOT="${SPACE_CLOUD_WATCH_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LABEL="com.rhythmjoy.spacecloud-watch"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$REPO_ROOT/state/spacecloud-watch"
INTERVAL_SECONDS="${SPACE_CLOUD_WATCH_INTERVAL_SECONDS:-30}"
LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_LIMIT_PER_CYCLE:-3}"
DELETE_LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_DELETE_LIMIT_PER_CYCLE:-2}"
NAVER_BLOCK_LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_NAVER_BLOCK_LIMIT_PER_CYCLE:-2}"
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

EXTRA_ARGS=""
if [[ "$NOW_MODE" == "1" ]]; then
  EXTRA_ARGS="--now-mode --urgent-window-minutes $URGENT_WINDOW_MINUTES --urgent-interval-seconds $URGENT_INTERVAL_SECONDS --urgent-cooldown-seconds $URGENT_COOLDOWN_SECONDS --restore-grace-seconds $RESTORE_GRACE_SECONDS --session-check-interval-seconds $SESSION_CHECK_INTERVAL_SECONDS"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-lc</string>
        <string>cd "$REPO_ROOT" &amp;&amp; NODE_BIN="\$(command -v node)" &amp;&amp; exec "\$NODE_BIN" tools/spacecloud-watch.mjs watch --interval-seconds $INTERVAL_SECONDS --limit-per-cycle $LIMIT_PER_CYCLE --delete-limit-per-cycle $DELETE_LIMIT_PER_CYCLE --naver-block-limit-per-cycle $NAVER_BLOCK_LIMIT_PER_CYCLE --naver-cancel-limit-per-cycle $NAVER_CANCEL_LIMIT_PER_CYCLE --spacecloud-cancel-limit-per-cycle $SPACECLOUD_CANCEL_LIMIT_PER_CYCLE $EXTRA_ARGS --daily-reconcile-hour $DAILY_RECONCILE_HOUR --daily-reconcile-state "$LOG_DIR/daily-reconcile-state.json" --admin-platform-audit-interval-minutes $ADMIN_PLATFORM_AUDIT_INTERVAL_MINUTES --admin-platform-audit-limit $ADMIN_PLATFORM_AUDIT_LIMIT --admin-platform-audit-state "$LOG_DIR/admin-platform-audit-state.json"</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/launchd.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST

plutil -lint "$PLIST_PATH"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
for _ in {1..20}; do
    if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl list | grep "$LABEL"
