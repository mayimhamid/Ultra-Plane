# Stage 6: Workday, Hub and Teamflow

Status: **implemented and tested locally. Not deployed.**
Owner's request (translated): one page with a single-word name that merges Time tracking, Work calendar and Work reports; pick a project, then one of its tasks, start the timer, and at the end write a report; a document is optional but there must be a sure way to finish without one; a "needs attention" flag that notifies other teams in a **Hub**; the Hub is a professional and secure place for chat and files (tags, uploads) for team members and project members; **Teamflow** shows the documents and hand-offs between teams as a pipeline, with filters (all, delivered).

## What was built

### Workday (sidebar: "Workday")

One page, tabs **Today | Plan | Reports | Time log | Team**. The old three sidebar items are gone; their pages are the tabs (Plan = My calendar, Reports = My reports, Time log = timer, manual entries and the week view). Team calendar, report board, calendar settings, leave and dashboard are reached from the Team tab. The old URLs still work.

**Today**
1. *Project, then task.* A project (the ones you belong to), then a search over that project's work items, then **Start timer**. One running timer per person, as before.
2. *Running.* Work item, a live clock, **Finish work**.
3. *Finish work* (a required form, in place of the timer card):
   - **What did you do?** required. It is appended as a line (`KEY-12 summary (1h 5m)`) to today's daily report, as a draft, so the report is half written when the day ends.
   - **Document**: optional text or link, optional files. If there is neither, the person must tick **"There is no document for this work"**. The *Finish work* button stays disabled and says what is missing until one of the three is true. The server enforces the same rule.
   - **Needs attention from other teams**: a message and the teams to tell.
4. *Numbers*: today, this week, finished this week, needs attention, confirmed without a document; **time by task** for today and for the week as bars; the sessions finished today with badges *Document*, *No document (confirmed)* and *Needs attention*.

A timer started elsewhere without a work item cannot be finished as work (the page says to stop it in Time log). A bad file is checked before the timer is touched, so a rejected upload never costs the person their timer. The whole finish is one transaction: timer stop, session, report line, files and Hub posts all happen or none do.

The **Dashboard** has a new "Finished work (Workday)" block: sessions, hours, how many were confirmed without a document, how many needed attention, and the top tasks by time.

### Needs attention

On finish, the message is posted in the Hub as a highlighted "Needs attention" message in the project's channel and in the channel of every team chosen, tagging the members of those teams who can read the channel. Tagged people see it under **Hub → Mentions** and as an unread count.

### Hub (sidebar: "Hub")

Channels: one per **team** and one per **project**, created on first use. There is no member list to maintain: the members of a channel are the members of the team (Teamspaces) or of the project (active project members), so joining or leaving gives or removes access. Guests are never in a channel.
Messages, one-level replies, edit and delete (own messages; workspace admins can delete), `@person` and `@team` tags, up to 10 file attachments per message, unread counters per channel and a Mentions list, refreshed every 8 seconds.

### Teamflow (sidebar: "Teamflow")

A diagram of teams (nodes) and hand-offs (arrows with *waiting* and *delivered* counts, orange while something waits, green when all is delivered), and below it the list of hand-offs with the work item, the summary, the files and the status. Filters: **Show** (all / waiting / delivered), **Team**, **Period**. A hand-off is a message that tags a whole team; it goes from the author's team to the tagged team. *Delivered* means someone in the receiving team has opened it in the Hub. Work handed over from Workday that reaches the receiving team both in the project channel and in the team channel counts once. Admins see all hand-offs; others see those that touch their own teams.

## How the Hub is secured

