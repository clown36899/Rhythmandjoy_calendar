#!/bin/bash
set -euo pipefail

REPO_ROOT="${SPACE_CLOUD_WATCH_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LABEL="com.rhythmjoy.spacecloud-watch"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$REPO_ROOT/state/spacecloud-watch"
INTERVAL_SECONDS="${SPACE_CLOUD_WATCH_INTERVAL_SECONDS:-30}"
LIMIT_PER_CYCLE="${SPACE_CLOUD_WATCH_LIMIT_PER_CYCLE:-3}"

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
        <string>cd "$REPO_ROOT" &amp;&amp; NODE_BIN="\$(command -v node)" &amp;&amp; exec "\$NODE_BIN" tools/spacecloud-watch.mjs watch --interval-seconds $INTERVAL_SECONDS --limit-per-cycle $LIMIT_PER_CYCLE</string>
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
