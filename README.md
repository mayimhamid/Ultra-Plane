# Ultra Plane

**Project management with team operations built in.** Ultra Plane is a self-hosted work platform for a team that
plans, builds and reports together: tasks and projects, a working day for every person, shared chat and documents,
and a manager's view of the whole team, in one application.

It is built on top of [Plane](https://github.com/makeplane/plane), the open-source project management tool, and
keeps all of it (work items, cycles, modules, views, pages, analytics). Everything Ultra Plane adds lives in its
own Django app (`plane.team_ops`, tables `tops_*`) so the core stays intact and can be upgraded separately.

## What it adds

| Area | What it does |
| --- | --- |
| **Workday** | One page for the day: Onsite or Remote (hybrid is worked out by itself), a required weekly plan that is confirmed and locked, a timer on a work item with a rest pause, a 30-minute "still working?" check-in, parallel tasks, a finish report with a document or an explicit "no document", attention tags to teams and people, and a contribution graph. |
| **Time and calendar** | Time tracking per work item, a work calendar with teams and holidays, weekly work reports, leave requests and Teamspaces. |
| **Hub** | News, a General channel, team and project channels, private messages, a Doc Hub (documents of a project are kept as Plane Pages), a Files library and encrypted Secrets with an access log. |
| **Teamflow** | A flow is an optional part of a project, split into phases. Each phase holds modules; its progress is the progress of its modules. Hand-offs between teams are tracked and shown as a chart. |
| **Tasks** | Every work item in one list with its forks (sub work items and people), the flows it belongs to, and the time spent. |
| **Module relation graph** | On a module's page, the work items are drawn as a commit-history style graph. Drag one onto another to make it a sub work item, or drag from its dot to choose a relation (blocks, blocked by, relates to, duplicate). |
| **Control** | For managers: team status, hours and approvals, ranking, summed time with Excel export, Hub moderation and Teamflow control. |
| **Admin view** | Every workspace admin is kept on every project of their workspace, so an admin sees all of it. |
| **One bell** | Team notifications appear in Plane's own notification bell and page. |

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/api` | Django API (Plane core + `plane/team_ops`) |
| `apps/web`, `apps/admin`, `apps/space`, `apps/live` | The web apps and the live collaboration server |
| `packages/*` | Shared TypeScript packages (types, services, constants, editor, i18n) |
| `docs/team-ops` | Design, stage notes and the deployment guide of everything Ultra Plane adds |
| `.github/workflows/build-images-ghcr.yml` | Builds the Docker images and pushes them to GitHub Container Registry |

## Run it

**Locally** (see also [CONTRIBUTING.md](./CONTRIBUTING.md)):

```bash
pnpm install
pnpm dev            # web on :3000, admin on :3001
cd apps/api && uv sync
```

**On a server** with Docker Compose: images are built by the workflow above (push to the `ultra-plane` branch) and
pulled as `ghcr.io/<owner>/plane-fork-<app>:<tag>`; the existing database and storage volumes are kept. Take a
backup first, test the migrations on a copy of the data, then switch the `image:` lines.
The step by step guide, with the rollback notes, is [docs/team-ops/DEPLOY.md](./docs/team-ops/DEPLOY.md).

Team Ops is on by default; set `TEAM_OPS_ENABLED=0` on the api, worker and beat containers to switch its API and
background jobs off. Set `TEAM_OPS_SECRET_KEY` (a Fernet key) to protect the Hub secrets, and keep a copy of it
outside the server.

## Tests

```bash
# backend (Django / pytest), Team Ops only
cd apps/api && python -m pytest plane/tests/contract/app -k team_ops --nomigrations
# frontend packages
pnpm check:types && pnpm check:lint
```

## Documentation

Everything Ultra Plane adds is described in [docs/team-ops](./docs/team-ops): the [architecture](./docs/team-ops/ARCHITECTURE.md),
one document per stage, and the [deployment guide](./docs/team-ops/DEPLOY.md).

## Security

Please report a vulnerability privately to the repository owner instead of opening a public issue.
Hub files are stored privately and served by short-lived signed links, secrets are encrypted at rest, and a
secret's value can be read only by its publisher and the people they chose, administrators included.

## License and origin

Ultra Plane is free software under the [GNU Affero General Public License v3.0](./LICENSE.txt), the same license as
Plane. It is a derivative of [Plane](https://github.com/makeplane/plane), Copyright (c) 2023-present Plane Software,
Inc. and contributors; the original copyright notices in the source files are kept. Because it is served over a
network, the AGPL requires that its users be able to obtain the corresponding source code of the version they use.
