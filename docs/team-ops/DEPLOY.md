# Deploying the Team Ops modules

Covers Workday (which merges Time Tracking, Work Calendar and Work Reports), Hub, Teamflow, Dashboard, Leave and Teamspaces (migrations `team_ops.0001` to `0014`, plus Plane's own `db.0122` to `0125` which the server is missing).

**Nothing here has been run on the server.** The images were not built on this machine (no Docker); the code, migrations and frontend build were verified locally.

## What changes on the server

- Only the `api`, `worker`, `beat-worker`, `migrator` and `web` images. `admin`, `space`, `live`, Postgres, Redis, RabbitMQ and MinIO stay as they are.
- Database: 27 new `tops_*` tables, plus Plane's own migrations `db.0122`–`0125` (`0123` drops two columns of `api_tokens`; the server has one token with a custom `allowed_rate_limit` that will be lost; `0125` touches only project deploy boards, none on the server).
- The Hub stores files in Plane's existing private object storage (the same bucket and credentials as Plane's own uploads, under the prefix `team-ops/`). The storage service must be running and reachable from the `api` container. Optional: `TEAM_OPS_MAX_UPLOAD_BYTES` (default 20 MB) on the `api` container.
- The 30-minute "still working?" check-in is enforced by a Celery beat job every 5 minutes (`team-ops-freeze-unanswered-timers`), so **`beat-worker` and `worker` must be running**. Optional: `TEAM_OPS_CHECK_IN_MINUTES` (30) and `TEAM_OPS_CHECK_IN_GRACE_MINUTES` (5).
- **Secrets need their own key.** Generate one with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`, set it as `TEAM_OPS_SECRET_KEY` on the `api` container, and keep a copy somewhere other than the server. Without it, a key derived from Django's `SECRET_KEY` is used, and changing `SECRET_KEY` later would make every secret unreadable.
- **Push notifications** need `TEAM_OPS_VAPID_PUBLIC_KEY`, `TEAM_OPS_VAPID_PRIVATE_KEY` and `TEAM_OPS_VAPID_SUBJECT` on `api`, `worker` and `beat-worker` (make them with `python manage.py team_ops_vapid_keys`) and a valid HTTPS certificate; see the stage notes. Migration `team_ops.0015` and the new dependency come with the images. Without the keys the feature is simply off.
- No other new environment variable is required. `TEAM_OPS_ENABLED` defaults to on; set `TEAM_OPS_ENABLED=0` on the api, worker and beat containers to switch the API and the daily job off.

## Steps

1. **Backup (every time).** On the server, in `<compose-dir>/`: dump the database (`pg_dump -Fc`), copy the uploads volume (`tar` the volume directory with `sudo`; the MinIO image has no `tar`) and copy `plane.env`. Never run `./plane-compose.sh down -v`. Keep a copy off the server.
2. **Build the images** from this repository on a machine with Docker (the server also works): `docker build -f apps/api/Dockerfile.api -t plane-api:teamops-1 apps/api` and `docker build -f apps/web/Dockerfile.web -t plane-web:teamops-1 .` (see `docker-compose.yml` in the repository root for the build arguments). Both images are built from the same commit; write its hash in the tag if you can.
3. **Rehearse on a copy first (staging).** Restore the dump into a throw-away Postgres, point a second compose project at it with the new images, run the `migrator`, and open: Workday (all five tabs), Hub, Teamflow, Team calendar, Report board, Calendar settings, Dashboard, Leave and Teamspaces as an admin, a team lead and a member. **Test files for real**: attach a PDF and an image in the Hub and in the Finish work form, open them from the message and from Teamflow, try a `.exe` and a renamed text file (both must be refused), and confirm a copied download link stops working after about five minutes. Finish a piece of work with *Needs attention* for another team and check it appears in that team's channel, under Mentions, and in Teamflow. Compare row counts of the original tables before and after (only `django_migrations`, `django_content_type` and `auth_permission` may change).
4. **Switch production.** In the server's compose file replace the `image:` of `api`, `worker`, `beat-worker`, `migrator` and `web` with the new tags, then `./plane-compose.sh up -d migrator` (it applies the migrations and exits), then `./plane-compose.sh up -d api worker beat-worker web`. Do not recreate the database, Redis or MinIO containers.
5. **Check.** `./plane-compose.sh logs migrator` ends without error; sign in; open the pages above; in the admin account open Calendar settings and create a team and a holiday; the beat container logs the task `plane.team_ops.tasks.extend_weekly_plans_task` once a day at 00:30 UTC.
6. **Roll back if needed.** Read "Rollback (corrected)" in the server runbook below first: pointing the `image:` lines back is not enough after `db.0123`. The new tables can stay (the old code ignores them). To remove them as well: `python manage.py migrate team_ops zero` with the new image (this deletes all Team Ops data, so export first). Plane's own `db.0122`–`0125` are not reversed by this; if they must be, restore the backup.

## What was verified before this document

| Check | Result |
|---|---|
| All migrations from zero on an empty database | applied |
| All migrations on a restore of the real server backup (22 users, 479 work items) | applied; 110 original tables unchanged except Django's own metadata tables; 27 new tables, none dropped (0006 to 0008 re-checked on its own on top of 0001–0005, then rolled back and re-applied) |
| `migrate team_ops zero` then migrate again on that restore | worked, original data intact |
| Team Ops backend tests | all pass (see the stage documents for counts) |
| Full backend suite against a clean checkout | no new failures (see the last section of the stage documents) |
| Frontend: `tsc`, `oxlint`, vitest, i18n sync, production build | clean |
| Pages opened in a real browser against a local database | Workday, Hub, Teamflow, all Work calendar pages, Work reports, Dashboard, Leave, Teamspaces |

## Known limits to remember

- **File upload and download were tested only against a fake storage** (no MinIO on the development machine). Test them first on staging.
- The Docker images and the server compose file were not touched or tested here.
- The calendar and the new pages are English only by decision; other Plane screens keep their translations.
- Machine translations in the Time tracking catalogs (Stage 1) still need a native review.
- Large workspaces (several hundred people) should page the team views by team.


## Runbook for the real server (checked read-only on 2026-11-01)

What the server looks like (nothing was changed while checking):

- The server, with the compose project in `<compose-dir>/` (`docker-compose.yaml`, `plane.env`, older `plane.env.before-*` copies). 13 services; all Plane images are `makeplane/*:stable` built in May 2026; the compose file reads them as `makeplane/plane-backend:${APP_RELEASE:-stable}`. Other products run on the same machine (31 GB RAM, 8 cores, 113 GB free), so builds and staging must not starve them.
- Data: Postgres 15.7 in volume `plane_pgdata` (80 MB on disk, database 25 MB: 22 users, 479 work items, 5 workspaces, 110 tables, last migration `0121_alter_estimate_type`), uploads in MinIO volume `plane_uploads` (2.9 MB). Redis, RabbitMQ and the proxy have their own volumes. These are the only things that matter; **images hold no data**.
- Public address `https://<your-domain>` (an outer proxy to the Plane proxy on port 9095). `APP_RELEASE=stable`, `USE_MINIO=1`. Keep `SECRET_KEY` and the other keys in `plane.env` exactly as they are.

### Always pass the settings file (read this before any `docker compose`)

`docker compose` fills the `${VARIABLES}` of `docker-compose.yaml` from a file named `.env`, **not** from `plane.env`. A service recreated without `--env-file plane.env` therefore starts with the defaults written in the compose file: `WEB_URL=http://localhost`, an empty `CORS_ALLOWED_ORIGINS`, `APP_DOMAIN=localhost`, the placeholder keys. Invite links, redirects after sign-in and emails then point to `localhost` and people are logged out or cut off. This happened once (the services were recreated by hand without the file); nothing was lost, but it is easy to do again.

So every command in this guide is written with the wrapper `deploy/server/plane-compose.sh`, which always runs `docker compose -f docker-compose.yaml --env-file plane.env ...`, refuses to run without `plane.env`, refuses `down -v` (which would delete the data volumes), and after `up`, `restart` and `start` runs `deploy/server/post-deploy-check.sh`.

Install once, in the compose directory on the server (`plane.env` and `docker-compose.yaml` are already there):

```bash
scp -P <ssh-port> deploy/server/plane-compose.sh deploy/server/post-deploy-check.sh <user>@<server>:<compose-dir>/
ssh <user>@<server> 'cd <compose-dir> && chmod +x plane-compose.sh post-deploy-check.sh'
```

Use it instead of `docker compose`:

```bash
cd <compose-dir> && ./plane-compose.sh up -d --force-recreate api worker beat-worker web admin space live
./plane-compose.sh ps
./plane-compose.sh logs --tail 50 api
```

The check can be run alone at any time (`./post-deploy-check.sh`): for `api`, `worker` and `beat-worker` it verifies that `WEB_URL` is set, is not `localhost`, and equals `WEB_URL` in `plane.env`, and that `CORS_ALLOWED_ORIGINS` equals the value of `plane.env`. It prints only those two non-secret values and exits with 1 and the exact fix command if anything is wrong. By hand, the same check is `docker exec <api-container> printenv WEB_URL`.

If you must call `docker compose` directly, add `--env-file plane.env` every time. An alternative that makes the plain command safe too is a link `ln -s plane.env .env` in the compose directory (then compose reads it by itself); the wrapper works with or without it.

### Automatic deployment (GitHub Actions)

The workflow `.github/workflows/build-images-ghcr.yml` builds the five images, and its `deploy` job then puts them on the server: it copies `deploy/server/*.sh` to the compose directory over SSH and runs `deploy.sh`, which (1) refuses to run unless the directory is the Plane stack (`plane.env`, a compose file with `plane-db` and the `plane-fork` images), (2) backs up the database (a `pg_dump` that is checked), the uploads and `plane.env` into `~/plane-backups/<time>-deploy` and keeps the last 7, (3) pulls the new `ghcr.io` images, (4) runs the migrator and stops there if it fails, leaving the old version running, (5) recreates `api`, `worker`, `beat-worker`, `web`, `admin`, `space` and `live` through `plane-compose.sh` (so `plane.env` is always passed) and runs `post-deploy-check.sh`, and (6) waits until the site answers. It never touches the database, Redis, RabbitMQ, MinIO or the proxy containers and never deletes volumes.

It needs these **secrets in the GitHub environment `mg-sfactory`** (Settings, Environments): `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY` (a key that is allowed to log in and run `docker`), `DEPLOY_KNOWN_HOSTS` (the output of `ssh-keyscan -p <port> <host>`, so the server is checked and never trusted blindly) and `DEPLOY_PATH` (the absolute path of the Plane compose directory on the server; **it must be the Plane directory**, and `deploy.sh` stops if it is not). The workflow fails with a clear message when one of them is missing. The server's SSH port must be reachable from GitHub's runners.

It starts in two ways:

- **On every push** to `ultra-plane` that changes the api, the web app, the packages or `deploy/server`: the images are built and then deployed, without anyone starting it. To switch this off, set the repository variable `AUTO_DEPLOY` to `false` (Settings, Secrets and variables, Actions, Variables); a push then only builds the images.
- **By hand:** Actions, *Build images for the server (ghcr)*, *Run workflow*, tick **Deploy to the server**.

To have a person approve every deployment, add **Required reviewers** to the `mg-sfactory` environment: the `deploy` job then waits for approval after the images are built. Only one deployment runs at a time. If a deployment fails after the migrations, `deploy.sh` prints the backup folder; see "Rollback" below. The first time, install the scripts by hand as described in "Always pass the settings file" or let the first deployment copy them.

### Why no data is lost

1. Images are replaced; the volumes are not. `./plane-compose.sh up -d <service>` recreates containers and keeps their volumes. Never use `down -v`, `docker volume rm` or `docker system prune --volumes`.
2. The database is only touched by the `migrator`, which adds tables and columns. The one destructive step is Plane's own `db.0123`: it drops `api_tokens.is_service` and `api_tokens.allowed_rate_limit` (one token on the server has a custom limit; that value is lost, the token itself stays). Everything else in `db.0122`–`0125` and the 14 `team_ops` migrations (`0001`–`0014`) only adds or adjusts.
3. Rehearsed twice on a restore of the real backup (see above): 110 original tables unchanged.

### Order of work

1. **Build** (needs the code at a commit, so you commit first). From your PC after committing: `git archive --format=tar.gz -o plane-teamops.tgz HEAD`, `scp -P 6622 -i <key> plane-teamops.tgz e200@<server-ip>:~/`, then on the server `mkdir ~/plane-src && tar xzf ~/plane-teamops.tgz -C ~/plane-src && cd ~/plane-src`, and
   `nice -n 19 docker build -f apps/api/Dockerfile.api -t plane-fork-api:teamops-1 apps/api` and
   `nice -n 19 docker build -f apps/web/Dockerfile.web -t plane-fork-web:teamops-1 .`
   (the web image needs several GB of RAM for a few minutes; do it at a quiet hour, or build in CI and push to a registry the server already pulls from). Also build `admin`, `space` and `live` from the same commit (`apps/admin/Dockerfile.admin`, `apps/space/Dockerfile.space`, `apps/live/Dockerfile.live`), so every Plane service is of one version; the old `stable` ones are four months older than the API. Leave `proxy`, Postgres, Redis, RabbitMQ and MinIO alone (the fork's own compose file uses a different object store; the server's compose file does not).
2. **Backup** into a new folder (not over the old ones): `pg_dump -Fc` through `./plane-compose.sh exec -T plane-db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > plane.dump`, `sudo tar czf uploads.tgz -C /var/lib/docker/volumes/plane_uploads/_data .`, and `cp plane.env docker-compose.yaml`. Copy the folder to your PC. The last backup (`plane-backup-20261030-191400`) is already there but a fresh one must be taken right before switching.
3. **Staging on the same server, separate from production.** `cp -r` the compose directory to `~/plane-staging`, use `./plane-compose.sh -p planestage` (its volumes are `planestage_*`, empty), a staging `plane.env` with `LISTEN_HTTP_PORT=18080`, `LISTEN_HTTPS_PORT=18443`, `APP_DOMAIN=localhost:18080`, `WEB_URL=http://localhost:18080`, and the new image tags. Start `plane-db`, restore `plane.dump` into it, run `migrator`, start the rest, and open it through an SSH tunnel (`ssh -p 6622 -L 18080:127.0.0.1:18080 ...`). Check every page in the list above, and the file upload/download. Then `./plane-compose.sh -p planestage down -v` (**only** in that staging directory with that project name).
4. **Switch production** in a quiet window (about five minutes of downtime): in `<compose-dir>/docker-compose.yaml` change the `image:` of `web`, `api`, `worker`, `beat-worker`, `migrator` (and `admin`, `space`, `live`) to the new tags; add `TEAM_OPS_SECRET_KEY=<generated>` to `plane.env` and under `x-app-env`; then `./plane-compose.sh up -d migrator` and wait for exit code 0 (`./plane-compose.sh logs migrator`), then `./plane-compose.sh up -d api worker beat-worker web admin space live`.
5. **Check** as in the steps above. Keep `plane.env` and the compose file's previous versions (`cp` them before editing).

### Rollback (corrected)

Switching the `image:` lines back is **not enough** once `db.0123` has run: the old code still expects the two dropped `api_tokens` columns and API-token requests would fail (browser sessions keep working). Use one of:

- `./plane-compose.sh run --rm migrator python manage.py migrate db 0121` and `migrate team_ops zero` with the **new** image (re-adds the two columns empty, removes the Team Ops tables; export Team Ops data first), then switch the images back; or
- restore `plane.dump` into Postgres (stop `api`, `worker`, `beat-worker` first; this loses everything written after the backup, which is why the window should be short and quiet), then switch the images back.

Make the choice before switching, not during an outage.
