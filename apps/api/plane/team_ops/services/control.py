# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Control: what managers see about people's tasks and hours, the Hub, and the flows."""

# Python imports
from datetime import timedelta

# Django imports
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

# Module imports
from plane.team_ops.models import (
    CalendarEntry,
    CalendarHoliday,
    FreezeCredit,
    HubAttachment,
    HubChannel,
    HubDoc,
    HubMessage,
    HubSecret,
    OpsNotification,
    WeekPlanConfirmation,
    WorkApproval,
    WorkInterruption,
    WorkSession,
)
from plane.team_ops.services import flows as flow_service
from plane.team_ops.services import hub, teamflow
from plane.team_ops.services.policy import get_policy
from plane.team_ops.services.weekly_plan import today_in_timezone
from plane.team_ops.services.workday import _zone, day_window, team_status, week_start_of

STALE_HANDOFF_HOURS = 48


def week_compliance(workspace, user_ids, reference_user):
    """`{user_id: number of working days still unplanned this week}`, worked out for everyone in a few queries."""
    today = today_in_timezone(reference_user.user_timezone)
    start = week_start_of(today)
    end = start + timedelta(days=6)
    working = get_policy(workspace).working_weekdays
    holidays = set(
        CalendarHoliday.objects.filter(workspace=workspace, date__range=(start, end)).values_list("date", flat=True)
    )
    needed = [
        start + timedelta(days=i)
        for i in range(7)
        if (start + timedelta(days=i)) >= today
        and (start + timedelta(days=i)).isoweekday() in working
        and (start + timedelta(days=i)) not in holidays
    ]
    planned = {}
    for user_id, day in CalendarEntry.objects.filter(
        workspace=workspace, user_id__in=user_ids, work_date__in=needed
    ).values_list("user_id", "work_date"):
        planned.setdefault(user_id, set()).add(day)
    return {user_id: len([d for d in needed if d not in planned.get(user_id, set())]) for user_id in user_ids}


def team_overview(workspace, user_ids, start, end, reference_user):
    """One row per person: today's state plus the work, places, pauses and freezes of the period `[start, end]`."""
    zone = _zone(reference_user)
    window_start = day_window(start, zone)[0]
    window_end = day_window(end, zone)[1]
    sessions = {
        row["user_id"]: row
        for row in WorkSession.objects.filter(
            workspace=workspace, user_id__in=user_ids, finished_at__gte=window_start, finished_at__lt=window_end
        )
        .values("user_id")
        .annotate(
            seconds=Sum("duration_seconds", filter=Q(is_parallel=False)),
            onsite=Sum("duration_seconds", filter=Q(location="ONSITE", is_parallel=False)),
            remote=Sum("duration_seconds", filter=Q(location="REMOTE", is_parallel=False)),
            parallel=Sum("duration_seconds", filter=Q(is_parallel=True)),
            sessions=Count("id"),
            tasks=Count("issue", distinct=True),
            without_document=Count("id", filter=Q(no_document=True)),
            attention=Count("id", filter=Q(needs_attention=True)),
        )
    }
    freezes = {
        row["user_id"]: row
        for row in WorkInterruption.objects.filter(
            workspace=workspace,
            user_id__in=user_ids,
            kind="FREEZE",
            started_at__gte=window_start,
            started_at__lt=window_end,
        )
        .values("user_id")
        .annotate(count=Count("id"))
    }
    interruptions = {}
    now = timezone.now()
    for item in WorkInterruption.objects.filter(
        workspace=workspace, user_id__in=user_ids, started_at__gte=window_start, started_at__lt=window_end
    ):
        seconds = max(0, int(((item.ended_at or now) - item.started_at).total_seconds()))
        entry = interruptions.setdefault(item.user_id, {"BREAK": 0, "FREEZE": 0})
        entry[item.kind] += seconds
    unplanned = week_compliance(workspace, user_ids, reference_user)
    confirmed = set(
        WeekPlanConfirmation.objects.filter(
            workspace=workspace,
            user_id__in=user_ids,
            week_start=week_start_of(today_in_timezone(reference_user.user_timezone)),
        ).values_list("user_id", flat=True)
    )
    rows = []
    for live in team_status(workspace, user_ids, reference_user):
        user_id = live["user"]["id"]
        done = sessions.get(user_id, {})
        rows.append(
            {
                **live,
                "period": {
                    "seconds": done.get("seconds") or 0,
                    "onsite_seconds": done.get("onsite") or 0,
                    "remote_seconds": done.get("remote") or 0,
                    "parallel_seconds": done.get("parallel") or 0,
                    "sessions": done.get("sessions", 0),
                    "tasks": done.get("tasks", 0),
                    "without_document": done.get("without_document", 0),
                    "attention": done.get("attention", 0),
                    "break_seconds": interruptions.get(user_id, {}).get("BREAK", 0),
                    "frozen_seconds": interruptions.get(user_id, {}).get("FREEZE", 0),
                    "freezes": freezes.get(user_id, {}).get("count", 0),
                },
                "unplanned_days": unplanned.get(user_id, 0),
                "week_confirmed": user_id in confirmed,
            }
        )
    totals = {
        key: sum(row["period"][key] for row in rows)
        for key in (
            "seconds",
            "onsite_seconds",
            "remote_seconds",
            "parallel_seconds",
            "sessions",
            "break_seconds",
            "frozen_seconds",
            "freezes",
        )
    }
    totals["unplanned_people"] = len([row for row in rows if row["unplanned_days"] > 0 or not row["week_confirmed"]])
    totals["working_now"] = len([row for row in rows if row["state"] == "RUNNING"])
    return rows, totals


