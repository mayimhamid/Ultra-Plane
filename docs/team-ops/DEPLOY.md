# Deploying the Team Ops modules

Covers Workday (which merges Time Tracking, Work Calendar and Work Reports), Hub, Teamflow, Dashboard, Leave and Teamspaces (migrations `team_ops.0001` to `0014`, plus Plane's own `db.0122` to `0125` which the server is missing).

**Nothing here has been run on the server.** The images were not built on this machine (no Docker); the code, migrations and frontend build were verified locally.

## What changes on the server

- Only the `api`, `worker`, `beat-worker`, `migrator` and `web` images. `admin`, `space`, `live`, Postgres, Redis, RabbitMQ and MinIO stay as they are.
- Database: 27 new `tops_*` tables, plus Plane's own migrations `db.0122`–`0125` (`0123` drops two columns of `api_tokens`; the server has one token with a custom `allowed_rate_limit` that will be lost; `0125` touches only project deploy boards, none on the server).
- The Hub stores files in Plane's existing private object storage (the same bucket and credentials as Plane's own uploads, under the prefix `team-ops/`). The storage service must be running and reachable from the `api` container. Optional: `TEAM_OPS_MAX_UPLOAD_BYTES` (default 20 MB) on the `api` container.
- The 30-minute "still working?" check-in is enforced by a Celery beat job every 5 minutes (`team-ops-freeze-unanswered-timers`), so **`beat-worker` and `worker` must be running**. Optional: `TEAM_OPS_CHECK_IN_MINUTES` (30) and `TEAM_OPS_CHECK_IN_GRACE_MINUTES` (5).
- **Secrets need their own key.** Generate one with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`, set it as `TEAM_OPS_SECRET_KEY` on the `api` container, and keep a copy somewhere other than the server. Without it, a key derived from Django's `SECRET_KEY` is used, and changing `SECRET_KEY` later would make every secret unreadable.
- No other new environment variable is required. `TEAM_OPS_ENABLED` defaults to on; set `TEAM_OPS_ENABLED=0` on the api, worker and beat containers to switch the API and the daily job off.

## Steps

1. **Backup (every time).** On the server, in `<compose-dir>/`: dump the database (`pg_dump -Fc`), copy the uploads volume (`tar` the volume directory with `sudo`; the MinIO image has no `tar`) and copy `plane.env`. Never run `docker compose down -v`. Keep a copy off the server.
2. **Build the images** from this repository on a machine with Docker (the server also works): `docker build -f apps/api/Dockerfile.api -t plane-api:teamops-1 apps/api` and `docker build -f apps/web/Dockerfile.web -t plane-web:teamops-1 .` (see `docker-compose.yml` in the repository root for the build arguments). Both images are built from the same commit; write its hash in the tag if you can.
3. **Rehearse on a copy first (staging).** Restore the dump into a throw-away Postgres, point a second compose project at it with the new images, run the `migrator`, and open: Workday (all five tabs), Hub, Teamflow, Team calendar, Report board, Calendar settings, Dashboard, Leave and Teamspaces as an admin, a team lead and a member. **Test files for real**: attach a PDF and an image in the Hub and in the Finish work form, open them from the message and from Teamflow, try a `.exe` and a renamed text file (both must be refused), and confirm a copied download link stops working after about five minutes. Finish a piece of work with *Needs attention* for another team and check it appears in that team's channel, under Mentions, and in Teamflow. Compare row counts of the original tables before and after (only `django_migrations`, `django_content_type` and `auth_permission` may change).
4. **Switch production.** In the server's compose file replace the `image:` of `api`, `worker`, `beat-worker`, `migrator` and `web` with the new tags, then `docker compose up -d migrator` (it applies the migrations and exits), then `docker compose up -d api worker beat-worker web`. Do not recreate the database, Redis or MinIO containers.
5. **Check.** `docker compose logs migrator` ends without error; sign in; open the pages above; in the admin account open Calendar settings and create a team and a holiday; the beat container logs the task `plane.team_ops.tasks.extend_weekly_plans_task` once a day at 00:30 UTC.
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

### Why no data is lost

1. Images are replaced; the volumes are not. `docker compose up -d <service>` recreates containers and keeps their volumes. Never use `down -v`, `docker volume rm` or `docker system prune --volumes`.
2. The database is only touched by the `migrator`, which adds tables and columns. The one destructive step is Plane's own `db.0123`: it drops `api_tokens.is_service` and `api_tokens.allowed_rate_limit` (one token on the server has a custom limit; that value is lost, the token itself stays). Everything else in `db.0122`–`0125` and the 14 `team_ops` migrations (`0001`–`0014`) only adds or adjusts.
3. Rehearsed twice on a restore of the real backup (see above): 110 original tables unchanged.

### Order of work

1. **Build** (needs the code at a commit, so you commit first). From your PC after committing: `git archive --format=tar.gz -o plane-teamops.tgz HEAD`, `scp -P 6622 -i <key> plane-teamops.tgz e200@<server-ip>:~/`, then on the server `mkdir ~/plane-src && tar xzf ~/plane-teamops.tgz -C ~/plane-src && cd ~/plane-src`, and
   `nice -n 19 docker build -f apps/api/Dockerfile.api -t plane-fork-api:teamops-1 apps/api` and
   `nice -n 19 docker build -f apps/web/Dockerfile.web -t plane-fork-web:teamops-1 .`
   (the web image needs several GB of RAM for a few minutes; do it at a quiet hour, or build in CI and push to a registry the server already pulls from). Also build `admin`, `space` and `live` from the same commit (`apps/admin/Dockerfile.admin`, `apps/space/Dockerfile.space`, `apps/live/Dockerfile.live`), so every Plane service is of one version; the old `stable` ones are four months older than the API. Leave `proxy`, Postgres, Redis, RabbitMQ and MinIO alone (the fork's own compose file uses a different object store; the server's compose file does not).
2. **Backup** into a new folder (not over the old ones): `pg_dump -Fc` through `docker compose exec -T plane-db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > plane.dump`, `sudo tar czf uploads.tgz -C /var/lib/docker/volumes/plane_uploads/_data .`, and `cp plane.env docker-compose.yaml`. Copy the folder to your PC. The last backup (`plane-backup-20261030-191400`) is already there but a fresh one must be taken right before switching.
3. **Staging on the same server, separate from production.** `cp -r` the compose directory to `~/plane-staging`, use `docker compose -p planestage` (its volumes are `planestage_*`, empty), a staging `plane.env` with `LISTEN_HTTP_PORT=18080`, `LISTEN_HTTPS_PORT=18443`, `APP_DOMAIN=localhost:18080`, `WEB_URL=http://localhost:18080`, and the new image tags. Start `plane-db`, restore `plane.dump` into it, run `migrator`, start the rest, and open it through an SSH tunnel (`ssh -p 6622 -L 18080:127.0.0.1:18080 ...`). Check every page in the list above, and the file upload/download. Then `docker compose -p planestage down -v` (**only** in that staging directory with that project name).
4. **Switch production** in a quiet window (about five minutes of downtime): in `<compose-dir>/docker-compose.yaml` change the `image:` of `web`, `api`, `worker`, `beat-worker`, `migrator` (and `admin`, `space`, `live`) to the new tags; add `TEAM_OPS_SECRET_KEY=<generated>` to `plane.env` and under `x-app-env`; then `docker compose up -d migrator` and wait for exit code 0 (`docker compose logs migrator`), then `docker compose up -d api worker beat-worker web admin space live`.
5. **Check** as in the steps above. Keep `plane.env` and the compose file's previous versions (`cp` them before editing).

### Rollback (corrected)

Switching the `image:` lines back is **not enough** once `db.0123` has run: the old code still expects the two dropped `api_tokens` columns and API-token requests would fail (browser sessions keep working). Use one of:

- `docker compose run --rm migrator python manage.py migrate db 0121` and `migrate team_ops zero` with the **new** image (re-adds the two columns empty, removes the Team Ops tables; export Team Ops data first), then switch the images back; or
- restore `plane.dump` into Postgres (stop `api`, `worker`, `beat-worker` first; this loses everything written after the backup, which is why the window should be short and quiet), then switch the images back.

Make the choice before switching, not during an outage.