| Risk | What is done |
|---|---|
| Reading another team's or project's chat | Every call checks the person is a member of that channel's team or project **now**, so a channel they cannot use answers "not found" (it does not reveal that it exists). Leaving a team or project closes the channel immediately. Guests and people outside the workspace get 403. |
| Reaching other workspaces | Every query is scoped to the workspace in the URL; ids from another workspace answer "not found". |
| Files being public | Files go into Plane's **private** object storage. There is no public URL. The API hands out a signed link that works for **5 minutes**, only after re-checking that the person may read the message (or work session) the file belongs to. The link is requested again each time and never stored. Deleting a message hides its files. |
| Guessing file addresses | Storage keys are `team-ops/<workspace>/<random>/<random>.<ext>`: unguessable, and the original name is kept only in the database, so path tricks such as `../../x.pdf` cannot reach anything. |
| Dangerous uploads | An allow-list of extensions (images, PDF, text, Markdown, CSV, Word, Excel, PowerPoint); no executables, scripts, HTML or SVG. The declared content type must match the extension, and for formats with a fixed signature (PNG, JPEG, GIF, PDF, Office) the first bytes of the file must match, so a renamed file is refused. Empty files and files over **20 MB** (change with `TEAM_OPS_MAX_UPLOAD_BYTES`) are refused; at most 10 files per message. All files of a message are checked before anything is stored. |
| Script injection in messages | Messages are plain text, shown by React as text (never as HTML). Downloads (except images) are sent as attachments, not displayed in the page. |
| Tagging people who may not see the channel | Tags are checked against the channel's members; tagging a team only reaches its members who can read the channel. |
| Editing others' messages | Only the author edits; the author or a workspace admin deletes. Deleted messages keep their place in a thread but lose their text. |
| Spoofing | Authors and recipients always come from the logged-in session, never from the request body. |

What is **not** done (be aware): messages are not end-to-end encrypted (admins with database access can read them, like all Plane data); there is no virus scan of uploaded files (the storage can be given one); message text is not searchable yet; there are no direct messages or push notifications to e-mail.

## Data

New tables, all `tops_*` (migration `team_ops.0006_hub_and_work_sessions`): `tops_work_session`, `tops_hub_channel`, `tops_hub_message`, `tops_hub_mention` (also the notification), `tops_hub_attachment`, `tops_hub_read_state`. No existing table changed. Plane's own notification tables were deliberately not used, so the core inbox cannot be affected.

API (all under `/api/workspaces/<slug>/team-ops/`): `work-sessions/finish/` (POST), `work-sessions/`, `work-tasks/`, `teamflow/`, `hub/channels/`, `hub/channels/<id>/`, `hub/channels/<id>/messages/`, `hub/messages/<id>/`, `hub/files/<id>/`, `hub/mentions/`.

## Verification

- Backend: `test_team_ops_workday.py`, 51 tests (finish rules, the no-document confirmation, report line, files, attention, Teamflow visibility and filters, channel access across teams, projects and workspaces, upload refusals, signed links, edit/delete rules, dashboard block). With the earlier stages, 339 Team Ops tests pass.
- Frontend: `tsc`, `oxlint`, the i18n sync check and the production build are clean; 131 unit tests pass in `@plane/services` (new: finish rules, multipart bodies, Hub and Workday services).
- Migration `0006` applied on a copy of the real server data (with `0001`–`0005` already applied): six new tables, nothing else changed except Django's own metadata; rolled back and re-applied.
- Seen in a real browser against a local database: Workday (project picker, running timer, finish form with live validation, time by task, badges), Plan and Time log tabs, Hub (attention message in the project channel), Teamflow (pipeline diagram with a waiting hand-off), the sidebar.

## Not verified

- **File upload and download against the real storage.** There is no MinIO on the development machine, so the tests use a fake storage. The first thing to do on staging: attach a PDF in the Hub and in the Finish form, open it from the message and from Teamflow, and confirm the link stops working after a few minutes. The server's bucket and credentials are the ones Plane already uses for its own uploads.
- Two people chatting at the same time in two browsers (the API is tested; the 8-second refresh was seen working for one person).
- Very large channels: the first page is the latest 100 messages; an older-messages button is not built yet (the API supports it with `before`).

## Update: Workday as one page (second round of the owner's requests)

The tabs are gone. **Workday is one page and the main page**: the first time the workspace is opened in a browser session the app lands on it (Home stays one click away in the sidebar). From top to bottom it shows:

