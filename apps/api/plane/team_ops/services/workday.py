# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A person's working day: how they work today, the running task, and what the day looks like so far."""

# Python imports
from datetime import datetime, time as time_of_day, timedelta
from zoneinfo import ZoneInfo

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

# Third party imports
from rest_framework.exceptions import ParseError

# Module imports
from plane.team_ops.models import (
    ActiveTimer,
    CalendarEntry,
    CalendarHoliday,
    WeekPlanConfirmation,
    WorkDay,
    WorkInterruption,
    WorkSession,
)
from plane.team_ops.services.policy import get_policy
from plane.team_ops.services.timer import (
    CHECK_IN_SECONDS,
    GRACE_SECONDS,
    MEETING,
    RUNNING,
    check_in_due_at,
    get_timer,
    worked_seconds,
)
from plane.team_ops.services.weekly_plan import today_in_timezone

LOCATIONS = ("REMOTE", "ONSITE")


class TimerAlreadyRunning(Exception):
    pass


def _zone(user_or_name):
    name = getattr(user_or_name, "user_timezone", user_or_name)
    try:
        return ZoneInfo(name or "UTC")
    except Exception:  # an unknown zone name must not break the page
        return ZoneInfo("UTC")


def day_window(day, zone):
    return (
        datetime.combine(day, time_of_day.min, zone),
        datetime.combine(day + timedelta(days=1), time_of_day.min, zone),
    )


def get_day(workspace, user):
    return WorkDay.objects.filter(workspace=workspace, user=user, date=today_in_timezone(user.user_timezone)).first()


def set_day_mode(workspace, user, mode):
    """Today's first answer. It cannot be changed here afterwards; see `override_day`."""
    if mode not in LOCATIONS:
        raise ParseError(detail="Choose remote or onsite.")
    existing = get_day(workspace, user)
    if existing is not None:
        if existing.mode == mode:
            return existing
        raise ParseError(
            detail="Today's answer is fixed. To change it, use the confirmation at the bottom of the page."
        )
    day, _ = WorkDay.objects.update_or_create(
        workspace=workspace, user=user, date=today_in_timezone(user.user_timezone), defaults={"mode": mode}
    )
    return day


def week_start_of(day):
    """The Saturday that starts the week `day` is in."""
    return day - timedelta(days=(day.weekday() - 5) % 7)


def week_plan(workspace, user):
    """Saturday to Friday: which days are planned (any entry, including leave and days off).

    Only working days that are not holidays and not yet past need a plan; `complete` says they all have one.
    """
    today = today_in_timezone(user.user_timezone)
    start = week_start_of(today)
    end = start + timedelta(days=6)
    working = get_policy(workspace).working_weekdays
    modes = {
        entry.work_date: entry.work_mode
        for entry in CalendarEntry.objects.filter(workspace=workspace, user=user, work_date__range=(start, end))
    }
    holidays = set(
        CalendarHoliday.objects.filter(workspace=workspace, date__range=(start, end)).values_list("date", flat=True)
    )
    days = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        days.append(
            {
                "date": day,
                "mode": modes.get(day),
                "expected": day.isoweekday() in working and day not in holidays,
                "past": day < today,
            }
        )
    missing = [item["date"] for item in days if item["expected"] and item["mode"] is None and not item["past"]]
    confirmed = WeekPlanConfirmation.objects.filter(workspace=workspace, user=user, week_start=start).exists()
    return {
        "start": start,
        "end": end,
        "days": days,
        "confirmed": confirmed,
        "complete": not missing and confirmed,
        "missing": missing,
    }


def confirm_week(workspace, user):
    """Lock this week's plan. Every working day still ahead must have a plan first."""
    plan = week_plan(workspace, user)
    if plan["missing"]:
        raise ParseError(detail="Plan every working day of the week first.")
    WeekPlanConfirmation.objects.get_or_create(
        workspace=workspace, user=user, week_start=plan["start"], defaults={"confirmed_at": timezone.now()}
    )
    return week_plan(workspace, user)


def unlock_week(workspace, user):
    """Reopen a confirmed plan so it can be changed. The managers are told: they had already seen it."""
    from plane.team_ops.services.notifications import managers_of, notify

    plan = week_plan(workspace, user)
    rows = WeekPlanConfirmation.objects.filter(workspace=workspace, user=user, week_start=plan["start"])
    if not rows.exists():
        return plan
    for row in rows:
        row.delete(soft=False)
    notify(
        workspace,
        managers_of(workspace, user),
        "ATTENTION",
        f"{user.display_name} reopened their week plan",
        "The plan for this week is being changed.",
        link="team-ops/calendar/team",
        actor=user,
    )
    return week_plan(workspace, user)


