# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Tasks: every work item in one list, with its forks, project and flows."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import Issue, IssueAssignee, ModuleIssue, State
from plane.team_ops.models import DayReport, DayReportEntry, Flow
from plane.team_ops.services import flows as flow_service
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    guest_client,
    lead,
    lead_client,
    make_client,
    make_module,
    make_project,
    member,
    member_client,
    other_workspace,
    outsider,
    outsider_client,
    url,
    workspace,
)


def with_states(project):
    State.objects.create(name="Todo", group="unstarted", default=True, project=project, workspace=project.workspace)
    return project


@pytest.fixture
def project(workspace, admin, member, colleague):
    return with_states(make_project(workspace, admin, "TK", members=[member, colleague]))


def api(workspace, **params):
    return url(workspace, "tasks/")


def issue(workspace, project, name="Task", parent=None):
    return Issue.objects.create(name=name, project=project, workspace=workspace, parent=parent)


def assign(workspace, project, task, user):
    IssueAssignee.objects.create(issue=task, assignee=user, project=project, workspace=workspace)


def spend(workspace, user, task, minutes, day_offset=0):
    """A Day Report row: `minutes` on `task`, `day_offset` days ago (one report per person and day)."""
    day = timezone.now().date() - timedelta(days=day_offset)
    report, _ = DayReport.objects.get_or_create(workspace=workspace, user=user, date=day)
    DayReportEntry.objects.create(report=report, issue=task, minutes=minutes, location="REMOTE")


def done_state(workspace, project):
    return State.objects.filter(project=project, group="completed").first() or State.objects.create(
        name="Done", group="completed", project=project, workspace=workspace
    )


def make_flow(workspace, project, *groups):
    return flow_service.save_flow(
        workspace,
        project,
        "Release",
        [{"name": f"Stage {i + 1}", "modules": [str(m.id) for m in group]} for i, group in enumerate(groups)],
    )


