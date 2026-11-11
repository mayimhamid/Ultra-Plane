# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Team Ops insights checked against Plane's own behaviour (its relation endpoint, its soft deletes, real
timezones) and against the scope rules, rather than against the scoring code's own assumptions."""

from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock
from zoneinfo import ZoneInfo

import pytest

from plane.db.models import Issue, IssueActivity, IssueAssignee, IssueRelation, State
from plane.team_ops.models import CalendarSettings, TaskPlan, TimeEntry
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


def make_issue(project, name, state, assignees=(), **fields):
    issue = Issue.objects.create(project=project, name=name, state=state, **fields)
    for user in assignees:
        IssueAssignee.objects.create(issue=issue, assignee=user, project=project)
    return issue


def state_of(project, group="started"):
    return State.objects.create(project=project, name=f"{group}-{State.objects.count()}", group=group)


def insights(workspace, **filters):
    start = today()
    query = "&".join(f"{k}={v}" for k, v in {"from": start, "to": start + timedelta(days=6), **filters}.items())
    return url(workspace, f"insights/?{query}")


def risk_codes(data, name):
    task = next((t for t in data["risks"]["tasks"] if t["name"] == name), None)
    return None if task is None else [f["code"] for f in task["factors"]]


def age(issue_ids, days):
    Issue.all_objects.filter(pk__in=issue_ids).update(created_at=datetime.now(dt_timezone.utc) - timedelta(days=days))


@pytest.mark.contract
class TestBlockedAndStalled:
    @pytest.mark.django_db
    @pytest.mark.parametrize("relation_type", ["blocked_by", "blocking"])
    def test_blocked_follows_relations_made_through_the_real_endpoint(
        self, admin_client, workspace, admin, member, relation_type
    ):
        project = make_project(workspace, admin, "REL", members=[member])
        doing = state_of(project)
        waiting = make_issue(project, "Waiting", doing, [member])
        other = make_issue(project, "Other", doing, [member])
        # "A is blocked by B" and "B is blocking A" are one fact, stored one way by Plane.
        subject, body = (waiting, [str(other.id)]) if relation_type == "blocked_by" else (other, [str(waiting.id)])
        with (
            mock.patch("plane.app.views.issue.relation.issue_activity"),
            mock.patch("plane.app.views.issue.relation.base_host", return_value="http://testserver"),
        ):
            response = admin_client.post(
                f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{subject.id}/issue-relation/",
                {"relation_type": relation_type, "issues": body},
                format="json",
            )
        assert response.status_code == 201

        data = admin_client.get(insights(workspace)).data

        blocked, free = ("Waiting", "Other") if relation_type == "blocked_by" else ("Other", "Waiting")
        assert "BLOCKED" in risk_codes(data, blocked)
        assert "BLOCKED" not in (risk_codes(data, free) or [])

    @pytest.mark.django_db
    def test_a_finished_or_deleted_blocker_no_longer_blocks(self, admin_client, workspace, admin, member):
        project = make_project(workspace, admin, "BLK", members=[member])
        doing, done = state_of(project), state_of(project, "completed")
        waiting = make_issue(project, "Waiting", doing, [member])
        gone = make_issue(project, "Gone", doing, [member])
        finished = make_issue(project, "Finished", doing, [member])
        for blocker in (gone, finished):
            IssueRelation.objects.create(
                issue=waiting, related_issue=blocker, relation_type="blocked_by", project=project
            )
        assert "BLOCKED" in risk_codes(admin_client.get(insights(workspace)).data, "Waiting")

        Issue.all_objects.filter(pk=finished.pk).update(state=done)
        Issue.all_objects.filter(pk=gone.pk).update(deleted_at=datetime.now(dt_timezone.utc))

        assert "BLOCKED" not in (risk_codes(admin_client.get(insights(workspace)).data, "Waiting") or [])

    @pytest.mark.django_db
    def test_stalled_comes_from_recorded_events_not_from_updated_at(self, admin_client, workspace, admin, member):
        project = make_project(workspace, admin, "STL", members=[member])
        doing = state_of(project)
        far = today() + timedelta(days=30)
        quiet = make_issue(project, "Quiet", doing, [member], target_date=far)
        busy = make_issue(project, "Busy", doing, [member], target_date=far)
        age([quiet.pk, busy.pk], 12)
        # Saving an issue moves `updated_at`; that must not count as somebody working on it.
        Issue.all_objects.filter(pk=quiet.pk).update(updated_at=datetime.now(dt_timezone.utc))
        IssueActivity.objects.create(issue=busy, project=project, workspace=workspace, verb="updated", field="state")

        data = admin_client.get(insights(workspace)).data

        assert "STALLED" in risk_codes(data, "Quiet")
        assert "STALLED" not in (risk_codes(data, "Busy") or [])

    @pytest.mark.django_db
    def test_logged_time_also_counts_as_activity(self, admin_client, workspace, admin, member):
        project = make_project(workspace, admin, "TIM", members=[member])
        issue = make_issue(project, "Timed", state_of(project), [member], target_date=today() + timedelta(days=30))
        age([issue.pk], 12)
        assert "STALLED" in risk_codes(admin_client.get(insights(workspace)).data, "Timed")

        end = datetime.now(dt_timezone.utc) - timedelta(days=1)
        TimeEntry.objects.create(
            workspace=workspace,
            project=project,
            issue=issue,
            user=member,
            started_at=end - timedelta(hours=1),
            ended_at=end,
            duration_seconds=3600,
        )

        assert "STALLED" not in (risk_codes(admin_client.get(insights(workspace)).data, "Timed") or [])

    @pytest.mark.django_db
    def test_work_that_has_not_started_is_never_stalled(self, admin_client, workspace, admin, member):
        project = make_project(workspace, admin, "NST", members=[member])
        issue = make_issue(project, "Waiting", state_of(project, "unstarted"), [member])
        age([issue.pk], 40)

        assert "STALLED" not in (risk_codes(admin_client.get(insights(workspace)).data, "Waiting") or [])


