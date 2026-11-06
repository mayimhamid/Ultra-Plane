# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Day Reports, planned time and the Speedy / On time / OverTime verdict.

A person fills the report of a day with rows (a work item or a micro task, and the minutes spent on it) and
sends it at the end of the day. Until it is sent, today's report is a draft and can be changed freely. A
report that was already sent, or the report of a past day, can still be changed (from the calendar), but every
such change is kept as a revision and the person's managers are told.
"""

from dataclasses import dataclass
from datetime import time as time_of_day

# Django imports
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

# Third party imports
from rest_framework.exceptions import ParseError

# Module imports
from plane.db.models import Issue, IssueActivity, ProjectMember, State
from plane.team_ops.models import (
    CalendarEntry,
    DayReport,
    DayReportEntry,
    DayReportRevision,
    MicroTask,
    PlanUnit,
    TaskPlan,
    WorkDay,
)
from plane.team_ops.services.notifications import managers_of, notify
from plane.team_ops.services.weekly_plan import today_in_timezone

# A planned day is a working day of eight hours.
WORKDAY_MINUTES = 8 * 60
DAY_MINUTES = 24 * 60
# Finished in less than this share of the planned time: Speedy.
SPEEDY_SHARE = 0.75
# Up to the planned time plus this share (at least the minimum below) is still On time.
TOLERANCE_SHARE = 0.10
MIN_TOLERANCE = {PlanUnit.HOURS: 30, PlanUnit.DAYS: WORKDAY_MINUTES // 2}

SPEEDY, ON_TIME, OVERTIME, IN_PROGRESS = "SPEEDY", "ON_TIME", "OVERTIME", "IN_PROGRESS"
COMPLETED_GROUPS = ("completed",)
MAX_ROWS = 50


def to_minutes(amount, unit):
    """Planned amount in hours or days to minutes."""
    try:
        value = float(amount)
    except (TypeError, ValueError):
        raise ParseError(detail="The planned time must be a number.")
    if value <= 0 or value > 1000:
        raise ParseError(detail="The planned time must be more than 0.")
    if unit not in PlanUnit.values:
        raise ParseError(detail="The planned time is in hours or in days.")
    return max(1, round(value * (WORKDAY_MINUTES if unit == PlanUnit.DAYS else 60)))


def amount_of(minutes, unit):
    if minutes is None:
        return None
    return round(minutes / (WORKDAY_MINUTES if unit == PlanUnit.DAYS else 60), 2)


def verdict(planned, unit, reported, finished):
    """SPEEDY, ON_TIME, OVERTIME or IN_PROGRESS; `None` when the task has no planned time."""
    if not planned:
        return None
    tolerance = max(planned * TOLERANCE_SHARE, MIN_TOLERANCE.get(unit, 30))
    if reported > planned + tolerance:
        return OVERTIME
    if finished:
        return SPEEDY if reported < planned * SPEEDY_SHARE else ON_TIME
    return IN_PROGRESS


# --- planned time and progress of tasks ----------------------------------------------------------------------


@dataclass
class Progress:
    planned_minutes: int | None
    unit: str
    reported_minutes: int
    finished: bool

    @property
    def status(self):
        return verdict(self.planned_minutes, self.unit, self.reported_minutes, self.finished)

    def payload(self):
        return {
            "planned_minutes": self.planned_minutes,
            "planned_amount": amount_of(self.planned_minutes, self.unit),
            "unit": self.unit,
            "reported_minutes": self.reported_minutes,
            "finished": self.finished,
            "status": self.status,
        }


def issue_progress(issue_ids):
    """`{issue_id: Progress}`: plan, all the time reported on it by everyone, and whether it is done."""
    issue_ids = [i for i in set(issue_ids) if i]
    if not issue_ids:
        return {}
    plans = {p.issue_id: p for p in TaskPlan.objects.filter(issue_id__in=issue_ids)}
    reported = dict(
        DayReportEntry.objects.filter(issue_id__in=issue_ids, report__deleted_at__isnull=True)
        .values("issue_id")
        .annotate(total=Sum("minutes"))
        .values_list("issue_id", "total")
    )
    finished_rows = set(
        DayReportEntry.objects.filter(issue_id__in=issue_ids, finished=True, report__deleted_at__isnull=True)
        .values_list("issue_id", flat=True)
        .distinct()
    )
    completed = set(
        Issue.issue_objects.filter(pk__in=issue_ids, state__group__in=COMPLETED_GROUPS).values_list("pk", flat=True)
    )
    return {
        issue_id: Progress(
            plans[issue_id].planned_minutes if issue_id in plans else None,
            plans[issue_id].unit if issue_id in plans else PlanUnit.HOURS,
            reported.get(issue_id) or 0,
            issue_id in finished_rows or issue_id in completed,
        )
        for issue_id in issue_ids
    }


def micro_progress(tasks):
    ids = [task.id for task in tasks]
    reported = dict(
        DayReportEntry.objects.filter(micro_task_id__in=ids, report__deleted_at__isnull=True)
        .values("micro_task_id")
        .annotate(total=Sum("minutes"))
        .values_list("micro_task_id", "total")
    )
    return {task.id: Progress(task.planned_minutes, task.unit, reported.get(task.id) or 0, task.done) for task in tasks}


def can_plan(user, issue):
    """Project members (not guests) may set how long a work item should take."""
    return ProjectMember.objects.filter(project_id=issue.project_id, member=user, is_active=True, role__gte=15).exists()


def set_plan(workspace, issue, amount, unit):
    """Set (or with an empty amount, clear) the planned time of a work item."""
    if amount in (None, "", 0, "0"):
        TaskPlan.objects.filter(issue=issue).delete()
        return None
    minutes = to_minutes(amount, unit)
    plan = TaskPlan.objects.filter(issue=issue).first()
    if plan is None:
        return TaskPlan.objects.create(workspace=workspace, issue=issue, planned_minutes=minutes, unit=unit)
    plan.planned_minutes, plan.unit = minutes, unit
    plan.save()
    return plan


# --- reports ---------------------------------------------------------------------------------------------------


def _label(entry):
    if entry.issue_id and entry.issue:
        return f"{entry.issue.project.identifier}-{entry.issue.sequence_id} {entry.issue.name}"
    if entry.micro_task_id and entry.micro_task:
        return f"{'Meeting' if entry.micro_task.is_meeting else 'Micro task'}: {entry.micro_task.title}"
    return "Removed task"


def _snapshot(report):
    if report is None or report.pk is None:
        return []
    rows = report.entries.select_related("issue", "issue__project", "micro_task")
    return [
        {
            "task": _label(e),
            "minutes": e.minutes,
            "start": e.start_time.strftime("%H:%M") if e.start_time else None,
            "end": e.end_time.strftime("%H:%M") if e.end_time else None,
            "location": e.location,
            "finished": e.finished,
            "note": e.note,
        }
        for e in rows
    ]


def day_mode(workspace, user, day):
    """Onsite or remote that day: the day's answer, else the week plan."""
    answer = WorkDay.objects.filter(workspace=workspace, user=user, date=day).values_list("mode", flat=True).first()
    if answer:
        return answer
    return (
        CalendarEntry.objects.filter(workspace=workspace, user=user, work_date=day)
        .values_list("work_mode", flat=True)
        .first()
    )


