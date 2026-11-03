#!/usr/bin/env bash
# Deploys the images that the build workflow pushed to ghcr, on the server, in this order:
#
#   1. checks that this directory really is the Plane stack (it refuses to touch anything else)
#   2. backs up the database (pg_dump), the uploads and plane.env, and keeps the last 7 backups
#   3. pulls the new images named in docker-compose.yaml
#   4. runs the migrator; if it fails nothing else is touched and the old services keep running
#   5. recreates the application services and checks them (see post-deploy-check.sh)
#   6. waits until the site answers
#
#   ./deploy.sh            # run from the compose directory, or set PLANE_DIR
#
# It never deletes volumes and never touches the database, Redis, RabbitMQ, MinIO or the proxy containers.
# PLANE_BACKUP_DIR (default ~/plane-backups) is where the backups go.

set -euo pipefail

DIR="${PLANE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$DIR"
compose="bash ./plane-compose.sh"

say() { printf '\n== %s\n' "$*"; }
die() {
  printf '\nDEPLOY FAILED: %s\n' "$*" >&2
  exit 1
}

say "Checking that $DIR is the Plane stack"
[ -f plane.env ] || die "plane.env is missing"
[ -f docker-compose.yaml ] || die "docker-compose.yaml is missing"
[ -f plane-compose.sh ] || die "plane-compose.sh is missing (copy deploy/server/*.sh here)"
grep -q "plane-db" docker-compose.yaml || die "this does not look like the Plane compose file (no plane-db service)"
grep -q "plane-fork" docker-compose.yaml || die "docker-compose.yaml does not use the plane-fork images"

say "Backup"
backups="${PLANE_BACKUP_DIR:-$HOME/plane-backups}"
stamp="$(date -u +%Y%m%d-%H%M%S)"
backup="$backups/$stamp-deploy"
mkdir -p "$backup"
chmod 700 "$backups" "$backup"
$compose exec -T plane-db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > "$backup/plane.dump" < /dev/null || die "the database dump failed"
[ -s "$backup/plane.dump" ] || die "the database dump is empty"
tables="$($compose exec -T plane-db pg_restore -l < "$backup/plane.dump" | grep -c 'TABLE DATA' || true)"
[ "$tables" -gt 50 ] || die "the dump holds only $tables tables, it does not look right"
cp plane.env docker-compose.yaml "$backup/"
# The upload volume belongs to root; best effort, the database is what matters most.
volume="$(docker volume inspect -f '{{.Mountpoint}}' plane_uploads 2>/dev/null || true)"
if [ -n "$volume" ] && sudo -n true 2>/dev/null; then
  sudo -n tar czf "$backup/uploads.tgz" -C "$volume" . 2>/dev/null && sudo -n chown "$(id -u):$(id -g)" "$backup/uploads.tgz" || true
fi
# The image each service runs now, to go back to it if needed.
for service in api web; do
  docker inspect -f '{{.Image}}' "$($compose ps -q "$service" | head -1)" 2>/dev/null | sed "s/^/$service /" >> "$backup/previous-images.txt" || true
done
chmod 600 "$backup"/* 2>/dev/null || true
echo "backup: $backup ($tables tables)"
# keep the last 7 backups of deployments
# shellcheck disable=SC2012
ls -1dt "$backups"/*-deploy 2>/dev/null | tail -n +8 | xargs -r rm -rf

say "Pulling the new images"
images="$($compose config --images | grep '^ghcr.io/' | sort -u)"
[ -n "$images" ] || die "no ghcr.io image found in docker-compose.yaml"
for image in $images; do
  echo "pull $image"
  docker pull -q "$image" > /dev/null || die "could not pull $image"
done

say "Migrations"
PLANE_SKIP_CHECK=1 $compose up -d --force-recreate migrator
migrator="$($compose ps -a -q migrator | head -1)"
[ -n "$migrator" ] || die "the migrator container was not created"
code="$(timeout 900 docker wait "$migrator" || echo 124)"
if [ "$code" != "0" ]; then
  docker logs --tail 40 "$migrator" 2>&1 | sed 's/^/  migrator: /' >&2 || true
  die "the migrations failed (exit $code); the services were not touched and still run the old version. Backup: $backup"
fi
echo "migrations applied"

say "Recreating the services"
$compose up -d --force-recreate api worker beat-worker web admin space live \
  || die "the services did not start cleanly (see the check above). Backup: $backup"

say "Waiting for the site"
port="$(grep -E '^LISTEN_HTTP_PORT=' plane.env | tail -1 | cut -d= -f2- | tr -d '"')"
port="${port:-80}"
ok=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null -m 5 "http://127.0.0.1:$port/api/instances/" && curl -fsS -o /dev/null -m 5 "http://127.0.0.1:$port/"; then
    ok=1
    break
  fi
  sleep 3
done
[ "$ok" = 1 ] || die "the site does not answer on port $port after two minutes. Backup: $backup"

say "Done"
echo "deployed; backup of the data before this deployment: $backup"
