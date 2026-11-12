# AI in Team Ops (Plane AI)

Plane works fully without AI. With [Plane AI](../../../plane-ai) (a separate repository and compose stack running a
small local model) connected, these appear:

| Where                         | Who      | What                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard › Assistant         | everyone | Chat about their work (answers cite work items and Hub docs of projects they can open), "Summarize my day", summarize any text, search by meaning                                                                                                                                                    |
| Work item sidebar             | everyone | "Summarize with AI"                                                                                                                                                                                                                                                                                  |
| Import tasks dialog           | everyone | "Make the tasks with Plane AI": the AI writes the tasks, the usual preview shows them, nothing is added until "Add"                                                                                                                                                                                  |
| Dashboard › AI › Quality      | managers | Per person, with arrows against the period before: tasks finished, on time, work that came back (reopened), estimates (reported ÷ planned), tasks a day, meeting share, documents and comments, reports. Works **without** AI. "Ask the AI about <person>" opens Ask with that person's whole record |
| Dashboard › AI › Evidence     | managers | Reported hours against recorded activity, per person; works **without** AI. "Explain with AI" adds a review per person                                                                                                                                                                               |
| Dashboard › AI › Daily review | managers | For one day: does the time on every row fit the work described? ("4 h of LLM research" with no result, a whole day for a config change.) Per row: fits / too long / says nothing / not this task, the usual time, a question to ask                                                                  |
| Dashboard › AI › Ask          | managers | Questions about the team for a week or month, answered only from Plane's data (hours, quality, notes, evidence, projects, risks, workload). A question naming someone carries that person's whole record; numbers are checked against the data                                                       |
| Dashboard › AI (top)          | admins   | Effort High / Medium / Low / Off, "Update AI search", "Download training data"                                                                                                                                                                                                                       |

Managers are the people who may see the team (workspace admins, and team leads when the policy allows); a lead only
ever sees their teams. Ratings (thumbs) on AI answers become training data (see plane-ai `docs/fine-tuning.md`).

Slow work (summaries, task proposals, reviews, answers) runs as a **job** in Plane AI: the request returns at once and
the page polls `ai/jobs/<id>/`, so a busy CPU never hits a proxy or worker timeout. Chat streams.

## Connect it on the server (once)

Plane AI lives next to Plane, e.g. `/opt/smartfactoryteam/plane-ai`. They talk over a private Docker network.

1. Network (once):

   ```bash
   docker network create plane-ai-link
   ```

2. Plane AI: in its `.env` set `PLANE_AI_DB_PASSWORD` and `PLANE_AI_SERVICE_TOKEN` (a long random value), then

   ```bash
   cd /opt/smartfactoryteam/plane-ai && docker compose -f docker-compose.yml -f docker-compose.plane.yml up -d --build
   ```

   The first start downloads the model (about 1.2 GB). `curl http://127.0.0.1:8100/ready` says `ready` when done.

3. Plane, in the compose directory (`/opt/smartfactoryteam/plane`). Keep copies first:
   `cp plane.env plane.env.before-ai && cp docker-compose.yaml docker-compose.yaml.before-ai`.
   - `plane.env`:

     ```
     PLANE_AI_URL=http://plane-ai-api:8100
     PLANE_AI_TOKEN=<the same value as PLANE_AI_SERVICE_TOKEN>
     ```

   - `docker-compose.yaml`: pass the two variables to the app containers (under `x-app-env`, where the other
     variables are, or under the `api` service's `environment`):

     ```yaml
     PLANE_AI_URL: ${PLANE_AI_URL:-}
     PLANE_AI_TOKEN: ${PLANE_AI_TOKEN:-}
     ```

     and put the `api` service on the shared network as well as its own (list the network it already uses, often
     `default`, or it loses the database):

     ```yaml
     services:
       api:
         networks: [default, plane-ai-link]
     networks:
       plane-ai-link:
         external: true
     ```

   - Recreate the API with the wrapper (it always passes `plane.env`):

     ```bash
     ./plane-compose.sh up -d --force-recreate api
     ```

     `post-deploy-check.sh` then prints `Plane AI answers at http://plane-ai-api:8100`, or a warning saying what is
     missing. The deploy job keeps the compose file as it is, so this survives deployments.

4. In Plane: Dashboard › AI, choose the effort (Low is the gentlest on a shared server) and press "Update AI search".

`PLANE_AI_TIMEOUT` (seconds, default 180) bounds one call from Plane to Plane AI. With jobs, no call waits for the
model itself, so it rarely matters.

## Turning it off

Set Effort to Off in Dashboard › AI (per workspace), or remove `PLANE_AI_URL` from `plane.env` and recreate `api`
(every AI button disappears). Plane AI can be stopped at any time; Plane only shows that AI is not answering.
