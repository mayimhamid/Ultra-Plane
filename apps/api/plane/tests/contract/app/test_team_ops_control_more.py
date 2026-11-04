# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Parallel tasks, changing the day's answer, approvals, hours, ranking, side tasks and pull/merge."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import Issue, IssueAssignee, ModuleIssue, State
from plane.team_ops.models import (
    Flow,
    WeekPlanConfirmation,
    ActiveTimer,
    CalendarEntry,
    WorkApproval,
    WorkDay,
    WorkSession,
)
from plane.team_ops.services.workday import week_start_of
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


@pytest.fixture(autouse=True)
def planned_week(workspace, member, colleague, admin):
    start = week_start_of(timezone.now().date())
    for user in (member, colleague, admin):
        for offset in range(7):
            CalendarEntry.objects.get_or_create(
                workspace=workspace,
                user=user,
                work_date=start + timedelta(days=offset),
                defaults={"work_mode": "REMOTE"},
            )
        WeekPlanConfirmation.objects.get_or_create(
            workspace=workspace, user=user, week_start=start, defaults={"confirmed_at": timezone.now()}
        )


@pytest.fixture
def project(workspace, admin, member, colleague):
    return make_project(workspace, admin, "PX", members=[member, colleague])


@pytest.fixture
def issues(workspace, project):
    return [Issue.objects.create(name=f"Task {i}", project=project, workspace=workspace) for i in range(3)]


def w(workspace, path=""):
    return url(workspace, f"workday/{path}")


def day(client, workspace, mode="REMOTE"):
    return client.post(w(workspace, "day/"), {"mode": mode}, format="json")


def start(client, workspace, issue, **extra):
    return client.post(w(workspace, "start/"), {"issue": str(issue.id), **extra}, format="json")


def finish(client, workspace, **extra):
    return client.post(
        url(workspace, "work-sessions/finish/"), {"summary": "Done", "no_document": "true", **extra}, format="multipart"
    )


def session(workspace, user, issue, minutes, place="REMOTE", parallel=False, ago=0):
    end = timezone.now() - timedelta(days=ago)
    return WorkSession.objects.create(
        workspace=workspace,
        user=user,
        project=issue.project,
        issue=issue,
        started_at=end - timedelta(minutes=minutes),
        finished_at=end,
        duration_seconds=minutes * 60,
        summary="x",
        location=place,
        is_parallel=parallel,
    )


def span(back=2):
    today = timezone.now().date()
    return {"from": str(today - timedelta(days=back)), "to": str(today)}