def start_work(workspace, user, issue, location):
    """Start the timer on a work item.

    Today's answer is the default place. Starting a task in the other place makes the day a hybrid day: the
    system works that out, the person is never asked to say "hybrid". The week must be planned first.
    """
    day = get_day(workspace, user)
    if day is None:
        raise ParseError(detail="Say how you are working today first.")
    plan = week_plan(workspace, user)
    if not plan["complete"]:
        raise ParseError(detail="Plan your week first: say which days you work and where.")
    if location and location not in LOCATIONS:
        raise ParseError(detail="Say whether you work on this task remotely or onsite.")
    if not location:
        if day.mode not in LOCATIONS:
            raise ParseError(detail="Say whether you work on this task remotely or onsite.")
        location = day.mode
    if day.mode != WorkDay.Mode.HYBRID and location != day.mode:
        day.mode = WorkDay.Mode.HYBRID
        day.save()
    now = timezone.now()
    try:
        with transaction.atomic():
            if ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=False).exists():
                raise TimerAlreadyRunning
            return ActiveTimer.objects.create(
                workspace=workspace,
                user=user,
                issue=issue,
                started_at=now,
                last_confirmed_at=now,
                location=location,
            )
    except IntegrityError:
        raise TimerAlreadyRunning


def start_meeting(workspace, user):
    """Start a meeting: a timer with no work item, no check-ins and nothing to report.

    The place is today's answer (none on a hybrid day). Any task must be finished, cancelled or paused first.
    """
    day = get_day(workspace, user)
    if day is None:
        raise ParseError(detail="Say how you are working today first.")
    now = timezone.now()
    try:
        with transaction.atomic():
            if ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=False).exists():
                raise TimerAlreadyRunning
            return ActiveTimer.objects.create(
                workspace=workspace,
                user=user,
                issue=None,
                started_at=now,
                last_confirmed_at=now,
                location=day.mode if day.mode in LOCATIONS else "",
                activity=MEETING,
                note="Meeting",
            )
    except IntegrityError:
        raise TimerAlreadyRunning


def end_meeting(workspace, user):
    """End the running meeting and log its time (no work report)."""
    from plane.team_ops.services.timer import stop_timer

    timer = ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=False).first()
    if timer is None or timer.activity != MEETING:
        raise ParseError(detail="No meeting is running.")
    return stop_timer(workspace, user)


def start_parallel(workspace, user, issue, location=None):
    """Another task worked at the same time as the main one; there is no limit on how many.

    It needs a main task, and has no pauses or check-ins.
    """
    main = ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=False).first()
    if main is None:
        raise ParseError(detail="Start a main task first.")
    if location and location not in LOCATIONS:
        raise ParseError(detail="Say whether you work on this task remotely or onsite.")
    now = timezone.now()
    return ActiveTimer.objects.create(
        workspace=workspace,
        user=user,
        issue=issue,
        started_at=now,
        last_confirmed_at=now,
        location=location or main.location,
        is_parallel=True,
    )


def override_day(workspace, user, mode, locations):
    """Change today's answer after the fact. Every task finished today must be given its place again."""
    if mode not in LOCATIONS:
        raise ParseError(detail="Choose remote or onsite.")
    day = get_day(workspace, user)
    if day is None:
        raise ParseError(detail="Say how you are working today first.")
    start, end = day_window(today_in_timezone(user.user_timezone), _zone(user))
    sessions = list(
        WorkSession.objects.filter(workspace=workspace, user=user, finished_at__gte=start, finished_at__lt=end)
    )
    if not isinstance(locations, dict) or set(map(str, locations)) != {str(s.id) for s in sessions}:
        raise ParseError(detail="Say where you did every task today.")
    if any(place not in LOCATIONS for place in locations.values()):
        raise ParseError(detail="Say whether each task was remote or onsite.")
    places = set(locations.values())
    running = ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=False).first()
    if running is not None and running.location:
        places.add(running.location)
    with transaction.atomic():
        for session in sessions:
            session.location = locations[str(session.id)]
            session.save(update_fields=["location", "updated_at"])
        day.mode = mode if places <= {mode} else WorkDay.Mode.HYBRID
        day.save()
    return day


def timer_payload(timer, now=None):
    if timer is None:
        return None
    now = now or timezone.now()
    due = check_in_due_at(timer)
    issue = timer.issue
    return {
        "id": timer.id,
        "is_parallel": timer.is_parallel,
        "activity": timer.activity,
        "state": timer.state,
        "location": timer.location,
        "started_at": timer.started_at,
        "worked_seconds": worked_seconds(timer, now),
        "paused_at": timer.paused_at,
        "check_in_due_at": due,
        "check_in_grace_seconds": GRACE_SECONDS,
        "check_in_every_seconds": CHECK_IN_SECONDS,
        "issue": issue.id if issue else None,
        "work_item": f"{issue.project.identifier}-{issue.sequence_id}" if issue else None,
        "work_item_name": issue.name if issue else None,
        "project": issue.project.name if issue else None,
        "server_time": now,
    }