def interruption_list(workspace, user_ids, start, end, reference_user, kind=None):
    """Breaks and freezes in a period, newest first."""
    zone = _zone(reference_user)
    queryset = WorkInterruption.objects.filter(
        workspace=workspace,
        user_id__in=user_ids,
        started_at__gte=day_window(start, zone)[0],
        started_at__lt=day_window(end, zone)[1],
    ).select_related("user", "issue", "issue__project")
    if kind:
        queryset = queryset.filter(kind=kind)
    now = timezone.now()
    return [
        {
            "kind": item.kind,
            "user": {"id": item.user_id, "display_name": item.user.display_name},
            "work_item": f"{item.issue.project.identifier}-{item.issue.sequence_id}" if item.issue_id else None,
            "started_at": item.started_at,
            "ended_at": item.ended_at,
            "seconds": max(0, int(((item.ended_at or now) - item.started_at).total_seconds())),
        }
        for item in queryset.order_by("-started_at")[:300]
    ]


def hub_overview(workspace):
    """The Hub as an admin sees it: channels and how busy they are, and the size of the rest. No private messages,
    no secret names, no values."""
    channels = (
        HubChannel.objects.filter(workspace=workspace)
        .exclude(kind=HubChannel.Kind.DM)
        .select_related("team", "project")
        .annotate(
            message_count=Count("messages", filter=Q(messages__is_deleted=False)),
            last_at=Max("messages__created_at"),
        )
    )
    day_ago = timezone.now() - timedelta(days=1)
    recent = dict(
        HubMessage.objects.filter(channel__workspace=workspace, created_at__gte=day_ago, is_deleted=False)
        .values_list("channel_id")
        .annotate(count=Count("id"))
    )
    rows = []
    for channel in channels:
        rows.append(
            {
                "id": channel.id,
                "kind": channel.kind,
                "name": hub.channel_name(channel, None),
                "members": len(hub.channel_member_ids(channel)),
                "messages": channel.message_count,
                "last_at": channel.last_at,
                "today": recent.get(channel.id, 0),
                "is_locked": channel.is_locked,
            }
        )
    order = {"NEWS": 0, "GENERAL": 1, "TEAM": 2, "PROJECT": 3}
    rows.sort(key=lambda row: (order[row["kind"]], row["name"].lower()))
    files = HubAttachment.objects.filter(workspace=workspace).aggregate(count=Count("id"), bytes=Sum("size"))
    return {
        "channels": rows,
        "private_conversations": HubChannel.objects.filter(workspace=workspace, kind=HubChannel.Kind.DM).count(),
        "docs": HubDoc.objects.filter(workspace=workspace).count(),
        "files": files["count"],
        "file_bytes": files["bytes"] or 0,
        "secrets": HubSecret.objects.filter(workspace=workspace).count(),
        "secret_publishers": HubSecret.objects.filter(workspace=workspace).values("publisher").distinct().count(),
    }


