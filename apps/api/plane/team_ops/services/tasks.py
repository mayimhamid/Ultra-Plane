# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Tasks: every work item in one list, in one shape, with its forks and the flows it belongs to.

A *fork* is a branch of a task: a sub work item under it, or a person who works on it with their own time and
stage in the project's flow.
"""

# Django imports
from django.db.models import Count, Q, Sum

# Module imports
from plane.db.models import Issue, IssueAssignee, ModuleIssue, Project, ProjectMember
from plane.team_ops.models import Flow, FlowStageModule, WorkSession

LIMIT = 150
OPEN_GROUPS = ("backlog", "unstarted", "started")


def visible_projects(workspace, user, is_admin):
    """Projects whose work items the person may read: their own, or all for admins."""
    queryset = Project.objects.filter(workspace=workspace)
    if is_admin:
        return queryset
    mine = ProjectMember.objects.filter(member=user, is_active=True).values("project_id")
    return queryset.filter(pk__in=mine)


def _person(user):
    return {"id": user.id, "display_name": user.display_name, "avatar_url": user.avatar_url}


def _flow_index(project_ids):
    """`{project_id: [(flow, {module_id: stage name})]}`."""
    index = {}
    flows = Flow.objects.filter(project_id__in=project_ids).prefetch_related("stages__modules")
    for flow in flows:
        where = {row.module_id: stage.name for stage in flow.stages.all() for row in stage.modules.all()}
        index.setdefault(flow.project_id, []).append((flow, where))
    return index


def task_list(workspace, user, is_admin, params):
    """Work items in one shape. Filters: `issue`, `project`, `flow`, `assignee`, `status`, `q`, `mine`."""
    projects = visible_projects(workspace, user, is_admin)
    queryset = Issue.issue_objects.filter(project__in=projects, parent__isnull=True)
    if params.get("issue"):
        # One work item, even a sub work item (so the panel on any work item page works).
        queryset = Issue.issue_objects.filter(project__in=projects, pk=params["issue"])
    if params.get("project"):
        queryset = queryset.filter(project_id=params["project"])
    if params.get("flow"):
        in_flow = FlowStageModule.objects.filter(stage__flow_id=params["flow"]).values("module_id")
        queryset = queryset.filter(issue_module__module_id__in=in_flow, issue_module__deleted_at__isnull=True)
    if params.get("module"):
        queryset = queryset.filter(issue_module__module_id=params["module"], issue_module__deleted_at__isnull=True)
    assignee = user.id if params.get("mine") in ("1", "true") else params.get("assignee")
    if assignee:
        queryset = queryset.filter(issue_assignee__assignee_id=assignee)
    if params.get("status") == "open":
        queryset = queryset.filter(state__group__in=OPEN_GROUPS)
    elif params.get("status") == "done":
        queryset = queryset.filter(state__group__in=("completed", "cancelled"))
    if params.get("q"):
        queryset = queryset.filter(Q(name__icontains=params["q"][:100]))
    queryset = queryset.distinct().select_related("project", "state").order_by("-updated_at")
    total = queryset.count()
    issues = list(queryset[:LIMIT])
    ids = [issue.id for issue in issues]
    children = list(
        Issue.issue_objects.filter(parent_id__in=ids).select_related("project", "state").order_by("sequence_id")
    )
    everyone = ids + [child.id for child in children]

    assignees = {}
    for row in IssueAssignee.objects.filter(issue_id__in=everyone).select_related("assignee"):
        assignees.setdefault(row.issue_id, []).append(row.assignee)

    spent = {}
    for row in (
        WorkSession.objects.filter(workspace=workspace, issue_id__in=everyone)
        .values("issue_id", "user_id")
        .annotate(seconds=Sum("duration_seconds", filter=Q(is_parallel=False)), sessions=Count("id"))
    ):
        spent[(row["issue_id"], row["user_id"])] = (row["seconds"] or 0, row["sessions"])

    flows = _flow_index({issue.project_id for issue in issues} | {child.project_id for child in children})
    modules_of = {}
    for issue_id, module_id in ModuleIssue.objects.filter(issue_id__in=everyone).values_list("issue_id", "module_id"):
        modules_of.setdefault(issue_id, set()).add(module_id)

    def stages_of(issue):
        names = []
        for _flow, where in flows.get(issue.project_id, []):
            names += [where[m] for m in modules_of.get(issue.id, ()) if m in where]
        return sorted(set(names))

    def key_of(issue):
        return f"{issue.project.identifier}-{issue.sequence_id}"

    def flow_chips(issue):
        chips = []
        for flow, where in flows.get(issue.project_id, []):
            stages = {where[m] for m in modules_of.get(issue.id, ()) if m in where}
            chips.append(
                {
                    "id": flow.id,
                    "name": flow.name,
                    "stages": sorted(stages),
                    # created after the flow was drawn
                    "side": issue.created_at > flow.created_at,
                }
            )
        return chips

    def lite(issue):
        return {
            "id": issue.id,
            "key": key_of(issue),
            "name": issue.name,
            "project": {"id": issue.project_id, "name": issue.project.name, "identifier": issue.project.identifier},
            "state": {"name": issue.state.name, "group": issue.state.group} if issue.state_id else None,
            "assignees": [_person(person) for person in assignees.get(issue.id, [])],
            "flows": flow_chips(issue),
        }

    by_parent = {}
    for child in children:
        by_parent.setdefault(child.parent_id, []).append(child)

    rows = []
    for issue in issues:
        row = lite(issue)
        seconds = 0
        sessions = 0
        branches = []
        for person in assignees.get(issue.id, []):
            person_seconds, person_sessions = spent.get((issue.id, person.id), (0, 0))
            seconds += person_seconds
            sessions += person_sessions
            stage = ", ".join(stages_of(issue)) or None
            branches.append(
                {
                    "kind": "person",
                    "user": _person(person),
                    "seconds": person_seconds,
                    "sessions": person_sessions,
                    "stage": stage,
                    "done": bool(issue.state_id and issue.state.group == "completed"),
                }
            )
        # People who logged time on the task without being assigned are branches too.
        known = {person.id for person in assignees.get(issue.id, [])}
        for (issue_id, user_id), (person_seconds, person_sessions) in spent.items():
            if issue_id == issue.id and user_id not in known:
                from plane.db.models import User

                other = User.objects.filter(pk=user_id).first()
                if other is not None:
                    seconds += person_seconds
                    sessions += person_sessions
                    branches.append(
                        {
                            "kind": "person",
                            "user": _person(other),
                            "seconds": person_seconds,
                            "sessions": person_sessions,
                            "stage": None,
                            "done": False,
                        }
                    )
        forks = [{"kind": "sub", **lite(child)} for child in by_parent.get(issue.id, [])] + branches
        row.update({"seconds": seconds, "sessions": sessions, "forks": forks})
        rows.append(row)
    return {"results": rows, "total": total, "has_more": total > len(rows)}


def task_filters(workspace, user, is_admin):
    """What the filters can offer: projects, flows and people the person can see."""
    projects = list(visible_projects(workspace, user, is_admin).order_by("name"))
    flows = Flow.objects.filter(workspace=workspace, project__in=projects).select_related("project").order_by("name")
    return {
        "projects": [{"id": p.id, "name": p.name, "identifier": p.identifier} for p in projects],
        "flows": [{"id": f.id, "name": f.name, "project": f.project.name} for f in flows],
    }
