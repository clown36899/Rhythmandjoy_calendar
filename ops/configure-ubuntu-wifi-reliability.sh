#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---check}"
if [[ "$MODE" != "--check" && "$MODE" != "--apply" ]]; then
  echo "Usage: $0 [--check|--apply]" >&2
  exit 64
fi

NMCLI_BIN="${RHYTHMJOY_NMCLI_BIN:-$(command -v nmcli || true)}"
IWCONFIG_BIN="${RHYTHMJOY_IWCONFIG_BIN:-$(command -v iwconfig || true)}"

if [[ -z "$NMCLI_BIN" ]]; then
  echo "nmcli is required on the Ubuntu automation host" >&2
  exit 69
fi

WIFI_DEVICE="$($NMCLI_BIN -t -f DEVICE,TYPE,STATE device status \
  | awk -F: '$2 == "wifi" && $3 == "connected" { print $1; exit }')"
if [[ -z "$WIFI_DEVICE" ]]; then
  echo "no connected Wi-Fi device found" >&2
  exit 69
fi

WIFI_CONNECTION="$($NMCLI_BIN -g GENERAL.CONNECTION device show "$WIFI_DEVICE")"
if [[ -z "$WIFI_CONNECTION" || "$WIFI_CONNECTION" == "--" ]]; then
  echo "no active NetworkManager connection found for $WIFI_DEVICE" >&2
  exit 69
fi

profile_power_save() {
  $NMCLI_BIN -g 802-11-wireless.powersave connection show "$WIFI_CONNECTION"
}

runtime_power_save() {
  if [[ -z "$IWCONFIG_BIN" ]]; then
    echo "unknown"
    return
  fi
  local output
  output="$($IWCONFIG_BIN "$WIFI_DEVICE" 2>/dev/null || true)"
  if grep -qi 'Power Management:off' <<<"$output"; then
    echo "off"
  elif grep -qi 'Power Management:on' <<<"$output"; then
    echo "on"
  else
    echo "unknown"
  fi
}

profile_is_disabled() {
  local value
  value="$(profile_power_save)"
  [[ "$value" == "2" || "$value" == *"disable"* ]]
}

print_status() {
  printf 'wifi_device=%s\n' "$WIFI_DEVICE"
  printf 'wifi_connection=%s\n' "$WIFI_CONNECTION"
  printf 'profile_power_save=%s\n' "$(profile_power_save)"
  printf 'runtime_power_save=%s\n' "$(runtime_power_save)"
}

if [[ "$MODE" == "--check" ]]; then
  print_status
  if profile_is_disabled && [[ "$(runtime_power_save)" != "on" ]]; then
    exit 0
  fi
  echo "Wi-Fi power saving is still enabled; run this script with --apply from the Ubuntu desktop or with sudo." >&2
  exit 2
fi

$NMCLI_BIN connection modify "$WIFI_CONNECTION" 802-11-wireless.powersave 2

# Reapply changes without intentionally dropping the only network path. If the
# active driver cannot reapply this property, keep the persistent profile fix
# and make the operator perform one controlled reconnect locally.
if ! $NMCLI_BIN device reapply "$WIFI_DEVICE"; then
  print_status
  echo "persistent power-save disable is saved, but the live device could not be reapplied; reconnect Wi-Fi once from the Ubuntu desktop" >&2
  exit 3
fi

print_status
if ! profile_is_disabled || [[ "$(runtime_power_save)" == "on" ]]; then
  echo "Wi-Fi power saving did not turn off; run with sudo and inspect NetworkManager policy" >&2
  exit 3
fi

echo "Wi-Fi power saving is disabled persistently and on the live device"
