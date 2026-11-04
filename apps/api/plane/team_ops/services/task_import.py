# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Import many tasks at once: as micro tasks of one person, or as work items of a project.

The page reads the file (JSON or CSV) and sends its rows. A dry run checks every row and returns a preview
with the problems of each; only when the person confirms are the tasks created, all of them or none.
"""

from datetime import date

# Django imports
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

# Third party imports
from rest_framework.exceptions import ParseError

# Module imports
from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.team_ops.models import PlanUnit
from plane.team_ops.services.day_reports import create_micro, set_plan, to_minutes

MAX_ITEMS = 300
PRIORITIES = ("urgent", "high", "medium", "low", "none")


def _date(value, field, errors):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        errors.append(f"{field} must be a date like 2026-11-20.")
        return None


def _planned(item, errors):
    """(amount, unit) from planned_hours or planned_days."""
    for key, unit in (("planned_hours", PlanUnit.HOURS), ("planned_days", PlanUnit.DAYS)):
        value = item.get(key)
        if value not in (None, ""):
            try:
                to_minutes(value, unit)
            except ParseError as error:
                errors.append(str(error.detail))
                return None, PlanUnit.HOURS
            return value, unit
    return None, PlanUnit.HOURS


def _people(workspace):
    """Workspace members, found by email, display name or full name (case does not matter)."""
    users = User.objects.filter(member_workspace__workspace=workspace, member_workspace__is_active=True).distinct()
    index = {}
    for user in users:
        for key in (user.email, user.display_name, f"{user.first_name} {user.last_name}".strip()):
            if key:
                index.setdefault(key.strip().lower(), user)
    return index


def _list(value):
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.replace(";", ",").split(",") if part.strip()]
    if isinstance(value, list):
        return [str(part).strip() for part in value if str(part).strip()]
    return [str(value)]


def preview(*, workspace, target, items, project=None, assignee=None):
    """Check every row. Returns `(rows, ok)`: rows hold the resolved values and the errors of each."""
    if not isinstance(items, list) or not items:
        raise ParseError(detail="The file has no tasks.")
    if len(items) > MAX_ITEMS:
        raise ParseError(detail=f"Import at most {MAX_ITEMS} tasks at a time.")
    people = _people(workspace)
    states = modules = labels = members = {}
    if target == "project":
        states = {s.name.lower(): s for s in State.objects.filter(project=project)}
        modules = {m.name.lower(): m for m in Module.objects.filter(project=project)}
        labels = {label.name.lower(): label for label in Label.objects.filter(project=project)}
        members = set(ProjectMember.objects.filter(project=project, is_active=True).values_list("member_id", flat=True))
    rows = []
    for number, item in enumerate(items, start=1):
        errors = []
        if not isinstance(item, dict):
            rows.append({"row": number, "title": "", "errors": ["This row is not an object."]})
            continue
        title = str(item.get("title") or item.get("name") or "").strip()
        if not title:
            errors.append("The title is missing.")
        amount, unit = _planned(item, errors)
        row = {
            "row": number,
            "title": title[:255],
            "description": str(item.get("description") or "")[:5000],
            "planned_amount": amount,
            "unit": unit,
            "due_date": _date(item.get("due_date"), "due_date", errors),
            "errors": errors,
        }
        if target == "micro":
            row["is_meeting"] = bool(item.get("is_meeting"))
            row["assignee"] = {"id": str(assignee.id), "display_name": assignee.display_name}
        else:
            row["start_date"] = _date(item.get("start_date"), "start_date", errors)
            if row["start_date"] and row["due_date"] and row["start_date"] > row["due_date"]:
                errors.append("The start date is after the due date.")
            priority = str(item.get("priority") or "none").strip().lower()
            if priority not in PRIORITIES:
                errors.append(f"Priority must be one of: {', '.join(PRIORITIES)}.")
            row["priority"] = priority
            found = []
            for name in _list(item.get("assignees")) or ([assignee.email] if assignee else []):
                person = people.get(name.lower())
                if person is None or person.id not in members:
                    errors.append(f'"{name}" is not a member of this project.')
                else:
                    found.append({"id": str(person.id), "display_name": person.display_name})
            row["assignees"] = found
            state_name = str(item.get("state") or "").strip()
            state = states.get(state_name.lower()) if state_name else None
            if state_name and state is None:
                errors.append(f'There is no state "{state_name}" in this project.')
            row["state"] = {"id": str(state.id), "name": state.name} if state else None
            module_name = str(item.get("module") or "").strip()
            module = modules.get(module_name.lower()) if module_name else None
            if module_name and module is None:
                errors.append(f'There is no module "{module_name}" in this project.')
            row["module"] = {"id": str(module.id), "name": module.name} if module else None
            row["labels"] = []
            for name in _list(item.get("labels")):
                label = labels.get(name.lower())
                if label is None:
                    errors.append(f'There is no label "{name}" in this project.')
                else:
                    row["labels"].append({"id": str(label.id), "name": label.name})
        rows.append(row)
    return rows, all(not row["errors"] for row in rows)


def create(*, workspace, actor, target, rows, project=None, assignee=None):
    """Create every previewed row in one transaction. Returns how many were created."""
    now = timezone.now()
    with transaction.atomic():
        for row in rows:
            if target == "micro":
                create_micro(
                    workspace=workspace,
                    assignee=assignee,
                    actor=actor,
                    title=row["title"],
                    description=row["description"],
                    amount=row["planned_amount"],
                    unit=row["unit"],
                    due_date=row["due_date"],
                    is_meeting=row.get("is_meeting", False),
                )
                continue
            issue = Issue(
                workspace=workspace,
                project=project,
                name=row["title"],
                description_html=f"<p>{row['description']}</p>" if row["description"] else "<p></p>",
                priority=row["priority"],
                start_date=row["start_date"],
                target_date=row["due_date"],
                created_by=actor,
                updated_by=actor,
            )
            if row["state"]:
                issue.state_id = row["state"]["id"]
            issue.save()
            for person in row["assignees"]:
                IssueAssignee.objects.create(
                    issue=issue, assignee_id=person["id"], project=project, workspace=workspace, created_by=actor
                )
            for label in row["labels"]:
                IssueLabel.objects.create(
                    issue=issue, label_id=label["id"], project=project, workspace=workspace, created_by=actor
                )
            if row["module"]:
                ModuleIssue.objects.create(
                    issue=issue, module_id=row["module"]["id"], project=project, workspace=workspace, created_by=actor
                )
            if row["planned_amount"] not in (None, ""):
                set_plan(workspace, issue, row["planned_amount"], row["unit"])
            # Plane's history of the work item; it also tells the assignees (see assignments.py).
            IssueActivity.objects.create(
                issue=issue,
                project=project,
                workspace=workspace,
                actor=actor,
                verb="created",
                comment="created the work item (import)",
                epoch=int(now.timestamp()),
            )
    return len(rows)


def is_workspace_member(workspace, user_id):
    return WorkspaceMember.objects.filter(Q(workspace=workspace) & Q(member_id=user_id) & Q(is_active=True)).exists()


def context(workspace, project=None):
    """Names an import may use, for the AI prompt: people (of the project, or the workspace) and project lists."""
    if project is not None:
        people = User.objects.filter(
            member_project__project=project, member_project__is_active=True, member_project__deleted_at__isnull=True
        ).distinct()
    else:
        people = User.objects.filter(member_workspace__workspace=workspace, member_workspace__is_active=True).distinct()
    payload = {
        "people": [{"display_name": p.display_name, "email": p.email} for p in people.order_by("display_name")],
        "modules": [],
        "states": [],
        "labels": [],
    }
    if project is not None:
        payload["project"] = {"name": project.name, "identifier": project.identifier}
        payload["modules"] = list(Module.objects.filter(project=project).values_list("name", flat=True))
        payload["states"] = list(State.objects.filter(project=project).values_list("name", flat=True))
        payload["labels"] = list(Label.objects.filter(project=project).values_list("name", flat=True))
    return payload
