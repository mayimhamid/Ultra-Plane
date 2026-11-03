#!/usr/bin/env bash
# Runs `docker compose` for the Plane stack on the server, always with its settings file.
#
# Why: `docker compose` reads a file called `.env` for the ${VARIABLES} of the compose file, not `plane.env`. Run
# without `--env-file plane.env`, a recreated container silently falls back to the defaults in the compose file
# (WEB_URL=http://localhost, empty CORS_ALLOWED_ORIGINS, ...). This wrapper makes that impossible:
#
#   ./plane-compose.sh up -d --force-recreate api worker beat-worker web admin space live
#   ./plane-compose.sh ps
#   ./plane-compose.sh logs --tail 50 api
#
# It refuses to run when plane.env is missing, refuses `down -v` (that would delete the data volumes), and after
# `up`, `restart` or `start` it runs ./post-deploy-check.sh and fails loudly if the running containers have the
# wrong settings. Set PLANE_DIR to use it from another directory, PLANE_SKIP_CHECK=1 to skip the check.

set -uo pipefail

DIR="${PLANE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$DIR" || exit 2

if [ ! -f plane.env ]; then
  echo "plane-compose: $DIR/plane.env is missing, refusing to run without the settings file." >&2
  exit 2
fi
if [ ! -f docker-compose.yaml ]; then
  echo "plane-compose: $DIR/docker-compose.yaml is missing." >&2
  exit 2
fi

# The first word that is the compose command (skipping the options that take a value).
subcommand=""
skip_next=0
for arg in "$@"; do
  if [ "$skip_next" = 1 ]; then
    skip_next=0
    continue
  fi
  case "$arg" in
    -p | --project-name | -f | --file | --env-file | --profile | --project-directory) skip_next=1 ;;
    -*) ;;
    *)
      subcommand="$arg"
      break
      ;;
  esac
done

if [ "$subcommand" = "down" ]; then
  for arg in "$@"; do
    case "$arg" in
      -v | --volumes)
        echo "plane-compose: refusing 'down -v': it deletes the database and upload volumes." >&2
        exit 2
        ;;
    esac
  done
fi

docker compose -f docker-compose.yaml --env-file plane.env "$@"
status=$?

case "$subcommand" in
  up | restart | start)
    if [ "$status" -eq 0 ] && [ "${PLANE_SKIP_CHECK:-0}" != 1 ] && [ -f ./post-deploy-check.sh ]; then
      bash ./post-deploy-check.sh || status=$?
    fi
    ;;
esac

exit "$status"
