# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Task risk and workload: deterministic numbers about delivery, each with the reasons behind it.

Everything here is plain arithmetic over Plane's own rows. Nothing is guessed, and every score lists the
factors that produced it so a manager (or, later, an assistant) can explain it. Which tasks are in scope is
decided by the caller (`visible_projects` and the people the caller may see); this module never widens it.
"""

# Python imports
from datetime import datetime, timezone as dt_timezone

# Django imports
from django.db.models import Max, Sum

# Module imports
from plane.db.models import Issue, IssueActivity, IssueAssignee, IssueRelation
from plane.team_ops.models import TaskPlan, TimeEntry, WorkSession
from plane.team_ops.services.reports import plan_summary
from plane.team_ops.services.tasks import OPEN_GROUPS, visible_projects

# Longest period the workload capacity covers.
MAX_INSIGHT_DAYS = 62
# Most risky tasks returned.
RISK_LIMIT = 50

DUE_SOON_DAYS = 3
STALLED_DAYS = 7
HIGH_PRIORITIES = ("urgent", "high")

# code -> label, so every client words a factor the same way.
FACTOR_LABELS = {
    "OVERDUE": "Past its due date",
    "DUE_SOON": "Due within 3 days",
    "BLOCKED": "Blocked by an open work item",
    "STALLED": "Started but nothing recorded for 7 days",
    "UNASSIGNED": "Nobody is assigned",
    "NO_DUE_DATE": "High priority without a due date",
    "OVER_ESTIMATE": "More time logged than planned",
    "NO_ESTIMATE": "No planned time",
}

LEVEL_HIGH = "HIGH"
LEVEL_MEDIUM = "MEDIUM"
LEVEL_LOW = "LOW"
LEVEL_NONE = "NONE"


def risk_level(score):
    if score >= 60:
        return LEVEL_HIGH
    if score >= 30:
        return LEVEL_MEDIUM
    if score > 0:
        return LEVEL_LOW
    return LEVEL_NONE


def score_task(task, today, now):
    """Score one open task from plain facts. `task` is a dict with: `target_date`, `priority`, `state_group`,
    `assignee_count`, `blocked`, `planned_seconds` (or `None`), `logged_seconds`, `last_activity`.

    Returns `(score 0-100, [factor, ...])`; each factor is `{"code", "points", "detail"}`.
    """
    factors = []

    def add(code, points, detail):
        factors.append({"code": code, "points": points, "detail": detail})

    due = task["target_date"]
    if due is not None and due < today:
        late = (today - due).days
        add("OVERDUE", 40 + min(late * 3, 30), f"{late} day{'s' if late != 1 else ''} past the due date")
    elif due is not None and (due - today).days <= DUE_SOON_DAYS:
        left = (due - today).days
        add("DUE_SOON", 15, "Due today" if left == 0 else f"Due in {left} day{'s' if left != 1 else ''}")

    if task["blocked"]:
        add("BLOCKED", 25, "Waiting on a work item that is not done")

    if task["state_group"] == "started" and task["last_activity"] is not None:
        quiet = (now - task["last_activity"]).days
        if quiet >= STALLED_DAYS:
            add("STALLED", 20, f"No activity for {quiet} days")

    if task["assignee_count"] == 0:
        add("UNASSIGNED", 20, "Nobody is assigned")

    if due is None and task["priority"] in HIGH_PRIORITIES:
        add("NO_DUE_DATE", 10, f"{task['priority'].capitalize()} priority without a due date")

    planned = task["planned_seconds"]
    if planned:
        ratio = task["logged_seconds"] / planned
        if ratio > 1.5:
            add("OVER_ESTIMATE", 30, f"{round(ratio * 100)}% of the planned time is already logged")
        elif ratio > 1:
            add("OVER_ESTIMATE", 20, f"{round(ratio * 100)}% of the planned time is already logged")
    elif planned is None and task["state_group"] == "started":
        add("NO_ESTIMATE", 5, "Started without planned time")

    return min(100, sum(f["points"] for f in factors)), factors


def scoped_open_issues(workspace, user, is_admin, people, narrowed, project_id=None):
    """Open work items the caller may read. When `narrowed` (a lead's view, or a team/user filter) only those
    assigned to `people` are kept, and unassigned ones drop out because they belong to nobody in the view."""
    queryset = Issue.issue_objects.filter(
        project__in=visible_projects(workspace, user, is_admin), state__group__in=OPEN_GROUPS
    )
    if project_id:
        queryset = queryset.filter(project_id=project_id)
    if narrowed:
        queryset = queryset.filter(
            issue_assignee__assignee_id__in=[uid for uid, _ in people], issue_assignee__deleted_at__isnull=True
        ).distinct()
    return queryset


def _task_facts(workspace, issues, visible_ids=None):
    """One dict of plain facts per issue, with a handful of grouped queries rather than one per task."""
    ids = [row["id"] for row in issues]
    assignees = {}
    for issue_id, assignee_id in IssueAssignee.objects.filter(issue_id__in=ids).values_list("issue_id", "assignee_id"):
        assignees.setdefault(issue_id, []).append(assignee_id)
    blocked = set(
        IssueRelation.objects.filter(issue_id__in=ids, relation_type="blocked_by")
        .filter(related_issue__deleted_at__isnull=True, related_issue__archived_at__isnull=True)
        .exclude(related_issue__state__group__in=("completed", "cancelled"))
        .values_list("issue_id", flat=True)
    )
    planned = dict(
        TaskPlan.objects.filter(workspace=workspace, issue_id__in=ids).values_list("issue_id", "planned_minutes")
    )
    time_rows = (
        TimeEntry.objects.filter(workspace=workspace, issue_id__in=ids)
        .values("issue_id")
        .annotate(seconds=Sum("duration_seconds"), last=Max("ended_at"))
    )
    logged = {row["issue_id"]: row for row in time_rows}
    # Recorded events only. `Issue.updated_at` is not used: it moves on any save, including ones nobody made.
    last_event = {}

    def remember(issue_id, moment):
        if moment is not None and (issue_id not in last_event or moment > last_event[issue_id]):
            last_event[issue_id] = moment

    for row in IssueActivity.objects.filter(issue_id__in=ids).values("issue_id").annotate(last=Max("created_at")):
        remember(row["issue_id"], row["last"])
    for row in (
        WorkSession.objects.filter(workspace=workspace, issue_id__in=ids)
        .values("issue_id")
        .annotate(last=Max("finished_at"))
    ):
        remember(row["issue_id"], row["last"])
    for issue_id, row in logged.items():
        remember(issue_id, row["last"])

    facts = []
    for row in issues:
        issue_id = row["id"]
        spent = logged.get(issue_id)
        # The work item's creation is the floor: with nothing recorded since, it has been quiet since then.
        last = max(last_event.get(issue_id, row["created_at"]), row["created_at"])
        minutes = planned.get(issue_id)
        facts.append(
            {
                **row,
                "assignee_ids": [a for a in assignees.get(issue_id, []) if visible_ids is None or a in visible_ids],
                "assignee_count": len(assignees.get(issue_id, [])),
                "blocked": issue_id in blocked,
                "planned_seconds": minutes * 60 if minutes is not None else None,
                "logged_seconds": spent["seconds"] if spent else 0,
                "last_activity": last,
            }
        )
    return facts


ISSUE_FIELDS = (
    "id",
    "name",
    "sequence_id",
    "project_id",
    "project__identifier",
    "priority",
    "target_date",
    "created_at",
    "state__group",
)


def _issue_rows(queryset):
    rows = []
    for row in queryset.values(*ISSUE_FIELDS):
        row["state_group"] = row.pop("state__group")
        rows.append(row)
    return rows


def task_risks(workspace, user, is_admin, people, narrowed, today, now=None, limit=RISK_LIMIT, project_id=None):
    """Open tasks that carry risk, worst first, each with the factors that explain its score."""
    now = now or datetime.now(dt_timezone.utc)
    issues = _issue_rows(scoped_open_issues(workspace, user, is_admin, people, narrowed, project_id))
    scored = []
    summary = {LEVEL_HIGH: 0, LEVEL_MEDIUM: 0, LEVEL_LOW: 0, LEVEL_NONE: 0}
    for task in _task_facts(workspace, issues, {uid for uid, _ in people} if narrowed else None):
        score, factors = score_task(task, today, now)
        level = risk_level(score)
        summary[level] += 1
        if level == LEVEL_NONE:
            continue
        scored.append(
            {
                "issue": task["id"],
                "name": task["name"],
                "key": f"{task['project__identifier']}-{task['sequence_id']}",
                "project": task["project_id"],
                "priority": task["priority"],
                "target_date": task["target_date"],
                "assignees": task["assignee_ids"],
                "score": score,
                "level": level,
                "factors": factors,
            }
        )
    scored.sort(key=lambda item: (-item["score"], item["key"]))
    return {"summary": summary, "open_tasks": sum(summary.values()), "tasks": scored[:limit]}


def workload(workspace, settings_row, user, is_admin, people, narrowed, start, end, today, project_id=None):
    """Per person: open tasks, overdue ones and planned minutes left, against the time their calendar gives them
    in `[start, end]`. `load` is `None` when the calendar has no planned hours to compare with."""
    issues = _issue_rows(scoped_open_issues(workspace, user, is_admin, people, narrowed, project_id))
    facts = _task_facts(workspace, issues)
    capacity = {
        row["user"]: row["planned_seconds"]
        for row in plan_summary(workspace, settings_row, people, start, end)["people"]
    }

    rows = []
    for user_id, _ in people:
        mine = [task for task in facts if user_id in task["assignee_ids"]]
        remaining = 0
        for task in mine:
            if task["planned_seconds"]:
                # Time already logged is not left to do; split a shared task between its assignees.
                left = max(task["planned_seconds"] - task["logged_seconds"], 0)
                remaining += left // max(task["assignee_count"], 1)
        seconds = capacity.get(user_id, 0)
        load = round(remaining / seconds, 2) if seconds else None
        rows.append(
            {
                "user": user_id,
                "open_tasks": len(mine),
                "overdue_tasks": sum(1 for t in mine if t["target_date"] and t["target_date"] < today),
                "unestimated_tasks": sum(1 for t in mine if t["planned_seconds"] is None),
                "remaining_seconds": remaining,
                "capacity_seconds": seconds,
                "load": load,
                "status": _load_status(load),
            }
        )
    rows.sort(key=lambda r: (-(r["load"] or 0), -r["open_tasks"]))
    unassigned = sum(1 for t in facts if t["assignee_count"] == 0)
    return {"people": rows, "unassigned_tasks": unassigned}


def _load_status(load):
    if load is None:
        return "UNKNOWN"
    if load > 1:
        return "OVERLOADED"
    if load < 0.3:
        return "LIGHT"
    return "BALANCED"


def build_insights(workspace, settings_row, user, is_admin, people, narrowed, start, end, today, project_id=None):
    """Risk and workload together, for the people and projects the caller may see."""
    return {
        "today": today,
        "risks": task_risks(workspace, user, is_admin, people, narrowed, today, project_id=project_id),
        "workload": workload(workspace, settings_row, user, is_admin, people, narrowed, start, end, today, project_id),
        "factor_labels": FACTOR_LABELS,
        "notice": "Scores are computed from due dates, assignments, planned and logged time and activity. "
        "They flag where to look; they are not a judgement of a person.",
    }