1. **How are you working today?** The first question of every day: *Onsite*, *Remote* or *Hybrid*. Nothing else works until it is answered; the answer can be changed later the same day.
2. **Now**: project, then task, then (on a hybrid day only) **where you work on this task** (onsite or remote), then Start.
3. While working: the clock, **Rest pause** (the time stops counting; *Back to work* resumes it), and **Finish work**.
4. **Check-in every 30 minutes**: "Are you still working?" with 5 minutes to answer. If it is answered the time carries on. If not, the timer is **frozen from the moment the question fell due**: that time is not counted, it is written down as a *Frozen* interval in the day's detail and in the finished work, and the **admins and the leads of the person's teams get a notification**. "I am back" ends the freeze. This runs on the server (a job every 5 minutes), so it works with the browser closed. Set `TEAM_OPS_CHECK_IN_MINUTES` and `TEAM_OPS_CHECK_IN_GRACE_MINUTES` to change the 30 and 5.
5. **Numbers and the day's story**: worked, onsite and remote hours, rest pauses, frozen time, this week, needs attention; time by task; each finished piece of work with the breaks and freezes between.
6. **Team now** (only for people who may see the team): each person's state (working, on a break, frozen, finished, not working), task, how they work today, time worked and time frozen. Links to the team calendar, report board and calendar settings.
7. **My plan** (calendar) and **My reports** as sections that open in place. The "New for you" box shows notifications (a missed check-in, tags, attention requests).

Hours rules: worked time = elapsed time minus rest pauses minus freezes. Existing timers started on the old Time tracking page follow the same check-in rule.

New data (migration `team_ops.0007_workday_modes_breaks_notifications`): `tops_work_day`, `tops_work_interruption`, `tops_notification`, and new columns on `tops_timer` and `tops_work_session`. New API: `workday/` (state), `workday/day/`, `workday/start/`, `workday/break/`, `workday/check-in/`, `workday/team/`, `notifications/`.

## Update: Hub sections and Teamflow flows (third round)

### Hub

Left column, top to bottom: **Mentions**; **Everyone** (News, General); **Teams** and **Projects** (one channel each, so admins create them by creating teams in Teamspaces and projects); **Private** (a private conversation with any colleague, admins included, started from the list); **Library**: Doc Hub, Files, Secrets.

- **News**: everyone reads, only admins write; every post notifies everyone. **General**: everyone writes.
- **Private messages**: only the two people can read them (a third person gets "not found"); the other person is notified.
- **Doc Hub**: written documents with tags (`#ops`), search, and an optional project. A document tied to a project is visible to that project's members and admins; a document without a project is open to the workspace. Only the author or an admin changes or deletes it.
- **Files**: files shared with the whole workspace, plus the files of every channel the person can read, with the same upload rules and 5-minute signed links as before.
- **Secrets**: see below.
- **Notifications**: tags, attention requests, news, private messages, missed check-ins and shared secrets all land in the "New for you" box on Workday (and tags also in Hub, Mentions).

### How Secrets are protected

| Risk | What is done |
|---|---|
| Reading the database | The value is encrypted (Fernet, AES-128-CBC with HMAC) before it is stored. The key is `TEAM_OPS_SECRET_KEY` if set, otherwise derived from Django's `SECRET_KEY`. **Set `TEAM_OPS_SECRET_KEY` on the server and back it up separately; without the key a secret cannot be read, and with the wrong key it is refused, not shown wrongly.** |
| Values in lists or logs | Lists, search and logs never contain the value. Only a separate "Reveal" call returns it, with `Cache-Control: no-store`, and the page hides it again after 20 seconds. |
| Who may read | Only the publisher and the people the publisher picks. **Workspace admins get no special access**; a secret they were not given does not appear for them and answers "not found". People outside the workspace, guests and other workspaces cannot name or probe a secret (the same answer for "missing" and "not yours"). |
| Passing it on | Only the publisher can change the value, change who may read it, or delete it. A reader cannot share it further. |
| Accountability | Every reveal, change, grant and revoke is written to a log the publisher can read (who, what, when, never the value). People who are given access are notified. |
| Taking access back | Removing a person ends their access at once; a bug where a revoked grant still counted was found and fixed while writing the tests. |