def flow_overview(workspace):
    """Every flow with where it is stuck, and the hand-offs nobody has opened for two days."""
    result = []
    for flow in flow_service.visible_flows(workspace, None, True).prefetch_related("stages"):
        described = flow_service.describe(flow)
        stages = described["stages"]
        done = sum(stage["done"] for stage in stages)
        total = sum(stage["total"] for stage in stages)
        current = next((index for index, stage in enumerate(stages) if stage["percent"] != 100), None)
        waiting = [] if current is None else [m["name"] for m in stages[current]["modules"] if m["total"] == 0]
        result.append(
            {
                **described,
                "percent": None if total == 0 else round(done * 100 / total),
                "current_stage": None if current is None else stages[current]["name"],
                "finished": current is None,
                "pending_stages": len([stage for stage in stages if stage["pending"]]),
                "modules_without_tasks": waiting,
            }
        )
    from plane.team_ops.models import OpsTeam

    team_ids = set(OpsTeam.objects.filter(workspace=workspace).values_list("id", flat=True))
    cutoff = timezone.now() - timedelta(hours=STALE_HANDOFF_HOURS)
    stale = [
        row
        for row in teamflow.handoffs(workspace, visible_team_ids=team_ids, status=teamflow.PENDING)
        if row["created_at"] <= cutoff
    ]
    return {"flows": result, "stale_handoffs": stale, "stale_after_hours": STALE_HANDOFF_HOURS}