def day_totals(workspace, user, running=None):
    """Worked seconds by place, and time lost to breaks and freezes, for the person's local today."""
    zone = _zone(user)
    start, end = day_window(today_in_timezone(user.user_timezone), zone)
    rows = (
        WorkSession.objects.filter(workspace=workspace, user=user, finished_at__gte=start, finished_at__lt=end)
        .values("location", "is_parallel")
        .annotate(seconds=Sum("duration_seconds"))
    )
    seconds = {}
    parallel = 0
    for row in rows:
        if row["is_parallel"]:
            parallel += row["seconds"] or 0
        else:
            seconds[row["location"]] = seconds.get(row["location"], 0) + (row["seconds"] or 0)
    if running is not None and running.location:
        seconds[running.location] = seconds.get(running.location, 0) + worked_seconds(running)
    now_parallel = ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=True)
    parallel += sum(worked_seconds(t) for t in now_parallel)
    interruptions = list(
        WorkInterruption.objects.filter(workspace=workspace, user=user, started_at__gte=start, started_at__lt=end)
    )
    now = timezone.now()
    from plane.team_ops.models import TimeEntry

    meeting = (
        TimeEntry.objects.filter(
            workspace=workspace,
            user=user,
            started_at__gte=start,
            started_at__lt=end,
            issue__isnull=True,
            note="Meeting",
            source=TimeEntry.Source.TIMER,
        ).aggregate(seconds=Sum("duration_seconds"))["seconds"]
        or 0
    )
    if running is not None and running.activity == MEETING:
        meeting += worked_seconds(running, now)

    def length(item):
        return max(0, int(((item.ended_at or now) - item.started_at).total_seconds()))

    return {
        "onsite_seconds": seconds.get("ONSITE", 0),
        "remote_seconds": seconds.get("REMOTE", 0),
        "parallel_seconds": parallel,
        "meeting_seconds": meeting,
        "break_seconds": sum(length(i) for i in interruptions if i.kind == "BREAK"),
        "frozen_seconds": sum(length(i) for i in interruptions if i.kind == "FREEZE"),
        "interruptions": [
            {"kind": i.kind, "started_at": i.started_at, "ended_at": i.ended_at, "seconds": length(i)}
            for i in interruptions
        ],
    }


def day_state(workspace, user):
    timer = get_timer(workspace, user)
    day = get_day(workspace, user)
    return {
        "day": {"date": day.date, "mode": day.mode} if day else None,
        "timer": timer_payload(timer),
        "parallel": [
            timer_payload(t)
            for t in ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=True).select_related(
                "issue", "issue__project"
            )
        ],
        "totals": day_totals(workspace, user, timer),
        "week": week_plan(workspace, user),
    }


def team_status(workspace, user_ids, reference_user):
    """Who is doing what right now, for the people given."""
    from plane.db.models import User

    now = timezone.now()
    start, end = day_window(today_in_timezone(reference_user.user_timezone), _zone(reference_user))
    users = {u.id: u for u in User.objects.filter(pk__in=user_ids)}
    modes = {
        d.user_id: d.mode
        for d in WorkDay.objects.filter(
            workspace=workspace, user_id__in=user_ids, date=today_in_timezone(reference_user.user_timezone)
        )
    }
    timers = {
        t.user_id: t
        for t in ActiveTimer.objects.filter(
            workspace=workspace, user_id__in=user_ids, is_parallel=False
        ).select_related("issue", "issue__project")
    }
    done = {
        row["user_id"]: row["seconds"] or 0
        for row in WorkSession.objects.filter(
            workspace=workspace, user_id__in=user_ids, finished_at__gte=start, finished_at__lt=end
        )
        .values("user_id")
        .annotate(seconds=Sum("duration_seconds"))
    }
    freezes = {}
    for item in WorkInterruption.objects.filter(
        workspace=workspace, user_id__in=user_ids, kind="FREEZE", started_at__gte=start, started_at__lt=end
    ):
        freezes[item.user_id] = freezes.get(item.user_id, 0) + int(
            ((item.ended_at or now) - item.started_at).total_seconds()
        )

    rows = []
    for user_id, person in users.items():
        timer = timers.get(user_id)
        if timer is not None:
            # A freeze is only noticed when someone looks, so look.
            from plane.team_ops.services.timer import refresh

            with transaction.atomic():
                timer = refresh(
                    ActiveTimer.objects.select_for_update(of=("self",))
                    .select_related("workspace", "user", "issue", "issue__project")
                    .get(pk=timer.pk)
                )
        rows.append(
            {
                "user": {"id": person.id, "display_name": person.display_name, "avatar_url": person.avatar_url},
                "mode": modes.get(user_id),
                "state": timer.state if timer else ("DONE" if done.get(user_id) else "IDLE"),
                "work_item": f"{timer.issue.project.identifier}-{timer.issue.sequence_id}"
                if timer and timer.issue_id
                else None,
                "work_item_name": timer.issue.name if timer and timer.issue_id else None,
                "location": timer.location if timer else "",
                "activity": timer.activity if timer else "",
                "worked_today_seconds": done.get(user_id, 0) + (worked_seconds(timer, now) if timer else 0),
                "frozen_today_seconds": freezes.get(user_id, 0),
            }
        )
    rows.sort(key=lambda row: row["user"]["display_name"].lower())
    return rows


