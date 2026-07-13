#!/usr/bin/env bash
set -euo pipefail

CAFE24_IP="${CAFE24_IP:-1.234.23.64}"
CAFE24_USER="${CAFE24_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22013}"
REMOTE_LOG_DIR="${REMOTE_LOG_DIR:-/home/clown313python/rhythmjoy_ops/runtime/ubuntu-mini-pc}"
CAFE24_KEY="${CAFE24_KEY:-/home/kiosk-j/.ssh/swingenjoy_cafe24_ed25519}"
CONTROL_PUB_KEY="${CAFE24_CONTROL_PUB_KEY:-}"

if [[ -z "$CONTROL_PUB_KEY" ]]; then
  echo "CAFE24_CONTROL_PUB_KEY is required" >&2
  exit 2
fi

mkdir -p "$HOME/.ssh" "$HOME/bin" "$HOME/rhythmjoy-logs/log-sync" "$HOME/.config/systemd/user"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
grep -qxF "$CONTROL_PUB_KEY" "$HOME/.ssh/authorized_keys" || printf '%s\n' "$CONTROL_PUB_KEY" >> "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"

cat > "$HOME/.config/systemd/user/rhythmjoy-reverse-ssh.service" <<SERVICE
[Unit]
Description=Rhythmjoy reverse SSH tunnel to Cafe24 for remote control
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -NT -i $CAFE24_KEY -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -R 127.0.0.1:$REMOTE_PORT:127.0.0.1:22 $CAFE24_USER@$CAFE24_IP
Restart=always
RestartSec=10
StandardOutput=append:$HOME/rhythmjoy-logs/log-sync/reverse-ssh.log
StandardError=append:$HOME/rhythmjoy-logs/log-sync/reverse-ssh.log

[Install]
WantedBy=default.target
SERVICE

cat > "$HOME/bin/rhythmjoy-sync-logs-to-cafe24.sh" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail

KEY="$CAFE24_KEY"
REMOTE="$CAFE24_USER@$CAFE24_IP"
REMOTE_DIR="$REMOTE_LOG_DIR"
LOG_DIR="\$HOME/rhythmjoy-logs"
TMP=\$(mktemp -d)
trap 'rm -rf "\$TMP"' EXIT

mkdir -p "\$TMP/spacecloud-watch" "\$TMP/systemd"
date -Is > "\$TMP/synced-at.txt"
hostname > "\$TMP/hostname.txt"

(systemctl --user is-active rhythmjoy-spacecloud-watch.service || true) > "\$TMP/systemd/spacecloud-watch.active"
(systemctl --user is-active kiosk-chrome.service || true) > "\$TMP/systemd/kiosk-chrome.active"
(systemctl --user is-active rhythmjoy-reverse-ssh.service || true) > "\$TMP/systemd/reverse-ssh.active"
(systemctl --user status rhythmjoy-spacecloud-watch.service --no-pager -l || true) > "\$TMP/systemd/spacecloud-watch.status"
(systemctl --user status kiosk-chrome.service --no-pager -l || true) > "\$TMP/systemd/kiosk-chrome.status"
(systemctl --user status rhythmjoy-reverse-ssh.service --no-pager -l || true) > "\$TMP/systemd/reverse-ssh.status"

for file in launchd.log runs.jsonl notify-state.json; do
  if [[ -f "\$LOG_DIR/spacecloud-watch/\$file" ]]; then
    cp -a "\$LOG_DIR/spacecloud-watch/\$file" "\$TMP/spacecloud-watch/\$file"
  fi
done

ps -u "\$(id -u)" -o pid,ppid,%cpu,%mem,etime,stat,command > "\$TMP/processes.txt"

tar -C "\$TMP" -czf - . | /usr/bin/ssh -i "\$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 "\$REMOTE" "mkdir -p '\$REMOTE_DIR' && tar -C '\$REMOTE_DIR' -xzf -"
SCRIPT
chmod 755 "$HOME/bin/rhythmjoy-sync-logs-to-cafe24.sh"

cat > "$HOME/.config/systemd/user/rhythmjoy-log-sync.service" <<SERVICE
[Unit]
Description=Sync Rhythmjoy mini PC logs to Cafe24
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$HOME/bin/rhythmjoy-sync-logs-to-cafe24.sh
StandardOutput=append:$HOME/rhythmjoy-logs/log-sync/log-sync.log
StandardError=append:$HOME/rhythmjoy-logs/log-sync/log-sync.log
SERVICE

cat > "$HOME/.config/systemd/user/rhythmjoy-log-sync.timer" <<TIMER
[Unit]
Description=Run Rhythmjoy mini PC log sync every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true
Unit=rhythmjoy-log-sync.service

[Install]
WantedBy=timers.target
TIMER

systemctl --user daemon-reload
systemctl --user reset-failed rhythmjoy-log-sync.service rhythmjoy-reverse-ssh.service 2>/dev/null || true
systemctl --user enable --now rhythmjoy-reverse-ssh.service
systemctl --user enable --now rhythmjoy-log-sync.timer
systemctl --user start rhythmjoy-log-sync.service

printf 'reverse=%s\n' "$(systemctl --user is-active rhythmjoy-reverse-ssh.service || true)"
printf 'log_timer=%s\n' "$(systemctl --user is-active rhythmjoy-log-sync.timer || true)"
printf 'watcher=%s\n' "$(systemctl --user is-active rhythmjoy-spacecloud-watch.service || true)"
