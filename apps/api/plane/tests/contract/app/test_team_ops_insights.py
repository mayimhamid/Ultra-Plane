# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Team Ops task risk and workload insights."""

from datetime import datetime, timedelta, timezone as dt_timezone

import pytest

from plane.db.models import Issue, IssueAssignee, IssueRelation, ProjectMember, State
from plane.team_ops.models import CalendarEntry, TaskPlan, TimeEntry
from plane.team_ops.services.insights import score_task
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    guest_client,
    lead,
    lead_client,
    make_project,
    make_team,
    member,
    member_client,
    other_workspace,
    outsider,
    outsider_client,
    today,
    url,
    workspace,
)

NOW = datetime(2026, 1, 15, 12, tzinfo=dt_timezone.utc)
TODAY = NOW.date()


def facts(**over):
    base = {
        "target_date": None,
        "priority": "none",
        "state_group": "unstarted",
        "assignee_count": 1,
        "blocked": False,
        "planned_seconds": 3600,
        "logged_seconds": 0,
        "last_activity": NOW,
    }
    return {**base, **over}


def codes(task):
    return [f["code"] for f in score_task(task, TODAY, NOW)[1]]


class TestScoring:
    def test_a_healthy_task_has_no_risk(self):
        assert score_task(facts(), TODAY, NOW) == (0, [])

    def test_overdue_grows_with_days_and_is_capped(self):
        two = score_task(facts(target_date=TODAY - timedelta(days=2)), TODAY, NOW)[0]
        far = score_task(facts(target_date=TODAY - timedelta(days=90)), TODAY, NOW)[0]
        assert two == 46 and far == 70

    def test_due_soon_and_due_today(self):
        assert codes(facts(target_date=TODAY)) == ["DUE_SOON"]
        assert codes(facts(target_date=TODAY + timedelta(days=3))) == ["DUE_SOON"]
        assert codes(facts(target_date=TODAY + timedelta(days=4))) == []

    def test_stalled_only_applies_to_started_work(self):
        old = NOW - timedelta(days=8)
        assert codes(facts(state_group="started", last_activity=old)) == ["STALLED"]
        assert codes(facts(state_group="unstarted", last_activity=old)) == []

    def test_over_estimate_has_two_steps(self):
        assert score_task(facts(logged_seconds=4000), TODAY, NOW)[0] == 20
        assert score_task(facts(logged_seconds=6000), TODAY, NOW)[0] == 30

    def test_missing_information(self):
        assert codes(facts(assignee_count=0)) == ["UNASSIGNED"]
        assert codes(facts(priority="urgent")) == ["NO_DUE_DATE"]
        assert codes(facts(planned_seconds=None, state_group="started")) == ["NO_ESTIMATE"]

    def test_score_is_capped_and_every_factor_explains_itself(self):
        task = facts(
            target_date=TODAY - timedelta(days=30),
            blocked=True,
            assignee_count=0,
            state_group="started",
            last_activity=NOW - timedelta(days=30),
        )
        score, factors = score_task(task, TODAY, NOW)
        assert score == 100
        assert all(f["detail"] and f["points"] > 0 for f in factors)


def make_issue(project, name, state, assignees=(), **fields):
    issue = Issue.objects.create(project=project, name=name, state=state, **fields)
    for user in assignees:
        IssueAssignee.objects.create(issue=issue, assignee=user, project=project)
    return issue


@pytest.fixture
def board(workspace, admin, member, colleague):
    project = make_project(workspace, admin, "RSK", members=[member, colleague])
    started = State.objects.create(project=project, name="Doing", group="started")
    done = State.objects.create(project=project, name="Done", group="completed")
    late = make_issue(project, "Late", started, [member], target_date=today() - timedelta(days=4))
    blocker = make_issue(project, "Blocker", started, [colleague])
    blocked = make_issue(project, "Blocked", started, [member])
    IssueRelation.objects.create(issue=blocked, related_issue=blocker, relation_type="blocked_by", project=project)
    orphan = make_issue(project, "Orphan", started)
    finished = make_issue(project, "Finished", done, [member], target_date=today() - timedelta(days=9))
    return {"project": project, "late": late, "blocked": blocked, "orphan": orphan, "finished": finished}