@pytest.mark.contract
class TestTasks:
    def test_one_shape_with_project_state_and_people(self, member_client, workspace, project, member):
        task = issue(workspace, project, "Fix login")
        assign(workspace, project, task, member)
        data = member_client.get(api(workspace)).data
        (row,) = data["results"]
        assert row["key"] == "TK-1" and row["name"] == "Fix login"
        assert row["project"]["identifier"] == "TK" and row["state"]["group"] in ("backlog", "unstarted", "started")
        assert [p["id"] for p in row["assignees"]] == [member.id]
        assert data["total"] == 1 and data["has_more"] is False
        assert data["filters"]["projects"][0]["identifier"] == "TK"

    def test_time_is_the_day_report_time_summed_per_task(self, member_client, workspace, project, member, colleague):
        task = issue(workspace, project)
        assign(workspace, project, task, member)
        spend(workspace, member, task, 60)
        spend(workspace, member, task, 30, day_offset=1)
        spend(workspace, colleague, task, 20)  # not assigned, but worked on it
        (row,) = member_client.get(api(workspace)).data["results"]
        assert row["seconds"] == 110 * 60 and row["sessions"] == 3
        assert row["plan"]["reported_minutes"] == 110 and row["plan"]["status"] is None
        people = {fork["user"]["id"]: fork for fork in row["forks"] if fork["kind"] == "person"}
        assert people[member.id]["seconds"] == 90 * 60 and people[colleague.id]["seconds"] == 1200

    def test_sub_items_and_people_are_the_forks(self, member_client, workspace, project, member, colleague):
        parent = issue(workspace, project, "Parent")
        child = issue(workspace, project, "Child", parent=parent)
        assign(workspace, project, parent, member)
        assign(workspace, project, child, colleague)
        data = member_client.get(api(workspace)).data
        assert [r["name"] for r in data["results"]] == ["Parent"]  # children are not listed on their own
        forks = data["results"][0]["forks"]
        sub = next(f for f in forks if f["kind"] == "sub")
        assert sub["name"] == "Child" and sub["project"]["identifier"] == "TK"
        assert [p["id"] for p in sub["assignees"]] == [colleague.id]
        assert [f["user"]["id"] for f in forks if f["kind"] == "person"] == [member.id]

    def test_flows_and_stages_are_shown_and_late_tasks_are_side_tasks(
        self, member_client, workspace, project, member, colleague
    ):
        early = issue(workspace, project, "Early")
        assign(workspace, project, early, member)
        build = make_module(workspace, project, "Build", issues=[early])
        test = make_module(workspace, project, "Test")
        flow = make_flow(workspace, project, [build], [test])
        Issue.objects.filter(pk=early.pk).update(created_at=timezone.now() - timedelta(days=3))
        Flow.objects.filter(pk=flow.pk).update(created_at=timezone.now() - timedelta(days=1))
        late = issue(workspace, project, "Late")
        assign(workspace, project, late, colleague)
        ModuleIssue.objects.create(module=test, issue=late, project=project, workspace=workspace)
        rows = {r["name"]: r for r in member_client.get(api(workspace)).data["results"]}
        assert rows["Early"]["flows"] == [{"id": flow.id, "name": "Release", "stages": ["Stage 1"], "side": False}]
        assert rows["Late"]["flows"][0]["stages"] == ["Stage 2"] and rows["Late"]["flows"][0]["side"] is True
        stage = next(f["stage"] for f in rows["Early"]["forks"] if f["kind"] == "person")
        assert stage == "Stage 1"

    def test_filters(self, member_client, workspace, project, member, colleague, admin):
        other = with_states(make_project(workspace, admin, "OT", members=[member]))
        mine = issue(workspace, project, "Mine")
        theirs = issue(workspace, project, "Theirs")
        issue(workspace, other, "Elsewhere")
        assign(workspace, project, mine, member)
        assign(workspace, project, theirs, colleague)
        Issue.objects.filter(pk=theirs.pk).update(state=done_state(workspace, project))
        module = make_module(workspace, project, "Only", issues=[mine, theirs])
        flow = make_flow(workspace, project, [module])

        def names(**params):
            return sorted(r["name"] for r in member_client.get(api(workspace), params).data["results"])

        assert names() == ["Elsewhere", "Mine", "Theirs"]
        assert names(project=str(other.id)) == ["Elsewhere"]
        assert names(mine="1") == ["Mine"]
        assert names(assignee=str(colleague.id)) == ["Theirs"]
        assert names(status="done") == ["Theirs"] and names(status="open") == ["Elsewhere", "Mine"]
        assert names(flow=str(flow.id)) == ["Mine", "Theirs"]
        assert names(q="else") == ["Elsewhere"]
        assert member_client.get(api(workspace), {"status": "weird"}).status_code == 400
        assert member_client.get(api(workspace), {"project": "nope"}).status_code == 400

    def test_people_only_see_their_own_projects_and_admins_see_all(
        self, member_client, lead_client, admin_client, workspace, project, member
    ):
        issue(workspace, project, "Secret plan")
        assert [r["name"] for r in member_client.get(api(workspace)).data["results"]] == ["Secret plan"]
        assert lead_client.get(api(workspace)).data["results"] == []
        assert len(admin_client.get(api(workspace)).data["results"]) == 1

    def test_not_for_guests_or_other_workspaces(self, guest_client, workspace, other_workspace, project):
        issue(workspace, project)
        assert guest_client.get(api(workspace)).status_code == status.HTTP_403_FORBIDDEN
        foreign = make_client(other_workspace.owner)
        assert foreign.get(api(other_workspace)).data["results"] == []

    def test_the_list_is_capped(self, admin_client, workspace, project):
        from plane.team_ops.services import tasks

        for i in range(tasks.LIMIT + 2):
            issue(workspace, project, f"T{i}")
        data = admin_client.get(api(workspace)).data
        assert len(data["results"]) == tasks.LIMIT and data["total"] == tasks.LIMIT + 2 and data["has_more"] is True


@pytest.mark.contract
class TestOneWorkItem:
    def test_the_panel_asks_for_one_work_item_even_a_sub_item(self, member_client, workspace, project, member):
        parent = issue(workspace, project, "Parent")
        child = issue(workspace, project, "Child", parent=parent)
        spend(workspace, member, child, 45)
        data = member_client.get(api(workspace), {"issue": str(child.id)}).data
        (row,) = data["results"]
        assert row["name"] == "Child" and row["seconds"] == 45 * 60
        assert [r["name"] for r in member_client.get(api(workspace), {"issue": str(parent.id)}).data["results"]] == [
            "Parent"
        ]

    def test_not_a_work_item_of_a_project_you_are_not_in(self, lead_client, workspace, project):
        secret = issue(workspace, project, "Secret")
        assert lead_client.get(api(workspace), {"issue": str(secret.id)}).data["results"] == []