@pytest.mark.contract
class TestParallelTasks:
    def test_a_second_task_runs_beside_the_main_one(self, member_client, workspace, member, issues):
        day(member_client, workspace)
        assert (
            member_client.post(w(workspace, "parallel/"), {"issue": str(issues[1].id)}, format="json").status_code
            == 400
        )
        start(member_client, workspace, issues[0])
        response = member_client.post(w(workspace, "parallel/"), {"issue": str(issues[1].id)}, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["timer"]["work_item"] == "PX-1" and response.data["timer"]["is_parallel"] is False
        (parallel,) = response.data["parallel"]
        assert parallel["is_parallel"] is True and parallel["work_item"] == "PX-2"

    def test_a_parallel_task_is_finished_on_its_own_and_counted_apart(self, member_client, workspace, member, issues):
        day(member_client, workspace)
        start(member_client, workspace, issues[0])
        parallel = member_client.post(w(workspace, "parallel/"), {"issue": str(issues[1].id)}, format="json").data[
            "parallel"
        ][0]
        ActiveTimer.objects.filter(pk=parallel["id"]).update(started_at=timezone.now() - timedelta(minutes=40))
        response = finish(member_client, workspace, timer=parallel["id"])
        assert response.status_code == 201 and response.data["session"]["is_parallel"] is True
        assert 39 * 60 <= response.data["session"]["duration_seconds"] <= 41 * 60
        state = member_client.get(w(workspace)).data
        assert state["timer"] is not None and state["parallel"] == []  # the main task goes on
        assert 39 * 60 <= state["totals"]["parallel_seconds"] <= 41 * 60
        assert state["totals"]["remote_seconds"] < 60  # parallel work is not added to the main hours

    def test_a_parallel_task_is_never_frozen_and_the_main_one_is_unaffected(
        self, member_client, workspace, member, issues
    ):
        from plane.team_ops.services.workday import freeze_unanswered_timers

        day(member_client, workspace)
        start(member_client, workspace, issues[0])
        member_client.post(w(workspace, "parallel/"), {"issue": str(issues[1].id)}, format="json")
        old = timezone.now() - timedelta(minutes=90)
        ActiveTimer.objects.update(started_at=old, last_confirmed_at=old)
        assert freeze_unanswered_timers() == 1
        states = dict(ActiveTimer.objects.values_list("is_parallel", "state"))
        assert states == {False: "FROZEN", True: "RUNNING"}

    def test_someone_elses_timer_cannot_be_finished(self, member_client, workspace, colleague, issues):
        day(member_client, workspace)
        start(member_client, workspace, issues[0])
        other = make_client(colleague)
        day(other, workspace)
        start(other, workspace, issues[0])
        theirs = other.post(w(workspace, "parallel/"), {"issue": str(issues[1].id)}, format="json").data["parallel"][0]
        assert finish(member_client, workspace, timer=theirs["id"]).status_code == 400
        assert ActiveTimer.objects.filter(pk=theirs["id"]).exists()


@pytest.mark.contract
class TestChangeTheDaysAnswer:
    def test_override_needs_every_task_of_the_day(self, member_client, workspace, member, issues):
        day(member_client, workspace, "REMOTE")
        a = session(workspace, member, issues[0], 30)
        b = session(workspace, member, issues[1], 30)
        over = lambda body: member_client.post(w(workspace, "day/override/"), body, format="json")  # noqa: E731
        assert over({"mode": "ONSITE", "sessions": {str(a.id): "ONSITE"}}).status_code == 400
        assert over({"mode": "ONSITE", "sessions": {str(a.id): "ONSITE", str(b.id): "moon"}}).status_code == 400
        assert over({"mode": "ONSITE", "sessions": {str(a.id): "ONSITE", "x": "ONSITE"}}).status_code == 400
        response = over({"mode": "ONSITE", "sessions": {str(a.id): "ONSITE", str(b.id): "ONSITE"}})
        assert response.status_code == 200 and response.data["day"]["mode"] == "ONSITE"
        assert set(WorkSession.objects.values_list("location", flat=True)) == {"ONSITE"}

    def test_different_places_make_the_day_hybrid(self, member_client, workspace, member, issues):
        day(member_client, workspace, "REMOTE")
        a = session(workspace, member, issues[0], 30)
        b = session(workspace, member, issues[1], 30)
        response = member_client.post(
            w(workspace, "day/override/"),
            {"mode": "REMOTE", "sessions": {str(a.id): "REMOTE", str(b.id): "ONSITE"}},
            format="json",
        )
        assert response.data["day"]["mode"] == "HYBRID"

    def test_only_todays_own_tasks_count(self, member_client, workspace, member, colleague, issues):
        day(member_client, workspace, "REMOTE")
        yesterday = session(workspace, member, issues[0], 30, ago=1)
        theirs = session(workspace, colleague, issues[1], 30)
        response = member_client.post(
            w(workspace, "day/override/"),
            {"mode": "ONSITE", "sessions": {str(yesterday.id): "ONSITE", str(theirs.id): "ONSITE"}},
            format="json",
        )
        assert response.status_code == 400
        assert set(WorkSession.objects.values_list("location", flat=True)) == {"REMOTE"}

    def test_needs_an_answer_first(self, member_client, workspace):
        response = member_client.post(w(workspace, "day/override/"), {"mode": "ONSITE", "sessions": {}}, format="json")
        assert response.status_code == 400


@pytest.mark.contract
class TestApprovalsAndHours:
    def test_hours_by_place_with_the_approval_state(self, admin_client, workspace, member, issues):
        session(workspace, member, issues[0], 60, "ONSITE")
        session(workspace, member, issues[1], 30, "REMOTE")
        session(workspace, member, issues[2], 45, "REMOTE", parallel=True)
        data = admin_client.get(url(workspace, "control/hours/"), span()).data
        person = next(p for p in data["people"] if p["user"]["id"] == member.id)
        today = person["days"][-1]
        assert (today["onsite_seconds"], today["remote_seconds"], today["parallel_seconds"]) == (3600, 1800, 2700)
        assert today["approved"] is False and person["days"][0]["approved"] is None
        assert person["pending_days"] == 1 and data["pending_days"] == 1 and data["can_approve"] is True
        assert data["team"][-1]["onsite_seconds"] == 3600

    def test_approve_and_take_back(self, admin_client, workspace, member, issues):
        session(workspace, member, issues[0], 60, ago=1)
        session(workspace, member, issues[0], 60)
        body = {"user": str(member.id), **span(5)}
        assert admin_client.post(url(workspace, "control/approvals/"), body, format="json").data["changed"] == 2
        assert admin_client.post(url(workspace, "control/approvals/"), body, format="json").data["changed"] == 0
        assert WorkApproval.objects.count() == 2
        data = admin_client.get(url(workspace, "control/hours/"), span()).data
        assert data["pending_days"] == 0
        taken = admin_client.post(url(workspace, "control/approvals/"), {**body, "approved": False}, format="json")
        assert taken.data["changed"] == 2 and WorkApproval.objects.count() == 0

    def test_days_nobody_approved_stay_pending(self, admin_client, workspace, member, issues):
        session(workspace, member, issues[0], 30, ago=3)
        session(workspace, member, issues[0], 30, ago=1)
        data = admin_client.get(url(workspace, "control/hours/"), span(6)).data
        assert data["pending_days"] == 2

    def test_only_admins_approve_and_only_their_workspace(
        self, admin_client, lead_client, member_client, workspace, member, other_workspace
    ):
        body = {"user": str(member.id), **span()}
        for client in (lead_client, member_client):
            assert client.post(url(workspace, "control/approvals/"), body, format="json").status_code == 403
        foreign = {"user": str(other_workspace.owner.id), **span()}
        assert admin_client.post(url(workspace, "control/approvals/"), foreign, format="json").status_code == 404

    def test_viewing_hours_needs_the_right_to_see_the_team(self, member_client, workspace):
        assert member_client.get(url(workspace, "control/hours/"), span()).status_code == 403


@pytest.mark.contract
class TestRanking:
    def test_ranks_by_tasks_and_hours_with_badges(self, admin_client, workspace, member, colleague, issues):
        session(workspace, member, issues[0], 120)
        session(workspace, member, issues[1], 60)
        session(workspace, colleague, issues[0], 300)
        session(workspace, colleague, issues[2], 180, parallel=True)
        rows = {
            r["user"]["id"]: r for r in admin_client.get(url(workspace, "control/ranking/"), span()).data["results"]
        }
        assert rows[member.id]["rank_tasks"] == 1 and rows[member.id]["tasks"] == 2
        assert rows[colleague.id]["rank_hours"] == 1 and rows[colleague.id]["seconds"] == 300 * 60
        assert rows[colleague.id]["parallel_seconds"] == 180 * 60
        assert "Most tasks" in rows[member.id]["badges"] and "Most hours" in rows[colleague.id]["badges"]
        assert "Hyperactive" in rows[colleague.id]["badges"] and "Hyperactive" not in rows[member.id]["badges"]

    def test_people_without_work_have_no_rank(self, admin_client, workspace, colleague):
        rows = {
            r["user"]["id"]: r for r in admin_client.get(url(workspace, "control/ranking/"), span()).data["results"]
        }
        assert rows[colleague.id]["rank_tasks"] is None and rows[colleague.id]["badges"] == []

    def test_needs_the_right_to_see_the_team(self, member_client, workspace):
        assert member_client.get(url(workspace, "control/ranking/"), span()).status_code == 403

    def test_team_overview_keeps_parallel_apart(self, admin_client, workspace, member, issues):
        session(workspace, member, issues[0], 60)
        session(workspace, member, issues[1], 30, parallel=True)
        row = next(
            r
            for r in admin_client.get(url(workspace, "control/team/"), span()).data["results"]
            if r["user"]["id"] == member.id
        )
        assert row["period"]["seconds"] == 3600 and row["period"]["parallel_seconds"] == 1800


@pytest.mark.contract
class TestSideTasksPullAndMerge:
    def make_flow(self, client, workspace, project, *groups):
        return client.post(
            url(workspace, "teamflow/flows/"),
            {
                "project": str(project.id),
                "name": "Release",
                "stages": [{"name": f"S{i}", "modules": [str(m.id) for m in g]} for i, g in enumerate(groups)],
            },
            format="json",
        )

    def assign(self, workspace, project, issue, user):
        IssueAssignee.objects.create(issue=issue, assignee=user, project=project, workspace=workspace)

    def done_state(self, workspace, project):
        return State.objects.filter(project=project, group="completed").first() or State.objects.create(
            name="Done", group="completed", project=project, workspace=workspace
        )

    def test_tasks_added_to_a_module_after_the_flow_are_side_tasks(
        self, member_client, workspace, project, member, issues
    ):
        module = make_module(workspace, project, "Build", lead=member, issues=[issues[0]])
        flow = self.make_flow(member_client, workspace, project, [module]).data
        Flow.objects.filter(pk=flow["id"]).update(created_at=timezone.now() - timedelta(days=1))
        Issue.objects.filter(pk=issues[0].pk).update(
            created_at=timezone.now() - timedelta(days=2), state=self.done_state(workspace, project)
        )
        State.objects.create(name="Todo", group="unstarted", default=True, project=project, workspace=workspace)
        late = Issue.objects.create(name="Late", project=project, workspace=workspace)
        ModuleIssue.objects.create(module=module, issue=late, project=project, workspace=workspace)
        data = member_client.get(url(workspace, "teamflow/flows/")).data["results"][0]
        stage = data["stages"][0]
        assert (stage["done"], stage["total"]) == (1, 1) and stage["percent"] == 100  # the side task does not count
        assert (stage["side_done"], stage["side_total"]) == (0, 1)
        assert data["side_tasks"] == {"done": 0, "total": 1}

    def test_a_person_with_nothing_left_can_pull_or_merge(
        self, member_client, colleague, workspace, project, member, issues
    ):
        module = make_module(workspace, project, "Build", lead=member)
        flow = self.make_flow(member_client, workspace, project, [module]).data
        self.assign(workspace, project, issues[1], colleague)  # someone else is on it
        offer = member_client.get(url(workspace, f"teamflow/flows/{flow['id']}/pull/")).data
        assert offer["eligible"] is True
        assert [i["name"] for i in offer["pull"]] == ["Task 0", "Task 2"]
        assert [i["name"] for i in offer["merge"]] == ["Task 1"]
        pulled = member_client.post(
            url(workspace, f"teamflow/flows/{flow['id']}/pull/"), {"issue": str(issues[0].id)}, format="json"
        )
        assert pulled.status_code == 201 and pulled.data["kind"] == "pull"
        assert IssueAssignee.objects.filter(issue=issues[0], assignee=member).exists()

    def test_joining_someone_elses_task_is_a_merge(self, member_client, colleague, workspace, project, member, issues):
        flow = self.make_flow(member_client, workspace, project, [make_module(workspace, project, lead=member)]).data
        self.assign(workspace, project, issues[1], colleague)
        merged = member_client.post(
            url(workspace, f"teamflow/flows/{flow['id']}/pull/"), {"issue": str(issues[1].id)}, format="json"
        )
        assert merged.data["kind"] == "merge"
        assert IssueAssignee.objects.filter(issue=issues[1]).count() == 2

    def test_not_while_there_is_still_work(self, member_client, workspace, project, member, issues):
        flow = self.make_flow(member_client, workspace, project, [make_module(workspace, project, lead=member)]).data
        self.assign(workspace, project, issues[0], member)
        assert member_client.get(url(workspace, f"teamflow/flows/{flow['id']}/pull/")).data["eligible"] is False
        response = member_client.post(
            url(workspace, f"teamflow/flows/{flow['id']}/pull/"), {"issue": str(issues[1].id)}, format="json"
        )
        assert response.status_code == 400 and not IssueAssignee.objects.filter(issue=issues[1]).exists()

    def test_not_for_people_outside_the_flow_or_other_projects(
        self, member_client, lead_client, workspace, project, member, colleague, issues
    ):
        flow = self.make_flow(member_client, workspace, project, [make_module(workspace, project, lead=member)]).data
        path = url(workspace, f"teamflow/flows/{flow['id']}/pull/")
        assert lead_client.get(path).status_code == 404  # not in the project
        assert make_client(colleague).get(path).data["eligible"] is False  # in the project, not on any module
        other = Issue.objects.create(
            name="Elsewhere", project=make_project(workspace, member, "ZZ"), workspace=workspace
        )
        assert member_client.post(path, {"issue": str(other.id)}, format="json").status_code == 400
