# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What the team reported in their Day Reports over a period: the numbers behind Control and the Dashboard.

Only what people wrote in their reports counts (no timers, no freezes): hours per person and per day, where they
worked, which reports are missing, time per project, and how the tasks are going against their planned time.
"""

from collections import defaultdict

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import Issue, User
from plane.team_ops.models import DayReport, DayReportEntry
from plane.team_ops.services.day_reports import (
    counted_minutes,
    OVERTIME,
    ON_TIME,
    SPEEDY,
    day_place,
    issue_progress,
    micro_progress,
)
from plane.team_ops.services.day_resolution import iter_days, resolve_days

NOT_EXPECTED = ("OFF", "LEAVE")
# The project rows open to the tasks inside them, so every task of the period is sent (not only the top few).
TOP_TASKS = 300
MAX_TASK_ENTRIES = 40


def summary(workspace, settings_row, user_ids, start, end, place=""):
    """Everything Control and the Dashboard show for `user_ids` from `start` to `end`.

    `place` (REMOTE, ONSITE or HYBRID) keeps only the people-days worked that way.
    """
    user_ids = list(user_ids)
    today = timezone.now().date()
    entries = list(
        DayReportEntry.objects.filter(
            report__workspace=workspace,
            report__user_id__in=user_ids,
            report__date__gte=start,
            report__date__lte=end,
            report__deleted_at__isnull=True,
        ).select_related("report", "issue", "issue__project", "issue__state", "micro_task")
    )
    # Where each person worked each day, from the places of their rows.
    places = defaultdict(list)
    for entry in entries:
        places[(entry.report.user_id, entry.report.date)].append(entry.location)
    day_kind = {key: day_place(value, "") for key, value in places.items()}
    if place in ("REMOTE", "ONSITE", "HYBRID"):
        entries = [e for e in entries if day_kind.get((e.report.user_id, e.report.date)) == place]

    reports = {
        (r.user_id, r.date): r
        for r in DayReport.objects.filter(workspace=workspace, user_id__in=user_ids, date__gte=start, date__lte=end)
    }
    plans = resolve_days(workspace, settings_row, user_ids, start, end)
    names = {u.id: u for u in User.objects.filter(pk__in=user_ids)}

    issue_ids = {e.issue_id for e in entries if e.issue_id}
    micro_tasks = {e.micro_task_id: e.micro_task for e in entries if e.micro_task_id and e.micro_task}
    issue_state = issue_progress(issue_ids)
    micro_state = micro_progress(list(micro_tasks.values()))

    people = {}
    team_days = {
        day.isoformat(): {"date": day, "minutes": 0, "remote": 0, "onsite": 0, "people": set()}
        for day in iter_days(start, end)
    }
    projects = defaultdict(lambda: {"minutes": 0})
    tasks = defaultdict(lambda: {"minutes": 0, "people": set(), "entries": []})

    for user_id in user_ids:
        user = names.get(user_id)
        if user is None:
            continue
        expected = missing = sent = late = edits = 0
        for day in plans.get(user_id, []):
            date = day["date"]
            report = reports.get((user_id, _date(date)))
            works = day["is_working_day"] and day["mode"] not in NOT_EXPECTED
            if works and _date(date) <= today:
                expected += 1
                if report is None or report.status != DayReport.Status.SUBMITTED:
                    # Today is still open: only past days count as missing.
                    if _date(date) < today:
                        missing += 1
            if report is not None:
                sent += report.status == DayReport.Status.SUBMITTED
                late += report.is_late
                edits += report.edit_count
        people[user_id] = {
            "user": {"id": str(user.id), "display_name": user.display_name, "avatar_url": user.avatar_url},
            "total_minutes": 0,
            "remote_minutes": 0,
            "onsite_minutes": 0,
            "days": {},
            "places": {},
            "tasks": set(),
            "finished": 0,
            "speedy": 0,
            "on_time": 0,
            "overtime": 0,
            "expected_days": expected,
            "reports_sent": sent,
            "reports_missing": missing,
            "reports_late": late,
            "edits": edits,
        }

    # Overlapping work counts once in the totals of a person and a day (per-task figures keep every row's minutes)
    by_day = defaultdict(list)
    for entry in entries:
        by_day[(entry.report.user_id, entry.report.date)].append(entry)
    counted = {}
    for day_entries in by_day.values():
        counted.update(counted_minutes(day_entries))

    for entry in entries:
        user_id = entry.report.user_id
        if user_id not in people:
            continue
        person = people[user_id]
        key = entry.report.date.isoformat()
        mins = counted[entry.id]
        person["total_minutes"] += mins
        person["days"][key] = person["days"].get(key, 0) + mins
        person["places"][key] = day_kind.get((user_id, entry.report.date), "")
        if entry.location == "REMOTE":
            person["remote_minutes"] += mins
        elif entry.location == "ONSITE":
            person["onsite_minutes"] += mins
        day = team_days[key]
        day["minutes"] += mins
        day["people"].add(user_id)
        if entry.location == "REMOTE":
            day["remote"] += mins
        elif entry.location == "ONSITE":
            day["onsite"] += mins

        if entry.issue_id and entry.issue:
            project = entry.issue.project
            projects[str(project.id)].update(
                {"id": str(project.id), "name": project.name, "identifier": project.identifier}
            )
            projects[str(project.id)]["minutes"] += entry.minutes
            task_key = ("issue", entry.issue_id)
            tasks[task_key].update(
                {
                    "kind": "issue",
                    "id": str(entry.issue_id),
                    "key": f"{project.identifier}-{entry.issue.sequence_id}",
                    "name": entry.issue.name,
                    "project": project.name,
                    "project_id": str(project.id),
                    "state": (
                        {
                            "name": entry.issue.state.name,
                            "group": entry.issue.state.group,
                            "color": entry.issue.state.color,
                        }
                        if entry.issue.state_id
                        else None
                    ),
                    **issue_state[entry.issue_id].payload(),
                }
            )
        elif entry.micro_task_id and entry.micro_task:
            projects["micro"].update({"id": None, "name": "No project (micro tasks)", "identifier": ""})
            projects["micro"]["minutes"] += entry.minutes
            task_key = ("micro", entry.micro_task_id)
            tasks[task_key].update(
                {
                    "kind": "micro",
                    "id": str(entry.micro_task_id),
                    "key": None,
                    "name": entry.micro_task.title,
                    "project": None,
                    "project_id": None,
                    "state": {"name": "Done", "group": "completed", "color": "#16a34a"}
                    if entry.micro_task.done
                    else {"name": "Open", "group": "started", "color": "#f59e0b"},
                    **micro_state[entry.micro_task_id].payload(),
                }
            )
        else:
            continue
        tasks[task_key]["minutes"] += entry.minutes
        tasks[task_key]["people"].add(person["user"]["display_name"])
        if len(tasks[task_key]["entries"]) < MAX_TASK_ENTRIES:
            # When the time was spent: the day, from and to (when the row has them), who and how long.
            tasks[task_key]["entries"].append(
                {
                    "date": key,
                    "start": entry.start_time.strftime("%H:%M") if entry.start_time else None,
                    "end": entry.end_time.strftime("%H:%M") if entry.end_time else None,
                    "minutes": entry.minutes,
                    "person": person["user"]["display_name"],
                }
            )
        person["tasks"].add(task_key)

    # How each person's tasks are going, from all the time reported on them.
    for person in people.values():
        for task_key in person["tasks"]:
            status = tasks[task_key].get("status")
            if tasks[task_key].get("finished"):
                person["finished"] += 1
            if status == SPEEDY:
                person["speedy"] += 1
            elif status == ON_TIME:
                person["on_time"] += 1
            elif status == OVERTIME:
                person["overtime"] += 1
        person["task_count"] = len(person.pop("tasks"))

    # Work items of these people that reached a Done state in the period (from Plane's states).
    completed = defaultdict(set)
    for issue_id, assignee_id in (
        Issue.issue_objects.filter(
            workspace=workspace,
            state__group="completed",
            completed_at__date__gte=start,
            completed_at__date__lte=end,
            issue_assignee__assignee_id__in=user_ids,
            issue_assignee__deleted_at__isnull=True,
        )
        .values_list("id", "issue_assignee__assignee_id")
        .distinct()
    ):
        completed[assignee_id].add(issue_id)
    # Also the work items a person reported time on, assigned to them or not.
    done_reported = set(
        Issue.issue_objects.filter(
            pk__in=issue_ids, state__group="completed", completed_at__date__gte=start, completed_at__date__lte=end
        ).values_list("id", flat=True)
    )
    for entry in entries:
        if entry.issue_id in done_reported:
            completed[entry.report.user_id].add(entry.issue_id)
    for user_id, person in people.items():
        person["completed_tasks"] = len(completed.get(user_id, ()))

    rows = sorted(people.values(), key=lambda row: row["user"]["display_name"].lower())
    total = sum(row["total_minutes"] for row in rows)
    verdicts = {SPEEDY: 0, ON_TIME: 0, OVERTIME: 0}
    for task in tasks.values():
        if task.get("status") in verdicts:
            verdicts[task["status"]] += 1
    return {
        "from": start,
        "to": end,
        "totals": {
            "minutes": total,
            "remote_minutes": sum(row["remote_minutes"] for row in rows),
            "onsite_minutes": sum(row["onsite_minutes"] for row in rows),
            "people": len(rows),
            "people_reporting": sum(1 for row in rows if row["total_minutes"] > 0),
            "reports_sent": sum(row["reports_sent"] for row in rows),
            "reports_missing": sum(row["reports_missing"] for row in rows),
            "reports_late": sum(row["reports_late"] for row in rows),
            "edits": sum(row["edits"] for row in rows),
            "completed_tasks": len(set().union(*completed.values())) if completed else 0,
            "speedy": verdicts[SPEEDY],
            "on_time": verdicts[ON_TIME],
            "overtime": verdicts[OVERTIME],
        },
        "people": rows,
        "days": [
            {
                "date": day["date"],
                "minutes": day["minutes"],
                "remote_minutes": day["remote"],
                "onsite_minutes": day["onsite"],
                "people": len(day["people"]),
            }
            for day in team_days.values()
        ],
        "projects": sorted(projects.values(), key=lambda row: -row["minutes"]),
        "tasks": sorted(
            (
                {
                    **task,
                    "people": sorted(task["people"]),
                    "entries": sorted(task["entries"], key=lambda e: (e["date"], e["start"] or "")),
                }
                for task in tasks.values()
            ),
            key=lambda row: -row["minutes"],
        )[:TOP_TASKS],
    }


def _date(value):
    from datetime import date

    return value if isinstance(value, date) else date.fromisoformat(value)


def total_minutes(workspace, user_ids, start, end):
    """Minutes reported by `user_ids` in the period (used by quick totals); overlapping work counts once."""
    by_day = defaultdict(list)
    for entry in DayReportEntry.objects.filter(
        report__workspace=workspace, report__user_id__in=user_ids, report__date__gte=start, report__date__lte=end
    ).select_related("report"):
        by_day[(entry.report.user_id, entry.report.date)].append(entry)
    return sum(sum(counted_minutes(es).values()) for es in by_day.values())