def remind_due_check_ins(now=None):
    """Ask "still working?" on the phone as soon as a check-in falls due, once per check-in."""
    from plane.team_ops.models import OpsNotification
    from plane.team_ops.services.notifications import notify

    now = now or timezone.now()
    reminded = 0
    timers = ActiveTimer.objects.filter(state=RUNNING, is_parallel=False).exclude(activity=MEETING)
    for timer in timers.select_related("workspace", "user", "issue", "issue__project"):
        due = check_in_due_at(timer)
        if due is None or now < due:
            continue
        if OpsNotification.objects.filter(user=timer.user, kind="CHECKIN", created_at__gte=due).exists():
            continue
        minutes = max(1, GRACE_SECONDS // 60)
        task = f"{timer.issue.project.identifier}-{timer.issue.sequence_id}" if timer.issue_id else "your task"
        notify(
            timer.workspace,
            [timer.user_id],
            "CHECKIN",
            "Are you still working?",
            f"Answer within {minutes} min or the timer on {task} freezes.",
            link="team-ops/workday",
        )
        reminded += 1
    return reminded


def freeze_unanswered_timers():
    """Look at every running timer, so a freeze is recorded and reported even when nobody has the page open."""
    from plane.team_ops.services.timer import refresh

    frozen = 0
    for pk in list(ActiveTimer.objects.filter(state=RUNNING, is_parallel=False).values_list("pk", flat=True)):
        with transaction.atomic():
            timer = (
                ActiveTimer.objects.select_for_update(of=("self",))
                .select_related("workspace", "user", "issue", "issue__project")
                .filter(pk=pk)
                .first()
            )
            if timer is not None and refresh(timer).state != RUNNING:
                frozen += 1
    return frozen


def heatmap(workspace, user, days=365):
    """Per day (person's timezone) for the last `days` days: work done, tasks it was on, seconds worked.

    Counts finished work, time logged by hand on the Time page (entries that are not part of finished work),
    and today's running timers, so today's square fills while the person works.
    """
    from plane.team_ops.models import TimeEntry

    zone = _zone(user)
    today = today_in_timezone(user.user_timezone)
    first = today - timedelta(days=days - 1)
    start = day_window(first, zone)[0]
    end = day_window(today, zone)[1]
    totals = {}

    def add(day, sessions, issues, seconds):
        entry = totals.setdefault(day, {"sessions": 0, "issues": set(), "seconds": 0})
        entry["sessions"] += sessions
        entry["issues"].update(issue for issue in issues if issue)
        entry["seconds"] += seconds or 0

    finished = WorkSession.objects.filter(
        workspace=workspace, user=user, finished_at__gte=start, finished_at__lt=end
    ).values_list("finished_at", "issue_id", "duration_seconds")
    for finished_at, issue_id, seconds in finished:
        add(finished_at.astimezone(zone).date(), 1, [issue_id or f"none-{finished_at}"], seconds)

    logged = TimeEntry.objects.filter(
        workspace=workspace, user=user, started_at__gte=start, started_at__lt=end, work_session__isnull=True
    ).values_list("started_at", "issue_id", "duration_seconds")
    for started_at, issue_id, seconds in logged:
        add(started_at.astimezone(zone).date(), 1, [issue_id], seconds)

    now = timezone.now()
    for timer in ActiveTimer.objects.filter(workspace=workspace, user=user):
        seconds = worked_seconds(timer, now)
        if seconds > 0:
            add(today, 0, [timer.issue_id], seconds)

    return {
        "from": first,
        "to": today,
        "days": [
            {
                "date": day,
                "sessions": entry["sessions"],
                "tasks": len(entry["issues"]),
                "seconds": entry["seconds"],
            }
            for day, entry in sorted(totals.items())
        ],
    }
