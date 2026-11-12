# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Quality of work per person: what a manager asks after "how many hours?".

- Delivery: tasks finished in the period, on time or late against their due date.
- Rework: finished tasks that were reopened in the period (the work came back).
- Estimates: on finished tasks with a planned time, the time reported against the plan.
- Focus: how the time splits between projects, meetings and micro tasks, and how many different tasks a day.
- Communication: documents written when finishing work, comments on work items.
- Reliability: reports sent, late, changed.
- Trend: the same numbers for the period just before.

Plain arithmetic over Plane's rows, limited to the projects the caller may read. Each number is a reason to look,
not a verdict: a late task can have a good reason, a reopened task can be someone else's change of mind.
"""

# Python imports
from collections import defaultdict
from datetime import timedelta
from statistics import median

# Django imports
from django.db.models import Count, Sum

# Module imports
from plane.db.models import Issue, IssueActivity, IssueAssignee, IssueComment, State
from plane.team_ops.models import DayReport, DayReportEntry, TaskPlan, WorkSession

OVERRUN = 1.5
MEETING_HEAVY = 0.4
SCATTERED_TASKS_A_DAY = 5

NOTICE = (
    "Quality numbers come from Plane: finished tasks and their due dates, reopened tasks, planned against reported "
    "time, documents and comments. They show where to look; a late or reopened task can have a good reason."
)


def _rate(part, whole):
    return round(100 * part / whole) if whole else None


def _period_numbers(workspace, projects, user_ids, start, end):
    """The raw numbers of one period, per person."""
    out = {uid: defaultdict(int) for uid in user_ids}
    done_ids = set(State.objects.filter(project__in=projects, group="completed").values_list("id", flat=True))

    # Delivery: tasks assigned to the person, finished in the period.
    finished = (
        Issue.issue_objects.filter(
            project__in=projects,
            state__group="completed",
            completed_at__date__gte=start,
            completed_at__date__lte=end,
            issue_assignee__assignee_id__in=user_ids,
            issue_assignee__deleted_at__isnull=True,
        )
        .values("id", "target_date", "completed_at", "issue_assignee__assignee_id")
        .distinct()
    )
    finished_by_person = defaultdict(set)
    for row in finished:
        uid = row["issue_assignee__assignee_id"]
        if row["id"] in finished_by_person[uid]:
            continue
        finished_by_person[uid].add(row["id"])
        numbers = out[uid]
        numbers["finished"] += 1
        if row["target_date"] is None:
            numbers["finished_without_due_date"] += 1
        elif row["completed_at"].date() <= row["target_date"]:
            numbers["finished_on_time"] += 1
        else:
            numbers["finished_late"] += 1
            numbers["days_late_total"] += (row["completed_at"].date() - row["target_date"]).days

    # Rework: a finished task set back to an open state in the period.
    reopened = IssueActivity.objects.filter(
        project__in=projects,
        field="state",
        old_identifier__in=done_ids,
        created_at__date__gte=start,
        created_at__date__lte=end,
    ).exclude(new_identifier__in=done_ids)
    assignees = defaultdict(set)
    reopened_issue_ids = set(reopened.values_list("issue_id", flat=True))
    for issue_id, uid in IssueAssignee.objects.filter(
        issue_id__in=reopened_issue_ids, assignee_id__in=user_ids
    ).values_list("issue_id", "assignee_id"):
        assignees[issue_id].add(uid)
    for issue_id in reopened_issue_ids:
        for uid in assignees.get(issue_id, ()):
            out[uid]["reopened"] += 1

    # Estimates: planned against all time reported on each finished task.
    all_finished = set().union(*finished_by_person.values()) if finished_by_person else set()
    plans = dict(
        TaskPlan.objects.filter(workspace=workspace, issue_id__in=all_finished).values_list(
            "issue_id", "planned_minutes"
        )
    )
    reported = dict(
        DayReportEntry.objects.filter(issue_id__in=plans, report__status=DayReport.Status.SUBMITTED)
        .values("issue_id")
        .annotate(total=Sum("minutes"))
        .values_list("issue_id", "total")
    )
    ratios = defaultdict(list)
    for uid, ids in finished_by_person.items():
        for issue_id in ids:
            planned = plans.get(issue_id)
            if planned:
                ratios[uid].append((reported.get(issue_id) or 0) / planned)

    # Focus: how the reported time splits.
    entries = DayReportEntry.objects.filter(
        report__workspace=workspace,
        report__user_id__in=user_ids,
        report__status=DayReport.Status.SUBMITTED,
        report__date__gte=start,
        report__date__lte=end,
    ).values(
        "report__user_id",
        "report__date",
        "issue_id",
        "issue__project__name",
        "micro_task_id",
        "micro_task__is_meeting",
        "minutes",
    )
    projects_time = defaultdict(lambda: defaultdict(int))
    tasks_per_day = defaultdict(lambda: defaultdict(set))
    for row in entries:
        uid = row["report__user_id"]
        numbers = out[uid]
        numbers["reported_minutes"] += row["minutes"]
        if row["issue_id"]:
            projects_time[uid][row["issue__project__name"] or "Unknown project"] += row["minutes"]
            tasks_per_day[uid][row["report__date"]].add(("issue", row["issue_id"]))
        else:
            if row["micro_task__is_meeting"]:
                numbers["meeting_minutes"] += row["minutes"]
                projects_time[uid]["Meetings"] += row["minutes"]
            else:
                numbers["micro_minutes"] += row["minutes"]
                projects_time[uid]["Micro tasks"] += row["minutes"]
            tasks_per_day[uid][row["report__date"]].add(("micro", row["micro_task_id"]))

    # Communication.
    for row in WorkSession.objects.filter(
        workspace=workspace, user_id__in=user_ids, finished_at__date__gte=start, finished_at__date__lte=end
    ).values("user_id", "document_text"):
        out[row["user_id"]]["work_sessions"] += 1
        if (row["document_text"] or "").strip():
            out[row["user_id"]]["documents"] += 1
    for row in (
        IssueComment.objects.filter(
            project__in=projects, actor_id__in=user_ids, created_at__date__gte=start, created_at__date__lte=end
        )
        .values("actor_id")
        .annotate(n=Count("id"))
    ):
        out[row["actor_id"]]["comments"] = row["n"]

    # Reliability.
    for row in DayReport.objects.filter(
        workspace=workspace, user_id__in=user_ids, date__gte=start, date__lte=end, status=DayReport.Status.SUBMITTED
    ).values("user_id", "is_late", "edit_count"):
        numbers = out[row["user_id"]]
        numbers["reports_sent"] += 1
        numbers["reports_late"] += int(row["is_late"])
        numbers["reports_changed"] += int(bool(row["edit_count"]))

    for uid in user_ids:
        days = tasks_per_day[uid]
        out[uid]["days_reported"] = len(days)
        out[uid]["tasks_a_day"] = round(sum(len(t) for t in days.values()) / len(days), 1) if days else 0
        rs = ratios[uid]
        out[uid]["estimated_finished"] = len(rs)
        out[uid]["over_estimate"] = sum(1 for r in rs if r > OVERRUN)
        out[uid]["estimate_ratio"] = round(median(rs), 2) if rs else None
    return out, projects_time


def _notes(now, before):
    """Plain-language observations, the most important first."""
    notes = []
    if now["finished_late"]:
        notes.append(
            f"{now['finished_late']} of {now['finished']} finished tasks were late "
            f"(on average {round(now['days_late_total'] / now['finished_late'], 1)} days)"
        )
    if now["reopened"]:
        notes.append(f"{now['reopened']} finished tasks were reopened (work came back)")
    if now["over_estimate"]:
        notes.append(f"{now['over_estimate']} tasks took more than 1.5x their planned time")
    if now["reported_minutes"] and now["meeting_minutes"] / now["reported_minutes"] >= MEETING_HEAVY:
        notes.append(f"{_rate(now['meeting_minutes'], now['reported_minutes'])}% of the time was in meetings")
    if now["tasks_a_day"] >= SCATTERED_TASKS_A_DAY:
        notes.append(f"about {now['tasks_a_day']} different tasks a day (attention is spread thin)")
    if now["work_sessions"] and not now["documents"]:
        notes.append("finished work without writing any document")
    if now["reports_late"]:
        notes.append(f"{now['reports_late']} reports sent late")
    if before["reported_minutes"] and now["reported_minutes"] < before["reported_minutes"] * 0.7:
        notes.append(
            f"reported time fell from {round(before['reported_minutes'] / 60, 1)} h to "
            f"{round(now['reported_minutes'] / 60, 1)} h compared with the period before"
        )
    if before["finished"] and now["finished"] < before["finished"] * 0.5:
        notes.append(f"finished tasks fell from {before['finished']} to {now['finished']}")
    if not notes and now["reported_minutes"]:
        notes.append("nothing stands out")
    return notes


def build_quality(workspace, projects, people, start, end):
    """Quality per person in `people` (`[(user_id, tz)]`) for `[start, end]`, with the period before as trend."""
    from plane.db.models import User

    user_ids = [uid for uid, _ in people]
    length = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)
    now, projects_time = _period_numbers(workspace, projects, user_ids, start, end)
    before, _ = _period_numbers(workspace, projects, user_ids, prev_start, prev_end)
    users = {u.id: u for u in User.objects.filter(pk__in=user_ids).only("id", "display_name", "avatar")}

    rows = []
    for uid in user_ids:
        n, b = now[uid], before[uid]
        user = users.get(uid)
        split = sorted(projects_time[uid].items(), key=lambda kv: -kv[1])
        rows.append(
            {
                "user": {
                    "id": uid,
                    "display_name": user.display_name if user else "Unknown",
                    "avatar_url": user.avatar_url if user else None,
                },
                "reported_hours": round(n["reported_minutes"] / 60, 1),
                "days_reported": n["days_reported"],
                "finished": n["finished"],
                "finished_on_time": n["finished_on_time"],
                "finished_late": n["finished_late"],
                "finished_without_due_date": n["finished_without_due_date"],
                "on_time_rate": _rate(n["finished_on_time"], n["finished_on_time"] + n["finished_late"]),
                "reopened": n["reopened"],
                "estimated_finished": n["estimated_finished"],
                "over_estimate": n["over_estimate"],
                "estimate_ratio": n["estimate_ratio"],
                "meeting_share": _rate(n["meeting_minutes"], n["reported_minutes"]),
                "tasks_a_day": n["tasks_a_day"],
                "documents": n["documents"],
                "work_sessions": n["work_sessions"],
                "comments": n["comments"],
                "reports_sent": n["reports_sent"],
                "reports_late": n["reports_late"],
                "reports_changed": n["reports_changed"],
                "projects": [{"name": name, "hours": round(m / 60, 1)} for name, m in split[:6]],
                "previous": {
                    "reported_hours": round(b["reported_minutes"] / 60, 1),
                    "finished": b["finished"],
                    "on_time_rate": _rate(b["finished_on_time"], b["finished_on_time"] + b["finished_late"]),
                    "reopened": b["reopened"],
                },
                "notes": _notes(n, b),
            }
        )
    rows.sort(key=lambda r: (-r["reported_hours"], r["user"]["display_name"]))
    return {"previous_from": prev_start, "previous_to": prev_end, "people": rows, "notice": NOTICE}


def quality_lines(quality):
    """One line per person, for Ask and Answer."""
    lines = []
    for row in quality["people"]:
        prev = row["previous"]
        on_time = f"{row['on_time_rate']}% on time" if row["on_time_rate"] is not None else "no due dates"
        ratio = f", estimates x{row['estimate_ratio']}" if row["estimate_ratio"] is not None else ""
        lines.append(
            f"{row['user']['display_name']}: {row['finished']} tasks finished "
            f"({on_time}, {row['finished_late']} late), "
            f"{row['reopened']} reopened{ratio}, {row['over_estimate']} over 1.5x plan, "
            f"{row['tasks_a_day']} tasks a day, meetings {row['meeting_share'] or 0}%, "
            f"{row['documents']} documents, {row['comments']} comments | before: {prev['reported_hours']} h, "
            f"{prev['finished']} finished | notes: {'; '.join(row['notes']) or '-'}"
        )
    return lines


def project_lines(quality):
    return [
        f"{row['user']['display_name']}: " + ", ".join(f"{p['name']} {p['hours']} h" for p in row["projects"])
        for row in quality["people"]
        if row["projects"]
    ]
