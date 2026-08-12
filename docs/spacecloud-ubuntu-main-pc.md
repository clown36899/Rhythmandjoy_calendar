# Ubuntu Main PC For SpaceCloud/Naver Automation

This document records the Ubuntu mini PC setup used to move the browser automation role away from the Mac.

## Stable Rollback Baseline

Before productized multi-customer sync/admin-panel work, the known working
Ubuntu mini PC automation state was tagged as:

```text
stable/ubuntu-mini-pc-working-20260714
```

Use that tag if the new productized runner work must be abandoned and the
current single-business Rhythmjoy automation needs to be restored.

## Roles

- Cafe24 remains the server/source-of-truth layer: email ingestion, DB ledger, DB-backed public schedule, and Aligo SMS env.
- The Ubuntu mini PC is the browser automation terminal: it reads the DB queue and applies Naver/SpaceCloud UI changes through Chrome/Playwright.
- The Mac setup remains the rollback path. Do not delete the Mac launch agent unless the user explicitly asks.

## Tested Ubuntu Device

- SSH: `kiosk-j@172.30.1.13`
- OS: Ubuntu 24.04
- CPU: Intel Celeron J4005, 2 cores
- RAM: 8 GB
- Disk: about 116 GB root disk, about 94 GB free after setup
- Kiosk Chrome: still runs separately with profile `/home/kiosk-j/.config/kiosk-chrome-profile`
- Automation Chrome profile: `/home/kiosk-j/.spacecloud-automation`
- Remote control tunnel: Ubuntu opens a reverse SSH tunnel to Cafe24 on Cafe24-local `127.0.0.1:22013`

## Installed Packages

The package source was repaired to include `main universe restricted multiverse` for `noble`, `noble-updates`, `noble-backports`, and `noble-security`.

Installed:

- `git`
- `curl`
- `nodejs`
- `npm`
- `xvfb`

Repo-local dependency:

```bash
cd ~/Rhythmjoy_calendar
npm install playwright
```

## Files Required On Ubuntu

```text
/home/kiosk-j/Rhythmjoy_calendar
/home/kiosk-j/.ssh/swingenjoy_cafe24_ed25519
/home/kiosk-j/.ssh/swingenjoy_cafe24_ed25519.pub
/home/kiosk-j/.rhythmjoy-ingestion.env
/home/kiosk-j/.spacecloud-automation
/home/kiosk-j/rhythmjoy-logs/spacecloud-watch
/home/kiosk-j/bin/rhythmjoy-sync-logs-to-cafe24.sh
```

The Cafe24 SSH key is required because `tools/spacecloud-watch.mjs` reads and mutates the server DB queue through SSH scripts.

The local env file is used for Telegram notification settings. Aligo SMS values remain on Cafe24 and are loaded from the server env during SMS sends.

## Validation Commands

Run from the Ubuntu device:

```bash
cd ~/Rhythmjoy_calendar

node tools/spacecloud-watch.mjs notify-test \
  --env-file /home/kiosk-j/.rhythmjoy-ingestion.env \
  --profile-dir /home/kiosk-j/.spacecloud-automation \
  --work-dir /home/kiosk-j/rhythmjoy-logs/spacecloud-watch

node tools/spacecloud-watch.mjs sms-test \
  --to 01048017180 \
  --sms-test-source naver \
  --env-file /home/kiosk-j/.rhythmjoy-ingestion.env \
  --profile-dir /home/kiosk-j/.spacecloud-automation \
  --work-dir /home/kiosk-j/rhythmjoy-logs/spacecloud-watch \
  --json

xvfb-run -a node tools/spacecloud-watch.mjs once \
  --env-file /home/kiosk-j/.rhythmjoy-ingestion.env \
  --profile-dir /home/kiosk-j/.spacecloud-automation \
  --work-dir /home/kiosk-j/rhythmjoy-logs/spacecloud-watch \
  --no-telegram \
  --json
```

## Service

Install the user service without enabling it:

```bash
cd ~/Rhythmjoy_calendar
bash ops/install-ubuntu-spacecloud-watch.sh
```

