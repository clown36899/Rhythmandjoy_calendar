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

set -a
# shellcheck disable=SC1090
source "$SERVER_ENV_FILE"
set +a

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
