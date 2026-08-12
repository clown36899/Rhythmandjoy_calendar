#!/usr/bin/env bash
set -euo pipefail

LABEL="com.rhythmjoy.mini-rdp-tunnel"
USER_DOMAIN="gui/$(id -u)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PLIST="$SCRIPT_DIR/$LABEL.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WINDOWS_APP="/Applications/Windows App.app"
LOCAL_HOST="127.0.0.1"
LOCAL_PORT="13389"

if [[ ! -d "$WINDOWS_APP" ]]; then
  echo "Windows App이 설치되어 있지 않습니다: $WINDOWS_APP" >&2
  exit 2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/Rhythmjoy"

needs_reload=0
if [[ ! -f "$TARGET_PLIST" ]] || ! cmp -s "$SOURCE_PLIST" "$TARGET_PLIST"; then
  needs_reload=1
fi

if [[ "$needs_reload" -eq 1 ]]; then
  launchctl bootout "$USER_DOMAIN/$LABEL" 2>/dev/null || true
  install -m 600 "$SOURCE_PLIST" "$TARGET_PLIST"
fi

if ! launchctl print "$USER_DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootstrap "$USER_DOMAIN" "$TARGET_PLIST"
else
  launchctl kickstart -k "$USER_DOMAIN/$LABEL"
fi
launchctl enable "$USER_DOMAIN/$LABEL"

connected=0
for _ in {1..30}; do
  if nc -z "$LOCAL_HOST" "$LOCAL_PORT" >/dev/null 2>&1; then
    connected=1
    break
  fi
  sleep 0.5
done

if [[ "$connected" -ne 1 ]]; then
  echo "미니PC RDP 터널을 열지 못했습니다." >&2
  echo "오류 로그: $HOME/Library/Logs/Rhythmjoy/mini-rdp-tunnel-error.log" >&2
  tail -n 20 "$HOME/Library/Logs/Rhythmjoy/mini-rdp-tunnel-error.log" >&2 || true
  exit 1
fi

if [[ "${1:-}" == "--copy-password" ]]; then
  rdp_password="$(security find-generic-password \
    -a "rhythmjoy-remote" \
    -s "Rhythmjoy Mini PC RDP" \
    -w)"
  printf '%s' "$rdp_password" | pbcopy
  unset rdp_password
  echo "RDP 암호를 클립보드에 복사했습니다."
fi

open -a "Windows App"
echo "미니PC 터널 정상: $LOCAL_HOST:$LOCAL_PORT"
echo "Windows App에서 'Rhythmjoy Mini PC'를 여세요."
