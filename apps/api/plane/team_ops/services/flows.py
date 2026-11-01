# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Flows: a project split into phases. Each phase (stage) holds modules, and its progress is theirs."""

# Django imports
from django.db import transaction
from django.db.models import Count, Q

# Third party imports
from rest_framework.exceptions import ParseError

# Module imports
from plane.db.models import Issue, IssueAssignee, Module, ModuleMember, Project, ProjectMember
from plane.team_ops.models import Flow, FlowStage, FlowStageModule
from plane.team_ops.services.notifications import notify

MAX_STAGES = 12
MAX_MODULES_PER_STAGE = 30


class _Person:
    """What the chart needs of someone who is only known from an assignment."""

    def __init__(self, user_id, name, avatar):
        self.id = user_id
        self.display_name = name
        self.avatar_url = avatar or None


def project_modules(project):
    return Module.objects.filter(project=project)


def validate_stages(project, stages):
    """What the person sent: 1 to 12 named stages, each with modules of this project, none used twice."""
    if not isinstance(stages, list) or not 1 <= len(stages) <= MAX_STAGES:
        raise ParseError(detail=f"A flow has 1 to {MAX_STAGES} stages.")
    allowed = set(project_modules(project).values_list("id", flat=True))
    seen = set()
    cleaned = []
    for stage in stages:
        name = str((stage or {}).get("name", "")).strip()
        modules = list((stage or {}).get("modules", []))
        if not name or len(name) > 200:
            raise ParseError(detail="Name every stage.")
        if not modules or len(modules) > MAX_MODULES_PER_STAGE:
            raise ParseError(detail="Every stage needs at least one module.")
        ids = []
        for raw in modules:
            module = project_modules(project).filter(pk=raw).first() if raw else None
            if module is None or module.id not in allowed:
                raise ParseError(detail="Stages can only hold modules of this project.")
            if module.id in seen:
                raise ParseError(detail="A module can be in one stage only.")
            seen.add(module.id)
            ids.append(module.id)
        cleaned.append((name, ids))
    return cleaned


def module_people(module_ids):
    """`{module_id: [people]}`: the module's lead, its members and the people assigned to its work items."""
    people = {module_id: {} for module_id in module_ids}
    for module in Module.objects.filter(pk__in=module_ids).select_related("lead"):
        if module.lead_id:
            people[module.id][module.lead_id] = module.lead
    for row in ModuleMember.objects.filter(module_id__in=module_ids).select_related("member"):
        people[row.module_id][row.member_id] = row.member
    assigned = IssueAssignee.objects.filter(
        issue__issue_module__module_id__in=module_ids, issue__issue_module__deleted_at__isnull=True
    ).values_list("issue__issue_module__module_id", "assignee_id", "assignee__display_name", "assignee__avatar")
    for module_id, user_id, name, avatar in assigned:
        if module_id in people and user_id not in people[module_id]:
            people[module_id][user_id] = _Person(user_id, name, avatar)
    return {module_id: list(group.values()) for module_id, group in people.items()}


def _person_payload(user):
    return {"id": user.id, "display_name": user.display_name, "avatar_url": user.avatar_url}


@transaction.atomic
def save_flow(workspace, project, name, stages, flow=None, actor=None):
    name = (name or "").strip()
    if not name or len(name) > 200:
        raise ParseError(detail="Name the flow.")
    cleaned = validate_stages(project, stages)
    before = set()
    if flow is not None:
        old = list(FlowStageModule.objects.filter(stage__flow=flow).values_list("module_id", flat=True))
        before = {user.id for users in module_people(old).values() for user in users}
    if flow is None:
        flow = Flow.objects.create(workspace=workspace, project=project, name=name)
    else:
        flow.name = name
        flow.save()
        flow.stages.all().delete()
    for position, (stage_name, ids) in enumerate(cleaned):
        stage = FlowStage.objects.create(flow=flow, position=position, name=stage_name)
        FlowStageModule.objects.bulk_create([FlowStageModule(stage=stage, module_id=module_id) for module_id in ids])
    chosen = [module_id for _, ids in cleaned for module_id in ids]
    now = {user.id for users in module_people(chosen).values() for user in users}
    notify(
        workspace,
        now - before,
        "FLOW",
        f'You are in the flow "{flow.name}"',
        f"Open Teamflow and add your tasks to the modules of {project.name}.",
        link="team-ops/teamflow",
        actor=actor,
    )
    return flow


def progress_by_module(module_ids, since):
    """`{module_id: (done, total, side_done, side_total)}`.

    A work item added to a module after the flow was drawn (`since`) is a *side task*: counted apart, it
    never holds a stage back.
    """
    before = Q(created_at__lte=since)
    after = Q(created_at__gt=since)
    finished = Q(state__group="completed")
    rows = (
        Issue.issue_objects.filter(issue_module__module_id__in=module_ids, issue_module__deleted_at__isnull=True)
        .values("issue_module__module_id")
        .annotate(
            total=Count("id", filter=before, distinct=True),
            done=Count("id", filter=before & finished, distinct=True),
            side_total=Count("id", filter=after, distinct=True),
            side_done=Count("id", filter=after & finished, distinct=True),
        )
    )
    return {
        row["issue_module__module_id"]: (row["done"], row["total"], row["side_done"], row["side_total"]) for row in rows
    }


