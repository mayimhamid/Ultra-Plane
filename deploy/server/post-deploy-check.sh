#!/usr/bin/env bash
# Checks that the running Plane containers got the settings of plane.env, and fails loudly if not.
#
#   ./post-deploy-check.sh
#
# For the api, worker and beat-worker containers it checks that WEB_URL is set, does not point to localhost, and
# is the WEB_URL of plane.env, and that CORS_ALLOWED_ORIGINS equals the one of plane.env. Only these two
# (non-secret) values are ever printed. Exit code 0 = fine, 1 = a container has the wrong settings, 2 = cannot check.
# PLANE_ALLOW_LOCALHOST=1 accepts a WEB_URL with localhost (a development stack).

set -uo pipefail

DIR="${PLANE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$DIR" || exit 2

if [ ! -f plane.env ]; then
  echo "post-deploy-check: $DIR/plane.env is missing, cannot tell what the settings should be." >&2
  exit 2
fi

# A value of plane.env, without surrounding quotes.
env_value() {
  grep -E "^$1=" plane.env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

expected_web="$(env_value WEB_URL)"
expected_cors="$(env_value CORS_ALLOWED_ORIGINS)"
if [ -z "$expected_web" ]; then
  echo "post-deploy-check: plane.env has no WEB_URL." >&2
  exit 2
fi

failed=0
problem() {
  echo "  FAIL  $1" >&2
  failed=1
}

for service in api worker beat-worker; do
  container="$(docker compose -f docker-compose.yaml --env-file plane.env ps -q "$service" 2>/dev/null | head -1)"
  if [ -z "$container" ]; then
    problem "$service: no running container found"
    continue
  fi
  web="$(docker exec "$container" printenv WEB_URL 2>/dev/null || true)"
  cors="$(docker exec "$container" printenv CORS_ALLOWED_ORIGINS 2>/dev/null || true)"

  if [ -z "$web" ]; then
    problem "$service: WEB_URL is empty"
  elif [ "${PLANE_ALLOW_LOCALHOST:-0}" != 1 ] && [[ "$web" == *localhost* || "$web" == *127.0.0.1* ]]; then
    problem "$service: WEB_URL is '$web' (localhost); invite links, redirects and emails would point to the wrong place"
  elif [ "$web" != "$expected_web" ]; then
    problem "$service: WEB_URL is '$web', plane.env says '$expected_web'"
  fi

  if [ "$cors" != "$expected_cors" ]; then
    problem "$service: CORS_ALLOWED_ORIGINS is '${cors:-<empty>}', plane.env says '${expected_cors:-<empty>}'"
  fi
done

if [ "$failed" -ne 0 ]; then
  cat >&2 <<EOF

post-deploy-check: FAILED. A container was started without plane.env (compose only reads plane.env when it is
passed with --env-file). Recreate the services with the wrapper, which always passes it:

  cd $DIR && ./plane-compose.sh up -d --force-recreate api worker beat-worker web admin space live

EOF
  exit 1
fi

echo "post-deploy-check: OK (api, worker and beat-worker use the settings of plane.env; WEB_URL=$expected_web)"