@pytest.mark.contract
class TestDatesAndEstimates:
    @pytest.mark.django_db
    def test_over_estimate_uses_the_planned_minutes_and_logged_time_of_the_item(
        self, admin_client, workspace, admin, member
    ):
        project = make_project(workspace, admin, "EST", members=[member])
        issue = make_issue(
            project, "Slow", state_of(project, "unstarted"), [member], target_date=today() + timedelta(days=30)
        )
        TaskPlan.objects.create(workspace=workspace, issue=issue, planned_minutes=60)
        end = datetime.now(dt_timezone.utc)
        TimeEntry.objects.create(
            workspace=workspace,
            project=project,
            issue=issue,
            user=member,
            started_at=end - timedelta(minutes=90),
            ended_at=end,
            duration_seconds=90 * 60,
        )

        task = next(t for t in admin_client.get(insights(workspace)).data["risks"]["tasks"] if t["name"] == "Slow")

        factor = next(f for f in task["factors"] if f["code"] == "OVER_ESTIMATE")
        assert factor["points"] == 20 and "150%" in factor["detail"]

    @pytest.mark.django_db
    def test_due_dates_are_judged_on_the_viewers_calendar_day(self, admin_client, workspace, admin, member):
        project = make_project(workspace, admin, "TZ", members=[member])
        # The date it already is in the westmost zone (UTC-12) is one or two days behind the eastmost (UTC+14).
        westmost_today = datetime.now(ZoneInfo("Etc/GMT+12")).date()
        issue = make_issue(project, "Edge", state_of(project), [member], target_date=westmost_today)
        IssueActivity.objects.create(issue=issue, project=project, workspace=workspace, verb="updated", field="state")

        admin.user_timezone = "Etc/GMT+12"
        admin.save()
        assert risk_codes(admin_client.get(insights(workspace)).data, "Edge") == ["DUE_SOON"]

        admin.user_timezone = "Pacific/Kiritimati"
        admin.save()
        assert risk_codes(admin_client.get(insights(workspace)).data, "Edge")[0] == "OVERDUE"

    @pytest.mark.django_db
    def test_finished_work_is_never_overdue(self, admin_client, workspace, admin, member):
        project = make_project(workspace, admin, "FIN", members=[member])
        make_issue(project, "Done", state_of(project, "completed"), [member], target_date=today() - timedelta(days=9))
        make_issue(project, "Dropped", state_of(project, "cancelled"), [member], target_date=today() - timedelta(days=9))

        data = admin_client.get(insights(workspace)).data

        assert data["risks"]["tasks"] == [] and data["risks"]["open_tasks"] == 0