def percent(done, total):
    return None if total == 0 else round(done * 100 / total)


def describe(flow):
    """The flow with every module's progress. A stage is *pending* until every stage before it is finished."""
    stages = list(flow.stages.prefetch_related("modules__module"))
    module_ids = [row.module_id for stage in stages for row in stage.modules.all()]
    progress = progress_by_module(module_ids, flow.created_at)
    people = module_people(module_ids)
    result = []
    earlier_finished = True
    side_done_all = side_total_all = 0
    for stage in stages:
        modules = []
        done_sum = total_sum = side_done_sum = side_total_sum = 0
        for row in stage.modules.all():
            done, total, side_done, side_total = progress.get(row.module_id, (0, 0, 0, 0))
            done_sum += done
            total_sum += total
            side_done_sum += side_done
            side_total_sum += side_total
            modules.append(
                {
                    "id": row.module_id,
                    "name": row.module.name,
                    "status": row.module.status,
                    "done": done,
                    "total": total,
                    "side_done": side_done,
                    "side_total": side_total,
                    "percent": percent(done, total),
                    "people": [_person_payload(user) for user in people.get(row.module_id, [])],
                }
            )
        stage_percent = percent(done_sum, total_sum)
        result.append(
            {
                "id": stage.id,
                "name": stage.name,
                "pending": not earlier_finished,
                "percent": stage_percent,
                "done": done_sum,
                "total": total_sum,
                "side_done": side_done_sum,
                "side_total": side_total_sum,
                "modules": modules,
            }
        )
        side_done_all += side_done_sum
        side_total_all += side_total_sum
        earlier_finished = earlier_finished and stage_percent == 100
    return {
        "id": flow.id,
        "name": flow.name,
        "project": {"id": flow.project_id, "name": flow.project.name, "identifier": flow.project.identifier},
        "side_tasks": {"done": side_done_all, "total": side_total_all},
        "stages": result,
    }


def visible_flows(workspace, user, is_admin):
    """Admins see every flow; others see the flows of the projects they belong to."""
    queryset = Flow.objects.filter(workspace=workspace).select_related("project")
    if is_admin:
        return queryset
    mine = ProjectMember.objects.filter(member=user, is_active=True).values("project_id")
    return queryset.filter(project_id__in=mine)


def project_for(workspace, project_id):
    project = Project.objects.filter(workspace=workspace, pk=project_id).first() if project_id else None
    if project is None:
        raise ParseError(detail="Choose a project.")
    return project


def can_edit(user, project, is_admin):
    """Anyone in the project may draw its flow; admins may draw any."""
    return is_admin or ProjectMember.objects.filter(project=project, member=user, is_active=True).exists()


def modules_of_project(project):
    """What the editor offers: the project's modules and who is on them."""
    modules = list(project_modules(project).order_by("name"))
    people = module_people([module.id for module in modules])
    return [
        {
            "id": module.id,
            "name": module.name,
            "status": module.status,
            "people": [_person_payload(user) for user in people[module.id]],
        }
        for module in modules
    ]


def _open_issues(project):
    return Issue.issue_objects.filter(project=project).exclude(state__group__in=["completed", "cancelled"])


def suggestions(flow, user):
    """Work a person can pick up when nothing of theirs is left in the project.

    `pull`: open work items nobody has. `merge`: open work items others are still on, which they can join.
    """
    module_ids = list(FlowStageModule.objects.filter(stage__flow=flow).values_list("module_id", flat=True))
    in_flow = any(user.id in {person.id for person in group} for group in module_people(module_ids).values())
    own_open = _open_issues(flow.project).filter(issue_assignee__assignee=user).exists()
    if not in_flow or own_open:
        return {"eligible": False, "pull": [], "merge": []}

    def lite(issue):
        return {"id": issue.id, "name": issue.name, "key": f"{flow.project.identifier}-{issue.sequence_id}"}

    free = _open_issues(flow.project).filter(issue_assignee__isnull=True).order_by("created_at")[:10]
    busy = (
        _open_issues(flow.project)
        .filter(issue_assignee__isnull=False)
        .exclude(issue_assignee__assignee=user)
        .distinct()
        .order_by("created_at")[:10]
    )
    return {"eligible": True, "pull": [lite(i) for i in free], "merge": [lite(i) for i in busy]}


def pull(flow, user, issue_id):
    """Put the person on a work item (`pull` when it had nobody, `merge` when they join others)."""
    offer = suggestions(flow, user)
    if not offer["eligible"]:
        raise ParseError(detail="You still have open tasks in this project.")
    issue = _open_issues(flow.project).filter(pk=issue_id).first()
    if issue is None:
        raise ParseError(detail="That work item is not open in this project.")
    had_others = IssueAssignee.objects.filter(issue=issue).exists()
    IssueAssignee.objects.create(issue=issue, assignee=user, project=flow.project, workspace=flow.workspace)
    return {"kind": "merge" if had_others else "pull", "issue": issue.id}
