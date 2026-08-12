#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_ENV="$SCRIPT_DIR/cafe24-production-target.env"
MINI_KEY="${RHYTHMJOY_MINI_KEY:-$HOME/.ssh/rhythmjoy_minipc_ed25519}"
MINI_TARGET="${RHYTHMJOY_MINI_TARGET:-kiosk-j@127.0.0.1}"
CAFE24_REVERSE_PORT="${RHYTHMJOY_CAFE24_REVERSE_PORT:-22013}"

# shellcheck disable=SC1090
source "$TARGET_ENV"
CAFE24_KEY="${SSH_KEY/\$\{HOME\}/$HOME}"
PROXY_COMMAND="/usr/bin/ssh -i $CAFE24_KEY -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=12 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -W 127.0.0.1:$CAFE24_REVERSE_PORT $SSH_TARGET"

"$SCRIPT_DIR/open-ubuntu-remote-desktop.sh" --copy-password

ssh \
  -i "$MINI_KEY" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ConnectTimeout=12 \
  -o HostKeyAlias=rhythmjoy-mini-via-cafe24 \
  -o "ProxyCommand=$PROXY_COMMAND" \
  "$MINI_TARGET" \
  'set -e
   systemctl --user reset-failed rhythmjoy-platform-session-recovery.service 2>/dev/null || true
   systemctl --user restart rhythmjoy-platform-session-recovery.service --no-block
   for i in $(seq 1 30); do
     state=$(systemctl --user is-active rhythmjoy-platform-session-recovery.service || true)
     case "$state" in active|activating) exit 0;; failed) exit 1;; esac
     sleep 1
   done
   exit 1'

echo "미니PC에 두 플랫폼 순차 로그인 창을 열었습니다."
echo "스페이스클라우드와 네이버 달력이 모두 확인되면 창이 닫히고 워처가 자동 재시작됩니다."
