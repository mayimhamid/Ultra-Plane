#!/usr/bin/env bash
# Backup of the Plane stack: database, uploads and the settings files. Meant to run every night from the systemd
# timer (plane-backup.timer) as root; it can be run by hand too.
#
#   plane-backup.sh            make a backup now and delete the ones older than KEEP_DAYS
#   plane-backup.sh verify     restore the newest backup into a scratch database and compare it with the live one
#
# Each backup is a folder <BACKUP_ROOT>/<time>/ with plane.dump (pg_dump -Fc), uploads.tgz, plane.env,
# docker-compose.yaml, web.Caddyfile and SHA256SUMS. It is written as <time>.partial and renamed only when it is
# complete, so a broken run never leaves something that looks like a backup. Nothing is printed from plane.env.
#
# Settings (environment): PLANE_DIR (default /opt/smartfactoryteam/plane), BACKUP_ROOT (default
# /var/backups/smart-factory/plane), KEEP_DAYS (default 14), MIN_FREE_GB (default 5).

set -euo pipefail

plane_dir="${PLANE_DIR:-/opt/smartfactoryteam/plane}"
root="${BACKUP_ROOT:-/var/backups/smart-factory/plane}"
keep_days="${KEEP_DAYS:-14}"
min_free_gb="${MIN_FREE_GB:-5}"
db_container="${DB_CONTAINER:-plane-plane-db-1}"
scratch_db="plane_restore_check"

die() { echo "plane-backup: $*" >&2; exit 1; }

psql_in_db() { # psql_in_db <database> <sql>
  docker exec -i "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$1" -At -v ON_ERROR_STOP=1 -c "$2"' _ "$1" "$2"
}

live_db() { docker exec "$db_container" sh -c 'printf %s "$POSTGRES_DB"'; }

latest_backup() { ls -1d "$root"/[0-9]*-[0-9]* 2>/dev/null | grep -v '\.partial$' | sort | tail -n 1; }

verify() {
  local dir; dir="$(latest_backup)"; [ -n "$dir" ] || die "there is no backup to verify"
  echo "verify: $dir"
  ( cd "$dir" && sha256sum -c --quiet SHA256SUMS ) || die "the checksums of $dir do not match"
  psql_in_db postgres "DROP DATABASE IF EXISTS $scratch_db" >/dev/null
  psql_in_db postgres "CREATE DATABASE $scratch_db" >/dev/null
  trap 'psql_in_db postgres "DROP DATABASE IF EXISTS '"$scratch_db"'" >/dev/null 2>&1 || true' EXIT
  docker exec -i "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d '"$scratch_db"' --no-owner --exit-on-error' < "$dir/plane.dump" \
    || die "the dump of $dir could not be restored"
  local live; live="$(live_db)"
  local bad=0
  for table in users workspaces projects issues tops_notification; do
    local was now
    was="$(psql_in_db "$live" "SELECT count(*) FROM $table" 2>/dev/null || echo "-")"
    now="$(psql_in_db "$scratch_db" "SELECT count(*) FROM $table" 2>/dev/null || echo "-")"
    printf '  %-18s live=%s restored=%s\n' "$table" "$was" "$now"
    [ "$now" != "-" ] || bad=1
  done
  [ "$bad" = 0 ] || die "a table is missing from the restored copy"
  echo "verify: OK (the restored copy was dropped again; counts can differ a little from the live ones if the site was used since the backup)"
}

if [ "${1:-}" = "verify" ]; then verify; exit 0; fi
[ -z "${1:-}" ] || die "unknown argument '$1' (use no argument or 'verify')"

[ -f "$plane_dir/plane.env" ] && [ -f "$plane_dir/docker-compose.yaml" ] || die "$plane_dir is not the Plane directory"
docker inspect "$db_container" >/dev/null 2>&1 || die "the container $db_container does not exist"

mkdir -p "$root"; chmod 700 "$root"
free_gb="$(df -BG --output=avail "$root" | tail -n 1 | tr -dc '0-9')"
[ "${free_gb:-0}" -ge "$min_free_gb" ] || die "only ${free_gb}G free on the backup disk (need $min_free_gb G)"

stamp="$(date +%Y%m%d-%H%M%S)"
work="$root/$stamp.partial"
trap 'rm -rf "$work"' ERR
mkdir -p "$work"; chmod 700 "$work"

docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$work/plane.dump"
[ -s "$work/plane.dump" ] || die "the database dump is empty"
tables="$(docker exec -i "$db_container" pg_restore -l < "$work/plane.dump" | grep -c 'TABLE DATA' || true)"
[ "$tables" -gt 50 ] || die "the dump has only $tables tables; it looks wrong"

volume="$(docker volume inspect -f '{{.Mountpoint}}' plane_uploads 2>/dev/null || true)"
if [ -n "$volume" ] && [ -d "$volume" ]; then
  tar czf "$work/uploads.tgz" -C "$volume" .
else
  echo "plane-backup: the uploads volume was not found; the backup has no uploads.tgz" >&2
fi

cp "$plane_dir/plane.env" "$plane_dir/docker-compose.yaml" "$work/"
[ ! -f "$plane_dir/web.Caddyfile" ] || cp "$plane_dir/web.Caddyfile" "$work/"
chmod 600 "$work"/*
( cd "$work" && sha256sum * > SHA256SUMS )

mv "$work" "$root/$stamp"
trap - ERR
date -u +%FT%TZ > "$root/last-success"
echo "backup: $root/$stamp ($tables tables, $(du -sh "$root/$stamp" | cut -f1))"

# retention: drop backups older than KEEP_DAYS, but always keep the newest three
ls -1d "$root"/[0-9]*-[0-9]* 2>/dev/null | grep -v '\.partial$' | sort | head -n -3 | while read -r old; do
  if [ -n "$(find "$old" -maxdepth 0 -mtime +"$keep_days" -print)" ]; then rm -rf "$old"; echo "removed old backup $old"; fi
done
# a .partial folder from a run that died is removed once it is a day old
find "$root" -maxdepth 1 -name '*.partial' -mtime +1 -exec rm -rf {} + 2>/dev/null || true