@pytest.mark.contract
class TestBoundaries:
    @pytest.mark.django_db
    def test_a_lead_never_receives_other_teams_work_or_their_ids(
        self, lead_client, workspace, admin, lead, member, colleague
    ):
        team_mate, stranger = member, colleague
        make_team(workspace, "Platform", leads=[lead], members=[team_mate])
        make_team(workspace, "Other", members=[stranger])
        project = make_project(workspace, admin, "SEC", members=[lead, team_mate, stranger])
        doing = state_of(project)
        late = today() - timedelta(days=5)
        make_issue(project, "Mine", doing, [team_mate], target_date=late)
        make_issue(project, "Shared", doing, [team_mate, stranger], target_date=late)
        make_issue(project, "Theirs", doing, [stranger], target_date=late)
        make_issue(project, "Nobody", doing, [], target_date=late)

        data = lead_client.get(insights(workspace)).data

        assert {t["name"] for t in data["risks"]["tasks"]} == {"Mine", "Shared"}
        for task in data["risks"]["tasks"]:
            assert stranger.id not in task["assignees"]
        assert {r["user"] for r in data["workload"]["people"]} == {lead.id, team_mate.id}
        assert data["workload"]["unassigned_tasks"] == 0

    @pytest.mark.django_db
    def test_a_viewer_only_gets_tasks_of_projects_they_belong_to(
        self, member_client, workspace, admin, member, colleague
    ):
        CalendarSettings.objects.update_or_create(workspace=workspace, defaults={"team_view_access": "ALL_MEMBERS"})
        mine = make_project(workspace, admin, "OWN", members=[member])
        hidden = make_project(workspace, admin, "HID", members=[colleague])
        late = today() - timedelta(days=5)
        make_issue(mine, "Visible", state_of(mine), [member], target_date=late)
        make_issue(hidden, "Hidden", state_of(hidden), [colleague], target_date=late)

        data = member_client.get(insights(workspace)).data

        assert [t["name"] for t in data["risks"]["tasks"]] == ["Visible"]
        assert data["risks"]["open_tasks"] == 1

    @pytest.mark.django_db
    def test_another_workspaces_work_is_never_included(self, admin_client, workspace, other_workspace):
        foreign_owner = other_workspace.owner
        project = make_project(other_workspace, foreign_owner, "FOR")
        make_issue(project, "Foreign", state_of(project), [foreign_owner], target_date=today() - timedelta(days=9))

        data = admin_client.get(insights(workspace)).data

        assert data["risks"]["tasks"] == [] and data["risks"]["open_tasks"] == 0

    @pytest.mark.django_db
    def test_project_filter_narrows_work_and_rejects_bad_ids(self, admin_client, workspace, admin, member):
        first = make_project(workspace, admin, "ONE", members=[member])
        second = make_project(workspace, admin, "TWO", members=[member])
        late = today() - timedelta(days=5)
        make_issue(first, "In one", state_of(first), [member], target_date=late)
        make_issue(second, "In two", state_of(second), [member], target_date=late)

        data = admin_client.get(insights(workspace, project=first.id)).data

        assert [t["name"] for t in data["risks"]["tasks"]] == ["In one"]
        assert admin_client.get(insights(workspace, project="not-a-uuid")).status_code == 400

    @pytest.mark.django_db
    def test_guests_and_non_members_get_nothing(self, guest_client, outsider_client, workspace, admin, member):
        project = make_project(workspace, admin, "NOP", members=[member])
        make_issue(project, "Late", state_of(project), [member], target_date=today() - timedelta(days=5))

        assert guest_client.get(insights(workspace)).status_code == 403
        assert outsider_client.get(insights(workspace)).status_code == 403