def insights(workspace, **filters):
    start = today()
    query = "&".join(f"{k}={v}" for k, v in {"from": start, "to": start + timedelta(days=6), **filters}.items())
    return url(workspace, f"insights/?{query}")


@pytest.mark.contract
class TestInsights:
    @pytest.mark.django_db
    def test_risks_are_ranked_and_explained(self, admin_client, workspace, board):
        data = admin_client.get(insights(workspace)).data

        names = [t["name"] for t in data["risks"]["tasks"]]
        assert names[0] == "Late"
        assert "Finished" not in names
        assert data["risks"]["open_tasks"] == 4
        late = data["risks"]["tasks"][0]
        assert late["level"] in ("MEDIUM", "HIGH")
        assert late["factors"][0]["code"] == "OVERDUE" and late["key"].startswith("RSK-")
        by_name = {t["name"]: t for t in data["risks"]["tasks"]}
        assert any(f["code"] == "BLOCKED" for f in by_name["Blocked"]["factors"])
        assert any(f["code"] == "UNASSIGNED" for f in by_name["Orphan"]["factors"])

    @pytest.mark.django_db
    def test_workload_compares_remaining_plan_with_calendar_capacity(self, admin_client, workspace, member, board):
        TaskPlan.objects.create(workspace=workspace, issue=board["late"], planned_minutes=600)
        day = today()
        CalendarEntry.objects.create(
            workspace=workspace,
            user=member,
            work_date=day,
            work_mode="REMOTE",
            source="MANUAL",
            planned_start_time="09:00",
            planned_end_time="17:00",
        )
        started = datetime.combine(day, datetime.min.time(), tzinfo=dt_timezone.utc)
        TimeEntry.objects.create(
            workspace=workspace,
            project=board["project"],
            issue=board["late"],
            user=member,
            started_at=started,
            ended_at=started + timedelta(hours=2),
            duration_seconds=2 * 3600,
        )

        row = admin_client.get(insights(workspace, user=member.id)).data["workload"]["people"][0]

        assert row["user"] == member.id and row["open_tasks"] == 2 and row["overdue_tasks"] == 1
        assert row["remaining_seconds"] == 8 * 3600 and row["capacity_seconds"] == 8 * 3600
        assert row["load"] == 1.0 and row["status"] == "BALANCED"

    @pytest.mark.django_db
    def test_filtering_by_person_drops_unassigned_work(self, admin_client, workspace, member, board):
        data = admin_client.get(insights(workspace, user=member.id)).data
        assert {t["name"] for t in data["risks"]["tasks"]} <= {"Late", "Blocked"}
        assert admin_client.get(insights(workspace)).data["workload"]["unassigned_tasks"] == 1

    @pytest.mark.django_db
    def test_scope_follows_the_team_view_rules(
        self, lead_client, member_client, guest_client, outsider_client, workspace, lead, member, board
    ):
        make_team(workspace, "Platform", leads=[lead], members=[member])
        ProjectMember.objects.create(project=board["project"], member=lead, workspace=workspace, role=15)

        data = lead_client.get(insights(workspace)).data

        # A lead only sees work assigned to their team: not the unassigned item, not a colleague's.
        assert {t["name"] for t in data["risks"]["tasks"]} <= {"Late", "Blocked"}
        assert {r["user"] for r in data["workload"]["people"]} == {lead.id, member.id}
        for client in (member_client, guest_client, outsider_client):
            assert client.get(insights(workspace)).status_code == 403

    @pytest.mark.django_db
    def test_a_lead_outside_the_project_sees_none_of_it(self, lead_client, workspace, lead, member, board):
        make_team(workspace, "Platform", leads=[lead], members=[member])
        assert lead_client.get(insights(workspace)).data["risks"]["tasks"] == []

    @pytest.mark.django_db
    def test_range_is_required_and_capped_and_workspaces_are_separate(self, admin_client, workspace, other_workspace):
        assert admin_client.get(url(workspace, "insights/")).status_code == 400
        far = today() + timedelta(days=62)
        assert admin_client.get(url(workspace, f"insights/?from={today()}&to={far}")).status_code == 400
        assert admin_client.get(insights(other_workspace)).status_code == 403