Not done: secrets are not rotated or expired automatically, there is no second confirmation (password or code) before a reveal, and anyone who has read a value can of course copy it.

### Teamflow flows

An admin draws a flow for a project: a name, then 1 to 12 **stages** (for example Build, QA, Ship), each with the project's people; one person can be in one stage. The chart shows the stages left to right with arrows. In each person's box: the percentage of **their tasks in that project that are completed** and "x of y tasks done"; "no tasks" when none are assigned. A stage shows the combined percentage. A stage whose predecessor is not finished at 100% shows **Pending**, and so do its people. People see the flows of the projects they belong to; admins see all and are the only ones who create, edit or delete them. The earlier hand-off view stays as the second tab, "Hand-offs between teams".

How the percentage is worked out is a choice (tasks assigned to the person in the project, completed state group); if you meant tasks *created by* the earlier stage, it is a small change in `services/flows.py`.

### Data and API (migration `team_ops.0008_hub_sections_secrets_flows`)

New tables: `tops_hub_doc`, `tops_hub_secret`, `tops_hub_secret_access`, `tops_hub_secret_log`, `tops_flow`, `tops_flow_stage`, `tops_flow_stage_member`; new columns on `tops_hub_channel` (private pairs, General and News kinds) and `tops_hub_attachment` (library files). API under `team-ops/`: `hub/people/`, `hub/direct/`, `hub/docs/`, `hub/library/`, `hub/secrets/` (with `/reveal/` and `/access/`), `teamflow/flows/` (with `/members/`).

### Verification

