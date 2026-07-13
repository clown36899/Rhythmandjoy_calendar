#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ENV="${TARGET_ENV:-$REPO_ROOT/ops/cafe24-production-target.env}"

if [[ -r "$TARGET_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$TARGET_ENV"
fi

SERVER_ENV_FILE="${SERVER_ENV_FILE:-/home/clown313python/myapp/.env}"
BACKUP_DIR="${BACKUP_DIR:-/home/clown313python/rhythmjoy_ops/backups/db}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-$(command -v mysqldump || true)}"

if [[ -z "$MYSQLDUMP_BIN" ]]; then
  echo "mysqldump not found" >&2
  exit 2
fi

if [[ ! -r "$SERVER_ENV_FILE" ]]; then
  echo "Missing server env file: $SERVER_ENV_FILE" >&2
  exit 2
fi

read_env_value() {
  local key="$1"
  awk -v key="$key" '
    function trim(s) {
      sub(/^[[:space:]]+/, "", s)
      sub(/[[:space:]]+$/, "", s)
      return s
    }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ /^[[:space:]]*$/ || line ~ /^[[:space:]]*#/) {
        next
      }
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      eq = index(line, "=")
      if (eq == 0) {
        next
      }
      k = trim(substr(line, 1, eq - 1))
      if (k != key) {
        next
      }
      v = trim(substr(line, eq + 1))
      quote = sprintf("%c", 39)
      if ((substr(v, 1, 1) == "\"" && substr(v, length(v), 1) == "\"") ||
          (substr(v, 1, 1) == quote && substr(v, length(v), 1) == quote)) {
        v = substr(v, 2, length(v) - 2)
      }
      print v
      exit
    }
  ' "$SERVER_ENV_FILE"
}

for env_name in DB_SERVERNAME DB_USERNAME DB_PASSWORD DB_NAME DB_PORT; do
  if [[ -z "${!env_name:-}" ]]; then
    env_value="$(read_env_value "$env_name")"
    if [[ -n "$env_value" ]]; then
      printf -v "$env_name" '%s' "$env_value"
      export "$env_name"
    fi
  fi
done

for required in DB_SERVERNAME DB_USERNAME DB_PASSWORD DB_NAME; do
  if [[ -z "${!required:-}" ]]; then
    echo "Missing required DB env: $required" >&2
    exit 2
  fi
done

DB_PORT="${DB_PORT:-3306}"
install -d -m 0700 "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/${DB_NAME}-${timestamp}.sql.gz"
tmp_cnf="$(mktemp)"
trap 'rm -f "$tmp_cnf"' EXIT

chmod 0600 "$tmp_cnf"
cat > "$tmp_cnf" <<CNF
[client]
host=$DB_SERVERNAME
port=$DB_PORT
user=$DB_USERNAME
password=$DB_PASSWORD
default-character-set=utf8mb4
CNF

"$MYSQLDUMP_BIN" \
  --defaults-extra-file="$tmp_cnf" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  "$DB_NAME" | gzip -9 > "$out"

chmod 0600 "$out"
sha256sum "$out" > "$out.sha256"
chmod 0600 "$out.sha256"

find "$BACKUP_DIR" -type f \( -name "${DB_NAME}-*.sql.gz" -o -name "${DB_NAME}-*.sql.gz.sha256" \) -mtime "+$RETENTION_DAYS" -delete

printf 'created=%s\n' "$out"
