import os

root = r"E:\Code archives\palne\plane\apps\api\plane\team_ops"


def edit(p, pairs):
    p = os.path.join(root, p)
    s = open(p, newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    for a, b in pairs:
        a = a.replace("\n", nl)
        b = b.replace("\n", nl)
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w", newline="").write(s)


edit(
    "services/timer.py",
    [
        (
            "    if timer.state != RUNNING:\n        return timer\n    due = check_in_due_at(timer)",
            "    if timer.state != RUNNING or timer.is_parallel:\n        return timer\n    due = check_in_due_at(timer)",
        ),
        (
            '''        .filter(workspace=workspace, user=user)
        .select_related("workspace", "user", "issue", "issue__project")
        .first()
    )


def get_timer''',
            '''        .filter(workspace=workspace, user=user, is_parallel=False)
        .select_related("workspace", "user", "issue", "issue__project")
        .first()
    )


def _lock_parallel(workspace, user, timer_id):
    return (
        ActiveTimer.objects.select_for_update(of=("self",))
        .filter(workspace=workspace, user=user, is_parallel=True, pk=timer_id)
        .select_related("workspace", "user", "issue", "issue__project")
        .first()
    )


def get_timer''',
        ),
        (
            "    frozen_seconds: int\n",
            "    frozen_seconds: int\n    is_parallel: bool = False\n",
        ),
        (
            "def stop_timer(workspace, user):",
            "def stop_timer(workspace, user, timer_id=None):",
        ),
        (
            "        timer = _lock(workspace, user)\n        if timer is None:\n            return None\n        timer = refresh(timer)\n        now = timezone.now()\n        _close_pause(timer, now)",
            "        timer = _lock_parallel(workspace, user, timer_id) if timer_id else _lock(workspace, user)\n        if timer is None:\n            return None\n        timer = refresh(timer)\n        now = timezone.now()\n        _close_pause(timer, now)",
        ),
        (
            "        result = StopResult(entry, capped, timer.location, timer.break_seconds, timer.frozen_seconds)",
            "        result = StopResult(\n            entry, capped, timer.location, timer.break_seconds, timer.frozen_seconds, timer.is_parallel\n        )",
        ),
    ],
)

edit(
    "services/workday.py",
    [
        (
            '''def set_day_mode(workspace, user, mode):
    if mode not in WorkDay.Mode.values:
        raise ParseError(detail="Choose remote, onsite or hybrid.")
''',
            '''def set_day_mode(workspace, user, mode):
    """Today's first answer. It cannot be changed here afterwards; see `override_day`."""
    if mode not in LOCATIONS:
        raise ParseError(detail="Choose remote or onsite.")
    existing = get_day(workspace, user)
    if existing is not None:
        if existing.mode == mode:
            return existing
        raise ParseError(detail="Today's answer is fixed. To change it, use the confirmation at the bottom of the page.")
''',
        ),
        (
            "            if ActiveTimer.objects.filter(workspace=workspace, user=user).exists():\n                raise TimerAlreadyRunning\n",
            "            if ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=False).exists():\n                raise TimerAlreadyRunning\n",
        ),
        (
            '''def timer_payload(timer, now=None):''',
            '''MAX_PARALLEL = 3


def start_parallel(workspace, user, issue, location=None):
    """A second task worked at the same time as the main one. It needs a main task, and has no pauses or check-ins."""
    main = ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=False).first()
    if main is None:
        raise ParseError(detail="Start a main task first.")
    if ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=True).count() >= MAX_PARALLEL:
        raise ParseError(detail=f"At most {MAX_PARALLEL} parallel tasks.")
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
    sessions = list(WorkSession.objects.filter(workspace=workspace, user=user, finished_at__gte=start, finished_at__lt=end))
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


def timer_payload(timer, now=None):''',
        ),
        (
            '''        "id": timer.id,
        "state": timer.state,''',
            '''        "id": timer.id,
        "is_parallel": timer.is_parallel,
        "state": timer.state,''',
        ),
        (
            '''    rows = (
        WorkSession.objects.filter(workspace=workspace, user=user, finished_at__gte=start, finished_at__lt=end)
        .values("location")
        .annotate(seconds=Sum("duration_seconds"))
    )
    seconds = {row["location"]: row["seconds"] or 0 for row in rows}
    if running is not None and running.location:
        seconds[running.location] = seconds.get(running.location, 0) + worked_seconds(running)''',
            '''    rows = (
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
    parallel += sum(worked_seconds(t) for t in now_parallel)''',
        ),
        (
            '''        "remote_seconds": seconds.get("REMOTE", 0),
        "break_seconds"''',
            '''        "remote_seconds": seconds.get("REMOTE", 0),
        "parallel_seconds": parallel,
        "break_seconds"''',
        ),
        (
            '''        "timer": timer_payload(timer),
        "totals": day_totals(workspace, user, timer),''',
            '''        "timer": timer_payload(timer),
        "parallel": [
            timer_payload(t)
            for t in ActiveTimer.objects.filter(workspace=workspace, user=user, is_parallel=True).select_related(
                "issue", "issue__project"
            )
        ],
        "totals": day_totals(workspace, user, timer),''',
        ),
        (
            "        for t in ActiveTimer.objects.filter(workspace=workspace, user_id__in=user_ids).select_related(",
            "        for t in ActiveTimer.objects.filter(workspace=workspace, user_id__in=user_ids, is_parallel=False).select_related(",
        ),
        (
            "ActiveTimer.objects.filter(state=RUNNING).values_list",
            "ActiveTimer.objects.filter(state=RUNNING, is_parallel=False).values_list",
        ),
    ],
)

edit(
    "services/work_sessions.py",
    [
        (
            "def finish_work(*, workspace, user, summary, document_text, no_document, attention, attachments_expected=False):",
            "def finish_work(\n    *, workspace, user, summary, document_text, no_document, attention, attachments_expected=False, timer_id=None\n):",
        ),
        ("stopped = stop_timer(workspace, user)", "stopped = stop_timer(workspace, user, timer_id)"),
        (
            "            location=stopped.location,\n",
            "            location=stopped.location,\n            is_parallel=stopped.is_parallel,\n",
        ),
    ],
)
edit(
    "views/workday.py",
    [
        (
            '        "location": session.location,\n',
            '        "location": session.location,\n        "is_parallel": session.is_parallel,\n',
        ),
        (
            "                attachments_expected=bool(files),\n",
            "                attachments_expected=bool(files),\n                timer_id=parse_uuid(data.get(\"timer\"), \"timer\") if data.get(\"timer\") else None,\n",
        ),
    ],
)
edit(
    "views/workday_day.py",
    [
        (
            "class WorkdayBreakEndpoint(BaseAPIView):",
            '''class WorkdayParallelEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Start a second task alongside the main one."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        issue = resolve_issue(workspace, request.user, request.data.get("issue"))
        workday.start_parallel(workspace, request.user, issue, request.data.get("location"))
        return Response(workday.day_state(workspace, request.user), status=status.HTTP_201_CREATED)


class WorkdayDayOverrideEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Change today's answer: `mode`, and the place of every task finished today as `sessions: {id: place}`."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        workday.override_day(workspace, request.user, request.data.get("mode"), request.data.get("sessions", {}))
        return Response(workday.day_state(workspace, request.user))


class WorkdayBreakEndpoint(BaseAPIView):''',
        )
    ],
)
names = ["WorkdayDayOverrideEndpoint", "WorkdayParallelEndpoint"]
edit(
    "views/__init__.py",
    [
        ("    WorkdayCheckInEndpoint,\n    WorkdayDayEndpoint,\n", "    WorkdayCheckInEndpoint,\n    WorkdayDayEndpoint,\n    WorkdayDayOverrideEndpoint,\n    WorkdayParallelEndpoint,\n"),
        ('    "WorkdayCheckInEndpoint",', '    "WorkdayCheckInEndpoint",\n    "WorkdayDayOverrideEndpoint",\n    "WorkdayParallelEndpoint",'),
    ],
)
edit(
    "urls.py",
    [
        ("    WorkdayCheckInEndpoint,\n    WorkdayDayEndpoint,\n", "    WorkdayCheckInEndpoint,\n    WorkdayDayEndpoint,\n    WorkdayDayOverrideEndpoint,\n    WorkdayParallelEndpoint,\n"),
        (
            '    path("workspaces/<str:slug>/team-ops/workday/start/"',
            '    path("workspaces/<str:slug>/team-ops/workday/day/override/", WorkdayDayOverrideEndpoint.as_view(), name="team-ops-workday-override"),\n    path("workspaces/<str:slug>/team-ops/workday/parallel/", WorkdayParallelEndpoint.as_view(), name="team-ops-workday-parallel"),\n    path("workspaces/<str:slug>/team-ops/workday/start/"',
        ),
    ],
)
print("ok")