def report_payload(workspace, user, day):
    report = DayReport.objects.filter(workspace=workspace, user=user, date=day).first()
    today = today_in_timezone(user.user_timezone)
    entries = (
        list(report.entries.select_related("issue", "issue__project", "issue__state", "micro_task")) if report else []
    )
    issues = issue_progress([e.issue_id for e in entries])
    micros = micro_progress([e.micro_task for e in entries if e.micro_task_id and e.micro_task])
    rows = []
    for entry in entries:
        if entry.issue_id and entry.issue:
            issue = entry.issue
            task = {
                "kind": "issue",
                "id": str(issue.id),
                "key": f"{issue.project.identifier}-{issue.sequence_id}",
                "name": issue.name,
                "project": {"id": str(issue.project_id), "name": issue.project.name},
                **issues[issue.id].payload(),
            }
        elif entry.micro_task_id and entry.micro_task:
            micro = entry.micro_task
            task = {
                "kind": "micro",
                "id": str(micro.id),
                "key": None,
                "name": micro.title,
                "is_meeting": micro.is_meeting,
                "project": None,
                **micros[micro.id].payload(),
            }
        else:
            task = None
        rows.append(
            {
                "id": str(entry.id),
                "task": task,
                "minutes": entry.minutes,
                "start": entry.start_time.strftime("%H:%M") if entry.start_time else None,
                "end": entry.end_time.strftime("%H:%M") if entry.end_time else None,
                "location": entry.location,
                "finished": entry.finished,
                "note": entry.note,
            }
        )
    submitted = bool(report and report.status == DayReport.Status.SUBMITTED)
    return {
        "date": day,
        "today": today,
        # Where the day was worked: from the rows (both places make it HYBRID), else the day's answer.
        "mode": day_place([entry.location for entry in entries], day_mode(workspace, user, day)),
        "planned_mode": day_mode(workspace, user, day),
        "status": report.status if report else DayReport.Status.DRAFT,
        "exists": report is not None,
        "submitted_at": report.submitted_at if report else None,
        "is_late": report.is_late if report else False,
        "edit_count": report.edit_count if report else 0,
        "last_edited_at": report.last_edited_at if report else None,
        "total_minutes": sum(entry.minutes for entry in entries),
        # A change from now on is recorded and the managers are told.
        "changes_are_recorded": submitted or day < today,
        "entries": rows,
    }


