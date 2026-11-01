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


def append(p, text):
    p = os.path.join(root, p)
    s = open(p, newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    open(p, "w", newline="").write(s.rstrip() + nl + text.replace("\n", nl))


append(
    "views/workday.py",
    '''

class TasksEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """All work items of the person's projects (admins: all projects) in one shape, with their forks.

        Filters: `project`, `flow`, `assignee`, `status` (open or done), `q`, `mine=1`.
        """
        workspace = Workspace.objects.get(slug=slug)
        access = CalendarAccess(request.user, workspace)
        if not access.is_calendar_user:
            return _forbidden()
        params = {key: value for key, value in request.query_params.items()}
        for key in ("project", "flow", "assignee"):
            if params.get(key):
                params[key] = parse_uuid(params[key], key)
        if params.get("status") not in (None, "", "open", "done"):
            raise ParseError(detail="Unknown status.")
        data = tasks.task_list(workspace, request.user, access.is_admin, params)
        data["filters"] = tasks.task_filters(workspace, request.user, access.is_admin)
        return Response(data)
''',
)
edit(
    "views/workday.py",
    [("from plane.team_ops.services import hub_files, teamflow, work_sessions, workday", "from plane.team_ops.services import hub_files, tasks, teamflow, work_sessions, workday")],
)
edit(
    "views/__init__.py",
    [
        ("from .workday import TeamflowEndpoint,", "from .workday import TasksEndpoint, TeamflowEndpoint,"),
        ('    "TeamflowEndpoint",', '    "TasksEndpoint",\n    "TeamflowEndpoint",'),
    ],
)
edit(
    "urls.py",
    [
        ("    TeamflowEndpoint,\n", "    TasksEndpoint,\n    TeamflowEndpoint,\n"),
        (
            '    path("workspaces/<str:slug>/team-ops/work-tasks/"',
            '    path("workspaces/<str:slug>/team-ops/tasks/", TasksEndpoint.as_view(), name="team-ops-tasks"),\n    path("workspaces/<str:slug>/team-ops/work-tasks/"',
        ),
    ],
)
print("ok")