def _dates(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def hours_by_day(workspace, user_ids, start, end, reference_user):
    """For each person and day: onsite, remote, parallel, frozen and rest seconds, and whether an admin approved it.

    `approved` is `None` on days without any work, so those never wait for an approval.
    """
    from plane.db.models import User

    zone = _zone(reference_user)
    window = (day_window(start, zone)[0], day_window(end, zone)[1])
    cells = {}

    def cell(user_id, day):
        return cells.setdefault(
            (user_id, day), {"onsite": 0, "remote": 0, "parallel": 0, "frozen": 0, "break": 0, "work": False}
        )

    sessions = (
        WorkSession.objects.filter(
            workspace=workspace, user_id__in=user_ids, finished_at__gte=window[0], finished_at__lt=window[1]
        )
        .annotate(day=TruncDate("finished_at", tzinfo=zone))
        .values("user_id", "day", "location", "is_parallel")
        .annotate(seconds=Sum("duration_seconds"))
    )
    for row in sessions:
        item = cell(row["user_id"], row["day"])
        item["work"] = True
        key = "parallel" if row["is_parallel"] else ("onsite" if row["location"] == "ONSITE" else "remote")
        item[key] += row["seconds"] or 0
    now = timezone.now()
    for item in WorkInterruption.objects.filter(
        workspace=workspace, user_id__in=user_ids, started_at__gte=window[0], started_at__lt=window[1]
    ):
        day = item.started_at.astimezone(zone).date()
        seconds = max(0, int(((item.ended_at or now) - item.started_at).total_seconds()))
        cell(item.user_id, day)["frozen" if item.kind == "FREEZE" else "break"] += seconds
    approved = set(
        WorkApproval.objects.filter(workspace=workspace, user_id__in=user_ids, date__range=(start, end)).values_list(
            "user_id", "date"
        )
    )
    names = {u.id: u.display_name for u in User.objects.filter(pk__in=user_ids)}
    days = _dates(start, end)
    people = []
    team = {day: {"onsite": 0, "remote": 0, "parallel": 0, "frozen": 0, "break": 0} for day in days}
    for user_id in sorted(user_ids, key=lambda i: names.get(i, "").lower()):
        rows = []
        pending = 0
        for day in days:
            item = cells.get((user_id, day))
            has_work = bool(item and item["work"])
            is_approved = ((user_id, day) in approved) if has_work else None
            pending += 1 if has_work and not is_approved else 0
            row = {
                "date": day,
                "onsite_seconds": item["onsite"] if item else 0,
                "remote_seconds": item["remote"] if item else 0,
                "parallel_seconds": item["parallel"] if item else 0,
                "frozen_seconds": item["frozen"] if item else 0,
                "break_seconds": item["break"] if item else 0,
                "approved": is_approved,
            }
            if item:
                for key in ("onsite", "remote", "parallel", "frozen", "break"):
                    team[day][key] += item[key]
            rows.append(row)
        people.append(
            {"user": {"id": user_id, "display_name": names.get(user_id, "")}, "days": rows, "pending_days": pending}
        )
    return {
        "from": start,
        "to": end,
        "people": people,
        "team": [
            {
                "date": day,
                "onsite_seconds": team[day]["onsite"],
                "remote_seconds": team[day]["remote"],
                "parallel_seconds": team[day]["parallel"],
                "frozen_seconds": team[day]["frozen"],
                "break_seconds": team[day]["break"],
            }
            for day in days
        ],
        "pending_days": sum(person["pending_days"] for person in people),
    }


def set_approval(workspace, admin, user_id, start, end, approved=True):
    """Approve (or take back the approval of) every day with work between `start` and `end`, today included."""
    zone = _zone(admin)
    today = today_in_timezone(admin.user_timezone)
    end = min(end, today)
    worked_days = {
        row["day"]
        for row in WorkSession.objects.filter(
            workspace=workspace,
            user_id=user_id,
            finished_at__gte=day_window(start, zone)[0],
            finished_at__lt=day_window(end, zone)[1],
        )
        .annotate(day=TruncDate("finished_at", tzinfo=zone))
        .values("day")
    }
    count = 0
    for day in worked_days:
        existing = WorkApproval.objects.filter(workspace=workspace, user_id=user_id, date=day).first()
        if approved and existing is None:
            WorkApproval.objects.create(
                workspace=workspace, user_id=user_id, date=day, approved_by=admin, approved_at=timezone.now()
            )
            count += 1
        elif not approved and existing is not None:
            existing.delete(soft=False)
            count += 1
    return count


def ranking(workspace, user_ids, start, end, reference_user):
    """Who did the most, by tasks and by hours, with a few badges. Parallel work is shown apart from hours."""
    from plane.db.models import User

    zone = _zone(reference_user)
    rows = (
        WorkSession.objects.filter(
            workspace=workspace,
            user_id__in=user_ids,
            finished_at__gte=day_window(start, zone)[0],
            finished_at__lt=day_window(end, zone)[1],
        )
        .values("user_id")
        .annotate(
            tasks=Count("issue", distinct=True),
            finished=Count("id"),
            seconds=Sum("duration_seconds", filter=Q(is_parallel=False)),
            parallel=Sum("duration_seconds", filter=Q(is_parallel=True)),
            days=Count(TruncDate("finished_at", tzinfo=zone), distinct=True),
        )
    )
    found = {row["user_id"]: row for row in rows}
    names = {u.id: u.display_name for u in User.objects.filter(pk__in=user_ids)}
    people = [
        {
            "user": {"id": uid, "display_name": names.get(uid, "")},
            "tasks": found.get(uid, {}).get("tasks", 0),
            "finished": found.get(uid, {}).get("finished", 0),
            "seconds": found.get(uid, {}).get("seconds") or 0,
            "parallel_seconds": found.get(uid, {}).get("parallel") or 0,
            "active_days": found.get(uid, {}).get("days", 0),
        }
        for uid in user_ids
    ]

    def assign(key, field):
        ordered = sorted(people, key=lambda p: (-p[field], p["user"]["display_name"].lower()))
        rank = 0
        previous = None
        for index, person in enumerate(ordered, start=1):
            if person[field] != previous:
                rank = index
                previous = person[field]
            person[key] = rank if person[field] > 0 else None

    assign("rank_tasks", "tasks")
    assign("rank_hours", "seconds")
    for person in people:
        person["badges"] = []
        if person["rank_tasks"] == 1:
            person["badges"].append("Most tasks")
        if person["rank_hours"] == 1:
            person["badges"].append("Most hours")
        if person["parallel_seconds"] >= 2 * 3600 and person["parallel_seconds"] * 4 >= person["seconds"]:
            person["badges"].append("Hyperactive")
    top_days = max((p["active_days"] for p in people), default=0)
    for person in people:
        if top_days > 0 and person["active_days"] == top_days:
            person["badges"].append("Most consistent")
    people.sort(key=lambda p: (p["rank_tasks"] is None, p["rank_tasks"] or 0, p["user"]["display_name"].lower()))
    return people


def sum_time(workspace, user_ids, start, end, reference_user, parallel_double=False):
    """What each person worked between two dates, as one number to pay or report on.

    total = main hours + parallel hours (twice when `parallel_double`) + the frozen time an admin credited.
    """
    from plane.db.models import User

    zone = _zone(reference_user)
    window = (day_window(start, zone)[0], day_window(end, zone)[1])
    sessions = {
        row["user_id"]: row
        for row in WorkSession.objects.filter(
            workspace=workspace, user_id__in=user_ids, finished_at__gte=window[0], finished_at__lt=window[1]
        )
        .values("user_id")
        .annotate(
            main=Sum("duration_seconds", filter=Q(is_parallel=False)),
            onsite=Sum("duration_seconds", filter=Q(is_parallel=False, location="ONSITE")),
            remote=Sum("duration_seconds", filter=Q(is_parallel=False, location="REMOTE")),
            parallel=Sum("duration_seconds", filter=Q(is_parallel=True)),
            tasks=Count("issue", distinct=True),
        )
    }
    now = timezone.now()
    frozen = {}
    for item in WorkInterruption.objects.filter(
        workspace=workspace, user_id__in=user_ids, kind="FREEZE", started_at__gte=window[0], started_at__lt=window[1]
    ):
        seconds = max(0, int(((item.ended_at or now) - item.started_at).total_seconds()))
        frozen[item.user_id] = frozen.get(item.user_id, 0) + seconds
    credited = {
        row["user_id"]: row["total"]
        for row in FreezeCredit.objects.filter(workspace=workspace, user_id__in=user_ids, date__range=(start, end))
        .values("user_id")
        .annotate(total=Sum("seconds"))
    }
    names = {u.id: u.display_name for u in User.objects.filter(pk__in=user_ids)}
    multiplier = 2 if parallel_double else 1
    rows = []
    for user_id in sorted(user_ids, key=lambda i: names.get(i, "").lower()):
        done = sessions.get(user_id, {})
        main = done.get("main") or 0
        parallel = done.get("parallel") or 0
        credit = min(credited.get(user_id, 0), frozen.get(user_id, 0)) if frozen.get(user_id) else 0
        rows.append(
            {
                "user": {"id": user_id, "display_name": names.get(user_id, "")},
                "main_seconds": main,
                "onsite_seconds": done.get("onsite") or 0,
                "remote_seconds": done.get("remote") or 0,
                "parallel_seconds": parallel,
                "tasks": done.get("tasks", 0),
                "frozen_seconds": frozen.get(user_id, 0),
                "credited_frozen_seconds": credit,
                "total_seconds": main + parallel * multiplier + credit,
            }
        )
    return {
        "from": start,
        "to": end,
        "parallel_double": parallel_double,
        "results": rows,
        "total_seconds": sum(row["total_seconds"] for row in rows),
    }


def credit_freezes(workspace, admin, user_id, start, end, credited=True):
    """Count (or stop counting) the frozen time of a person, day by day, between two dates."""
    zone = _zone(admin)
    now = timezone.now()
    per_day = {}
    for item in WorkInterruption.objects.filter(
        workspace=workspace,
        user_id=user_id,
        kind="FREEZE",
        started_at__gte=day_window(start, zone)[0],
        started_at__lt=day_window(end, zone)[1],
    ):
        day = item.started_at.astimezone(zone).date()
        per_day[day] = per_day.get(day, 0) + max(0, int(((item.ended_at or now) - item.started_at).total_seconds()))
    changed = 0
    for day, seconds in per_day.items():
        existing = FreezeCredit.objects.filter(workspace=workspace, user_id=user_id, date=day).first()
        if credited:
            if existing is None:
                FreezeCredit.objects.create(
                    workspace=workspace, user_id=user_id, date=day, seconds=seconds, approved_by=admin, approved_at=now
                )
                changed += 1
            elif existing.seconds != seconds:
                existing.seconds = seconds
                existing.save(update_fields=["seconds", "updated_at"])
        elif existing is not None:
            existing.delete(soft=False)
            changed += 1
    return changed


# What a manager may read about someone else's notifications: titles and states, never private messages or secrets.
VISIBLE_KINDS = ("FREEZE", "ATTENTION", "NEWS", "MENTION", "FLOW")


def notifications_of(workspace, user_id):
    rows = OpsNotification.objects.filter(workspace=workspace, user_id=user_id, kind__in=VISIBLE_KINDS).select_related(
        "actor"
    )[:50]
    return [
        {
            "id": row.id,
            "kind": row.kind,
            "title": row.title,
            "actor": row.actor.display_name if row.actor else None,
            "created_at": row.created_at,
            "read": row.read_at is not None,
        }
        for row in rows
    ]