LOCATIONS = ("REMOTE", "ONSITE")


def _time(value, index, label):
    if value in (None, ""):
        return None
    try:
        return time_of_day.fromisoformat(str(value)[:5])
    except ValueError:
        raise ParseError(detail=f"Row {index}: the {label} time must look like 09:30.")


def day_place(locations, fallback=None):
    """REMOTE, ONSITE or HYBRID from the places of a day's rows; the day's answer when no row says."""
    places = {place for place in locations if place in LOCATIONS}
    if len(places) > 1:
        return "HYBRID"
    if places:
        return places.pop()
    return fallback


def _clean_rows(workspace, user, rows):
    if not isinstance(rows, list):
        raise ParseError(detail="The report must be a list of rows.")
    if len(rows) > MAX_ROWS:
        raise ParseError(detail=f"A report has at most {MAX_ROWS} rows.")
    cleaned = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ParseError(detail=f"Row {index} is not valid.")
        start = _time(row.get("start"), index, "start")
        end = _time(row.get("end"), index, "end")
        if (start is None) != (end is None):
            raise ParseError(detail=f"Row {index}: give both the start and the end time.")
        if start is not None:
            # Work done in one go: the time is from start to end.
            if end <= start:
                raise ParseError(detail=f"Row {index}: the end time must be after the start time.")
            minutes = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
        else:
            try:
                minutes = int(row.get("minutes") or 0)
            except (TypeError, ValueError):
                raise ParseError(detail=f"Row {index}: the time must be a number of minutes.")
        location = str(row.get("location") or "").upper()
        if location and location not in LOCATIONS:
            raise ParseError(detail=f"Row {index}: the place is remote or onsite.")
        if minutes <= 0 or minutes > DAY_MINUTES:
            raise ParseError(detail=f"Row {index}: enter the time spent (more than 0, at most 24 hours).")
        issue = micro = None
        if row.get("issue"):
            issue = Issue.issue_objects.filter(pk=row["issue"], workspace=workspace).select_related("project").first()
            member = (
                issue is not None
                and ProjectMember.objects.filter(project_id=issue.project_id, member=user, is_active=True).exists()
            )
            if not member:
                raise ParseError(detail=f"Row {index}: work item not found.")
        elif row.get("micro_task"):
            micro = MicroTask.objects.filter(pk=row["micro_task"], workspace=workspace, assignee=user).first()
            if micro is None:
                raise ParseError(detail=f"Row {index}: micro task not found.")
        else:
            raise ParseError(detail=f"Row {index}: choose a task.")
        cleaned.append(
            {
                "issue": issue,
                "micro_task": micro,
                "minutes": minutes,
                "start_time": start,
                "end_time": end,
                "location": location,
                "finished": bool(row.get("finished")),
                "note": str(row.get("note") or "")[:2000],
            }
        )
    if sum(row["minutes"] for row in cleaned) > DAY_MINUTES:
        raise ParseError(detail="A day has 24 hours: the rows add up to more than that.")
    return cleaned