For SpaceCloud NOW / Naver immediate-booking operation, install the watcher with the faster duplicate-resolution mode:

```bash
cd ~/Rhythmjoy_calendar
SPACE_CLOUD_WATCH_NOW_MODE=1 \
SPACE_CLOUD_WATCH_INTERVAL_SECONDS=30 \
SPACE_CLOUD_WATCH_URGENT_INTERVAL_SECONDS=15 \
SPACE_CLOUD_WATCH_URGENT_COOLDOWN_SECONDS=300 \
SPACE_CLOUD_WATCH_NAVER_BLOCK_LIMIT_PER_CYCLE=2 \
SPACE_CLOUD_WATCH_RESTORE_GRACE_SECONDS=45 \
bash ops/install-ubuntu-spacecloud-watch.sh
```

Enable only after both Naver and SpaceCloud are logged in inside `/home/kiosk-j/.spacecloud-automation`:

```bash
systemctl --user enable --now rhythmjoy-spacecloud-watch.service
```

Check logs:

```bash
journalctl --user -u rhythmjoy-spacecloud-watch.service -n 80 --no-pager
```

Stop Ubuntu automation:

```bash
systemctl --user disable --now rhythmjoy-spacecloud-watch.service
```

## Remote Control Through Cafe24

The mini PC should not expose SSH directly to the public internet. It keeps an outbound reverse tunnel to Cafe24 instead:

```text
Ubuntu localhost:22 -> Cafe24 127.0.0.1:22013
```

Install or repair the tunnel from the Ubuntu device:

```bash
CAFE24_CONTROL_PUB_KEY="$(cat /path/to/cafe24-control-key.pub)" \
  bash ops/setup-ubuntu-remote-control.sh
```

The Cafe24 control key lives on Cafe24 at:

```text
/root/.ssh/rhythmjoy_ubuntu_control_ed25519
```

After the tunnel is up, control the mini PC from Cafe24:

```bash
ssh -i /root/.ssh/rhythmjoy_ubuntu_control_ed25519 \
  -p 22013 \
  kiosk-j@127.0.0.1
```

Check the tunnel and watcher from Cafe24:

```bash
ssh -i /root/.ssh/rhythmjoy_ubuntu_control_ed25519 \
  -p 22013 \
  kiosk-j@127.0.0.1 \
  'systemctl --user is-active rhythmjoy-spacecloud-watch.service; systemctl --user is-active kiosk-chrome.service'
```

Services installed on Ubuntu:

```text
rhythmjoy-reverse-ssh.service
rhythmjoy-log-sync.timer
rhythmjoy-log-sync.service
```

## Logs And Monitoring

The durable work state is on Cafe24:

- `rhythmjoy_spacecloud_tasks`: platform action queue and results
- `rhythmjoy_sms_deliveries`: Aligo SMS delivery records
- email event tables used by the importer: raw reservation/cancellation source records

The detailed browser execution logs are generated on the Ubuntu mini PC, then synced to Cafe24 every 5 minutes under:

```text
/home/clown313python/rhythmjoy_ops/runtime/ubuntu-mini-pc
```

Useful files there:

```text
synced-at.txt
systemd/spacecloud-watch.active
systemd/kiosk-chrome.active
systemd/reverse-ssh.active
spacecloud-watch/watcher-journal.log
spacecloud-watch/runs.jsonl
processes.txt
```

## Mac Rollback

The Mac launch agent is the rollback path. Re-enable it from the Mac repo:

```bash
cd /Users/inteyeo/Rhythmjoy_calendar
bash ops/install-spacecloud-watch.sh
```

Do not run Mac and Ubuntu watchers at the same time after login. They share the same DB queue and can race on the same task.

## Notes

- The Ubuntu watcher should run through `xvfb-run` so the automation browser does not interrupt the kiosk display.
- The watcher interval is 60 seconds and per-cycle limits are set to 1 to keep CPU usage predictable on the J4005.
- Login is still required once on the Ubuntu automation Chrome profile for Naver and SpaceCloud.