409 Team Ops backend tests (new: 38 for the sections, secrets and flows), 143 unit tests in `@plane/services`, `tsc` and `oxlint` clean. Migrations `0006` to `0008` applied to a copy of the real server data (16 new tables, nothing else changed except Django's metadata), rolled back to `0005` and applied again. In a real browser: the Hub with its sections, Secrets, and a three-stage flow with a Pending chain. Not tested here: file upload and download against the real storage (no MinIO on this machine).

## Update: week plan, automatic hybrid, graph and weekly chart (fourth round)

- **Hybrid is worked out, not chosen.** The day starts with *Onsite* or *Remote*. Every task has a place, pre-set to that answer; starting a task in the other place makes the day *Hybrid* by itself. Onsite and remote hours are counted separately.
- **Week plan, Saturday to Friday, required.** The page shows the week with a choice per day (Onsite, Remote, Off). Until every working day from today to Friday has a plan (any entry counts: a day off, leave, or a day written by the weekly plan), **starting a timer is refused**. It can be done on any day of the week, not only on Saturday, and it is the same data as the calendar, so admins see it in the Team calendar. Weekends and holidays of the workspace need no plan. Past days are not asked for.
- **Contribution graph**: one square per day for the last year, weeks as columns starting on Saturday, in steps of blue; switch between *Tasks* (1, 2, 3-4, 5+ different tasks finished that day) and *Hours* (under 1, 3, 5, more). Hover shows the tasks and hours of the day. API: `work-sessions/heatmap/` (the caller, or a person the caller may see).
- **Weekly chart**: hours per day, Saturday to Friday, with filters for the place (all, onsite, remote) and for the hours of the day (from, to; a shortcut sets 09–18). A session counts in proportion to the part that falls inside the hours chosen.
- **Report tags**: besides teams, people can be tagged one by one. Someone who reads the project channel or a chosen team's channel is tagged there; anyone else gets the report as a private message.
- Verification: 419 Team Ops backend tests, 150 unit tests in `@plane/services`, `tsc` and `oxlint` clean; seen in a browser (week plan, chart, graph with a year of seeded work). No new migration.

## Update: Control (fifth round)

Sidebar item **Control**, one page with three tabs. Admins see all three; team leads (and anyone the team-view policy allows) see **Team control**; everyone else is told it is for admins and leads.

- **Team control**: filters for the period (today, this week, last 7, 30, 90 days), team and name; CSV export. Tiles: working now, worked, onsite, remote, frozen, people whose week is not planned. A table with one row per person: state now and task, worked, onsite / remote, tasks and finished work, rest pauses, frozen time and count, and whether the week plan is complete. Click a person for their year graph, time by task, finished work, and their pauses and freezes. Below: every missed check-in in the period. Refreshes every 20 seconds.
- **Hub control** (admins): every team, project, General and News channel with people, messages, messages in the last 24 hours, last message, and who may write. An admin can **lock** a channel (only admins write) and **review and remove** messages. Totals for documents, files (and their size), private conversations and secrets (counts only). **Private messages and secret values cannot be reached from here**: those endpoints answer "not found" for them, and tests check it.
- **Teamflow control** (admins): each flow with its progress, the stage that holds it, pending stages, people with no tasks, and hand-offs not opened for 48 hours.

API: `control/team/` (`export=csv`), `control/interruptions/`, `control/hub/` with `channels/<id>/` (lock, review) and `messages/<id>/` (remove), `control/flows/`. Migration `team_ops.0009_hub_channel_lock` adds the lock column.

Verification: 436 Team Ops backend tests (17 for Control, including rights, other workspaces, private messages and secrets out of reach), 157 unit tests in `@plane/services`, `tsc`, `oxlint` and the production build clean; migrations `0006` to `0009` applied, rolled back to `0005` and applied again on a copy of the real data (16 new tables, nothing else changed except Django's metadata); all three tabs seen in a browser.

## Update: week gate, parallel tasks, approvals, ranking, Teamflow for all, home (sixth round)

- **Gates (blurred page).** A person whose week is not planned sees the whole page blurred until Saturday to Friday is filled in. Then, once a day, the same for "How are you working today?" (Onsite or Remote). Today's answer is shown as a read-only badge at the top. It can only be changed from a red section at the very bottom, which asks again where each task finished today was done; different places make the day hybrid.
- **Parallel tasks.** Up to three tasks beside the main one, each with its own clock and Finish button, no check-in and no pauses. Their time is a separate figure (purple everywhere) and is never added to onsite or remote hours.
- **Hours and approval (Control).** A stacked chart per day for the team (onsite blue, remote green, parallel purple, frozen red) and a table per person; click a person for their days. Admins approve a person's days, one day or a whole period, or approve everyone's pending days at once, and can take an approval back. A day with work that nobody approved stays pending, and keeps showing in the next periods.
- **Ranking (Control).** By tasks or by hours, with medals and badges: Most tasks, Most hours, Hyperactive (parallel work of at least two hours and a quarter of the main hours), Most consistent.
- **Teamflow for everyone.** Any member of a project can draw, edit and delete the flow of that project (admins any). Work items created after a flow was drawn are **side tasks**: shown apart and never holding a stage back. A person of the flow with no open task left in the project is offered **Pull a task** (open, nobody on it) and **Merge into a task** (open, others on it).
- **Home** is now the person's own contribution page: totals, the year graph, and the last 90 days grouped by month. **Dashboard** has a tab strip (Overview, Views, Analytics, Archives; the last three open the existing pages) and a team hours chart.
- New: migration `team_ops.0010_parallel_and_approvals`, API `workday/parallel/`, `workday/day/override/`, `control/hours/`, `control/approvals/`, `control/ranking/`, `teamflow/flows/<id>/pull/`.
- Verification: 459 Team Ops backend tests, 157 unit tests in `@plane/services`, `tsc` and `oxlint` clean; migrations `0006` to `0010` applied, rolled back to `0005` and applied again on a copy of the real data (17 new tables, nothing else changed except Django's metadata). Seen in a browser: the week gate, hours chart with approvals, ranking. **Not seen in a browser:** the parallel task controls, the red change-of-answer section, Pull/Merge, the new Home and the Dashboard tabs.

## Update: the week plan is confirmed, then locked (seventh round)

The week plan is no longer saved day by day: the person picks Onsite, Remote or Off for each working day left in the week (Saturday to Friday), then presses **Confirm my week**. Until then the page stays blurred and no timer can be started. After confirming, the tiles are read-only; Control shows "Confirmed" (or "Not confirmed" / "n days missing") for each person. To change a confirmed plan the person uses the red section **Change my week plan** at the very bottom, which reopens it (the page is blurred again until it is confirmed anew) and **tells the admins and team leads**. New: migration `team_ops.0011_week_plan_confirmation`, API `workday/week/confirm/` and `workday/week/unlock/`.

Limit to know: the lock is in Workday. The calendar pages (My calendar, and an admin's edit of someone's day) still write plans directly, as before; they were not changed.

Verification: 465 Team Ops backend tests (6 new for confirmation), 157 unit tests in `@plane/services`, `tsc` and `oxlint` clean; the blurred gate with the Confirm button was seen in a browser. The red reopen section was not.

## Update: Control inside the Dashboard, Sum time, notification boxes (eighth round)

- **Control is now a tab of the Dashboard** (Overview | Control | Views | Analytics | Archives) and no longer a sidebar item. `/team-ops/control` still opens.
- **Sum time** (admins, tab in Control): every person (not teams) with their main hours, onsite and remote, parallel, frozen time, and a total, between any two dates (up to a year; the month so far by default). **Frozen time is never added by itself**: the admin counts it per person ("Count frozen") or for everyone at once, and can take it back. **Export Excel** writes one row per person and a total row. *Advanced options*: count parallel work **twice** (off by default). Total = main hours + parallel hours (twice if chosen) + counted frozen time.
- **Notification boxes.** "My notifications" (Control and the Dashboard overview) lists your own, opens the one you click and marks it read, with a button to mark it unread again. In a person's detail in Control there is a box with what that person was told and whether they have read it; **titles only, and never private messages or secrets**.
- **Workday.** The confirmed "Your week" card is now at the end of the page, above the red "Change my week plan". When a parallel task runs, the main task and the parallel ones sit inside one purple frame ("2 tasks at the same time"), each with its own clock. The admin's Workday is the same as everyone's; the admin is part of Control, ranking and Sum time like anybody else.
- **Dashboard hours chart** no longer shows parallel time (Control's own hours chart still does).
- **New flow notice.** Everyone put into a flow (when it is created, or later added to it) gets a notification "You are in the flow ..." that opens Teamflow, to add their tasks for the project. These appear in the notification boxes and in the "New for you" box in Workday; clicking opens the page.
- New: migration `team_ops.0012_freeze_credit_and_flow_notice`; API `control/sum/` (`export=xlsx|csv`, `parallel_double=1`), `control/sum/freeze/`, `control/notifications/?user=`; `notifications/` accepts `read: false`.
- Verification: 477 Team Ops backend tests (12 new), 160 unit tests in `@plane/services`, `tsc` and `oxlint` clean. Seen in a browser: the Dashboard tabs and the Sum time table. Not seen: the purple frame, the notification boxes, the Excel download.

## Update: Tasks (ninth round)

A **Tasks** tab in the Dashboard (the first tab for people who may not see the team) lists every work item of the person's projects (admins: all projects) in **one shape**: key and name, project, state, people, the Teamflows of its project with the stage the people on it are in (a task created after a flow was drawn is marked *side task*), and the time logged on it. Only top-level work items are rows; each has a **forks** list under it: its **sub work items** (same shape) and each **person** working on it with their own time, number of finished pieces of work, stage and whether it is done (people who logged time without being assigned are shown too). Filters: project, Teamflow, status (open or done), search, and "Only mine"; the list shows the latest 150. Parallel time is left out of the time shown. API: `tasks/`. No migration.

Verification: 485 Team Ops backend tests (8 new for Tasks), 161 unit tests in `@plane/services`, `tsc` and `oxlint` clean; the tab with its forks was seen in a browser.

## Update: Teamflow by modules, one bell, work item panel (tenth round)

- **A flow is an optional feature of a project, split into phases.** Pressing *New flow* asks for the project (or *+ New project*, created on the spot) and then phases; each phase **holds modules** of that project (existing ones as checkboxes with their people, or a new module made in place). The completion of a phase is the completion of its modules (done / total of their work items); a phase stays *Pending* until the phases before it reach 100%. The chart is one column per phase with a block per module (percent bar and people: module lead, members and assignees). Clicking a module lists its tasks, in the same row shape as the Tasks tab. This **replaces the people-based stages**: `tops_flow_stage_member` is dropped and `tops_flow_stage_module` is added by migration `team_ops.0013_flow_stage_modules`. Existing flows keep their name and phases but lose their per-stage people; open each one with *Edit* and tick its modules.
- Side tasks, *Pull a task* / *Merge into a task*, the Tasks tab chips and the Control overview (new: modules without tasks) all work from modules now. API: `teamflow/flows/modules/?project=` replaces `teamflow/flows/members/`; `tasks/` accepts `issue` and `module`.
- **One bell.** Plane's notification bell counts Team Ops notifications too, and Plane's notifications page shows them in a bar above its list. Team Ops keeps its own table, so nothing of Plane's is changed.
- **Work item panel.** A work item's side panel shows the time logged on it (total, per person), its flows, and a *Start working* button.
- **Doc Hub and Pages.** A document that belongs to a project is kept as a **Plane Page** of that project (public to its members), so it is written in Plane's own editor; the Doc Hub keeps the title, tags and project, and shows *Open in Pages*. The Hub text box is used only for documents without a project (Pages in this version are per project). A document given a project later gets its Page then. Renaming a document renames its Page; the text is edited in the Page only. Documents already in the Hub with a project get their Page the next time they are saved. Migration `team_ops.0014_hub_doc_page`.
- Verification: 492 Team Ops backend tests, `tsc`, `oxlint` and `@plane/services` tests clean. Seen in a browser: the module chart, a module's tasks, the New flow editor (project, modules per phase). Not seen: the one-bell count, the work item panel, migration 0013 on a copy of the real data.

## Update: relation graph on the module page (eleventh round)

On a module's page, **Add relation** (next to *Add work item*) switches the page from the work item layouts to a graph of the module's work items (`?relations=1` in the address; press it again to go back). Drag from the dot of one work item onto another, choose the kind (A blocks B, A is blocked by B, relates to, duplicate of) and Plane's own relation is created, the same one as *Add relation* inside a work item. Lines: red arrow = blocks, dashed purple = duplicate, dotted blue = relates to; clicking a line removes it. Work items that block others sit in columns to the right of what blocks them. Only relations between work items of the module are drawn. API: `GET team-ops/projects/<project>/modules/<module>/relations/` (project members, guests included); creating and removing use Plane's `issue-relation` and `remove-relation`. No migration. The graph is drawn like a commit history: one boxed row per work item, coloured dots on lanes, curved branch lines. **Drag a row by any part of its box onto another row to make it a sub work item** of that one (Plane's own parent; it is shown indented, and a work item cannot go under its own sub work item). Drag from the dot instead to choose a relation. Each row with a relation has a **red "-"** at its right end: it takes the work item out of all its relations, its parent and its sub work items. Click a line to remove just that one. The page keeps clear of the module sidebar when it is open. Seen in a browser: the graph, drags, the kind menu, a created arrow, sub work items, the red minus. Not seen: every kind of line drawn at once.

## Update: workspace admins see everything (twelfth round)

Plane lets someone open a project only if they are on that project's own member list, so a workspace admin who was never added to a project (above all a private one) saw it empty or not at all. A job in `team_ops` now keeps **every active workspace admin on every project of their workspace as a project admin**: it runs by itself every 5 minutes (Celery beat task `team-ops-sync-admin-access`, off with `TEAM_OPS_ENABLED=0`) and by hand with `python manage.py team_ops_sync_admin_access [--workspace <slug>]`. It adds missing rows, raises a guest or member row to admin, reactivates an inactive row, and changes nothing when everyone is already in place. Regular members and guests are never touched, and a workspace is never mixed with another. A new project shows up for the admins within 5 minutes. The job does not hook into Plane's project creation, so it cannot break it. Consequence to know: an admin who is removed from a project by hand is added back at the next run; to keep someone out, make them a member of the workspace instead of an admin. No migration. Backend: 504 Team Ops tests (8 new for this job).

## Update: push notifications and the installable app (thirteenth round)

Team Ops notifications now reach a person's **browser or phone, also when the app is closed** (Web Push, the standard browsers and phones use), and the app can be **installed** (PWA).

- **How it works.** Every notification is made in one place (`services/notifications.notify`). When someone in the list has turned push on and the server has keys, a Celery task (`deliver_push_task`) sends it to each of that person's devices, encrypted and signed with the server's VAPID key (library `pywebpush`). The message carries the title, a short body and the page it opens; a newer notification of the same kind replaces the one still on screen. Tapping it opens (or focuses) the app on that page. A failure of the push service never blocks the notification itself, which stays in the app (the bell and the notifications page as before).
- **Turning it on.** Until notifications are on, an **alert bar is shown on every page of the workspace**: *Turn on* (the browser asks for permission), plus *Install the app* where Chrome or Edge offer it. *Not now* hides it only until the page is opened again, so it keeps coming back until the person turns notifications on. If the browser has blocked them the bar explains how to allow them (the lock icon next to the address, or the site settings on a phone), and on an iPhone it explains how to add the app to the Home Screen first. Once they are on, Plane's notifications page shows *Send a test* and *Turn off*. Each browser or phone is one device; signing in as someone else on a device moves it to them. A device the browser has removed (HTTP 404 or 410), or that keeps failing, is dropped by itself.
- **Install.** `manifest.json` / `site.webmanifest.json` now describe the app as "Ultra Plane" (standalone, with icons and a maskable icon). Browsers offer *Install* (Chrome, Edge) or *Add to Home Screen* (phones). The service worker `public/team-ops-sw.js` only handles push and caches nothing, so a new release is never held back.
- **iPhone and iPad** deliver web push only to an app that was added to the Home Screen (iOS 16.4 or later); the page says so.
- **Needs on the server.** (1) A **valid HTTPS certificate** (browsers refuse service workers and push on a self-signed or untrusted certificate; `localhost` is the only exception). (2) Keys: run `python manage.py team_ops_vapid_keys --subject mailto:you@example.com` once and set `TEAM_OPS_VAPID_PUBLIC_KEY`, `TEAM_OPS_VAPID_PRIVATE_KEY` and `TEAM_OPS_VAPID_SUBJECT` on the **api, worker and beat-worker** containers. Keep the private key secret and do not change the pair later (every device would have to subscribe again). Without the keys the feature is off and the pages show nothing about it. (3) The `worker` must be running and reach the internet (the push services of Google, Mozilla and Apple).
- **New:** migration `team_ops.0015_push_subscription` (table `tops_push_subscription`, adds nothing to Plane's tables), dependency `pywebpush==2.5.0`, API `push/`, `push/subscribe/`, `push/unsubscribe/`, `push/test/`.
- **Verification.** 530 Team Ops backend tests (26 new, one of them with a real key pair that checks the message is encrypted and carries a VAPID signature), 167 unit tests in `@plane/services`, `tsc` and `oxlint` clean. In a browser: the service worker registers and activates, the manifest is read, and the offer appears on the Workday page. **Not seen:** a notification arriving on a real phone or browser (the test browser blocks notifications) and the install prompt; try both after deploying.

## Update: the Hub on a phone, and automatic deployment (fourteenth round)

- **Hub on a phone.** Below the tablet width the Hub is two screens instead of two columns squeezed together: the list of channels first, then the chat (or the document, file or secrets view) full width with a **← Hub** back button; the address keeps the open channel, so the browser back button works too. The Doc Hub does the same (list of documents, then the document, with **← Documents**). On a computer nothing changes. The page also takes the height that is left when the notification alert is shown, so the message box is never cut off.
- **Deployment.** The workflow `build-images-ghcr.yml` now has a `deploy` job that puts the new images on the server over SSH, using the secrets of the GitHub environment `mg-sfactory`. See "Automatic deployment" in `DEPLOY.md`.