def complete_issues(issues, actor):
    """Move each work item to the first Done state of its project (unless it is done already), as Plane would,
    with the change in its history. Only for people who may change the work item (members, not guests)."""
    moved = []
    for issue in {issue.id: issue for issue in issues}.values():
        state = issue.state if issue.state_id else None
        if state is not None and state.group in COMPLETED_GROUPS:
            continue
        if not ProjectMember.objects.filter(
            project_id=issue.project_id, member=actor, is_active=True, role__gte=15
        ).exists():
            continue
        done = State.objects.filter(project_id=issue.project_id, group="completed").order_by("sequence").first()
        if done is None:
            continue
        issue.state = done
        issue.updated_by = actor
        issue.save()
        IssueActivity.objects.create(
            issue=issue,
            project_id=issue.project_id,
            workspace_id=issue.workspace_id,
            actor=actor,
            verb="updated",
            field="state",
            old_value=state.name if state else "",
            new_value=done.name,
            old_identifier=state.id if state else None,
            new_identifier=done.id,
            comment="updated the state to (Day Report: done)",
            epoch=timezone.now().timestamp(),
        )
        moved.append(issue)
    return moved


def append_row(*, workspace, user, actor, day, row, reason=""):
    """Add one row to the report of `day`, keeping the rows already there (a task marked done in its project).

    Today's unsent report stays a draft; a sent report or a past day records the change, as any change does.
    """
    report = DayReport.objects.filter(workspace=workspace, user=user, date=day).first()
    rows = []
    if report is not None:
        for entry in report.entries.all():
            rows.append(
                {
                    "issue": str(entry.issue_id) if entry.issue_id else None,
                    "micro_task": str(entry.micro_task_id) if entry.micro_task_id else None,
                    "minutes": entry.minutes,
                    "start": entry.start_time.strftime("%H:%M") if entry.start_time else None,
                    "end": entry.end_time.strftime("%H:%M") if entry.end_time else None,
                    "location": entry.location,
                    "finished": entry.finished,
                    "note": entry.note,
                }
            )
    rows.append(row)
    return save_report(workspace=workspace, user=user, actor=actor, day=day, rows=rows, submit=False, reason=reason)


def save_report(*, workspace, user, actor, day, rows, submit, reason=""):
    """Save the report of `user` for `day`; `submit` sends it. Returns the payload.

    Today's draft changes freely. Sending the report of a past day, or changing a report that was already sent,
    is recorded as a revision (who, when, why, before and after) and the person's managers are told.
    """
    today = today_in_timezone(user.user_timezone)
    if day > today:
        raise ParseError(detail="A report can only be written for today or a past day.")
    cleaned = _clean_rows(workspace, user, rows)
    now = timezone.now()
    with transaction.atomic():
        report = DayReport.objects.select_for_update().filter(workspace=workspace, user=user, date=day).first()
        was_submitted = bool(report and report.status == DayReport.Status.SUBMITTED)
        before = _snapshot(report)
        if report is None:
            report = DayReport.objects.create(workspace=workspace, user=user, date=day)
        recorded = was_submitted or day < today
        # A past day is never left as a draft: saving it sends it.
        sending = submit or day < today or was_submitted
        report.entries.all().delete(soft=False)
        DayReportEntry.objects.bulk_create(
            [
                DayReportEntry(
                    report=report,
                    issue=row["issue"],
                    micro_task=row["micro_task"],
                    minutes=row["minutes"],
                    start_time=row["start_time"],
                    end_time=row["end_time"],
                    location=row["location"],
                    finished=row["finished"],
                    note=row["note"],
                    position=position,
                )
                for position, row in enumerate(cleaned)
            ]
        )
        for row in cleaned:
            micro = row["micro_task"]
            if micro is not None and row["finished"] and not micro.done:
                micro.done, micro.done_at = True, now
                micro.save(update_fields=["done", "done_at", "updated_at"])
        # "Done" in the report also moves the work item to its project's Done state.
        complete_issues([row["issue"] for row in cleaned if row["issue"] is not None and row["finished"]], actor)
        after = _snapshot(report)
        if sending and report.status != DayReport.Status.SUBMITTED:
            report.status = DayReport.Status.SUBMITTED
            report.submitted_at = now
            report.is_late = day < today
        changed = recorded and before != after
        late_first_send = day < today and not was_submitted
        if changed or late_first_send:
            DayReportRevision.objects.create(
                report=report,
                changed_by=actor,
                kind="LATE" if late_first_send else "CHANGE",
                reason=str(reason or "")[:2000],
                before=before,
                after=after,
            )
            report.edit_count += 1
            report.last_edited_at = now
        report.save()
    if changed or late_first_send:
        what = "sent late" if late_first_send else "changed"
        notify(
            workspace,
            managers_of(workspace, user),
            "REPORT",
            f"{user.display_name} {what} the day report of {day:%d %b}",
            (f"Reason: {reason}. " if reason else "")
            + f"Edited {report.edit_count} time{'s' if report.edit_count != 1 else ''}. "
            + "Open the report to see what changed.",
            link=f"team-ops/workday?date={day.isoformat()}&user={user.id}",
            actor=actor,
        )
    return report_payload(workspace, user, day)


def revisions_payload(report):
    return [
        {
            "id": revision.id,
            "kind": revision.kind,
            "reason": revision.reason,
            "changed_at": revision.changed_at,
            "changed_by": (
                {"id": str(revision.changed_by.id), "display_name": revision.changed_by.display_name}
                if revision.changed_by
                else None
            ),
            "before": revision.before,
            "after": revision.after,
        }
        for revision in report.revisions.select_related("changed_by")
    ]


# --- micro tasks -----------------------------------------------------------------------------------------------


def micro_payload(task, progress=None):
    progress = progress or micro_progress([task])[task.id]
    return {
        "id": str(task.id),
        "title": task.title,
        "description": task.description,
        "is_meeting": task.is_meeting,
        "assignee": {
            "id": str(task.assignee_id),
            "display_name": task.assignee.display_name,
            "avatar_url": task.assignee.avatar_url,
        },
        "created_by": str(task.created_by_id) if task.created_by_id else None,
        "due_date": task.due_date,
        "done": task.done,
        "done_at": task.done_at,
        "created_at": task.created_at,
        **progress.payload(),
    }


def create_micro(
    *,
    workspace,
    assignee,
    actor,
    title,
    description="",
    amount=None,
    unit=PlanUnit.HOURS,
    due_date=None,
    is_meeting=False,
):
    title = (title or "").strip()
    if not title:
        raise ParseError(detail="Give the task a title.")
    planned = to_minutes(amount, unit) if amount not in (None, "", 0, "0") else None
    return MicroTask.objects.create(
        workspace=workspace,
        assignee=assignee,
        title=title[:255],
        description=(description or "")[:5000],
        is_meeting=bool(is_meeting),
        planned_minutes=planned,
        unit=unit if unit in PlanUnit.values else PlanUnit.HOURS,
        due_date=due_date,
        created_by=actor,
        updated_by=actor,
    )
