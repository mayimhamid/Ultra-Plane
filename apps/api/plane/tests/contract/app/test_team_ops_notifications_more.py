# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Notifications: a task given by someone else, the check-in reminder, and leave requests."""

from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone

from plane.db.models import Issue, IssueActivity, IssueAssignee
from plane.team_ops.models import ActiveTimer, OpsNotification
from plane.team_ops.services.assignments import CURSOR_KEY, notify_new_assignments
from plane.team_ops.services.workday import remind_due_check_ins
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    lead,
    lead_client,
    guest,
    guest_client,
    outsider,
    outsider_client,
    other_workspace,
    make_client,
    make_team,
    make_project,
    member,
    member_client,
    next_monday,
    url,
    workspace,
)


@pytest.fixture
def project(workspace, admin, member):
    return make_project(workspace, admin, "NT", members=[member])


@pytest.fixture
def issue(workspace, project):
    return Issue.objects.create(name="Wire the panel", project=project, workspace=workspace)


@pytest.fixture(autouse=True)
def fresh_cursor():
    cache.delete(CURSOR_KEY)
    yield
    cache.delete(CURSOR_KEY)


def added(issue, actor, assignee):
    return IssueActivity.objects.create(
        issue=issue,
        project=issue.project,
        workspace=issue.workspace,
        actor=actor,
        verb="updated",
        field="assignees",
        new_value=assignee.display_name,
        new_identifier=assignee.id,
    )


@pytest.mark.contract
class TestAssignedByOthers:
    def test_the_assignee_is_told_once(self, workspace, admin, member, issue):
        added(issue, admin, member)
        assert notify_new_assignments() == 1
        row = OpsNotification.objects.get(kind="ASSIGN")
        assert row.user_id == member.id and row.actor_id == admin.id
        assert row.link == f"browse/NT-{issue.sequence_id}" and "Wire the panel" in row.body
        # Running again, even with the cursor lost, tells nobody again.
        assert notify_new_assignments() == 0
        cache.delete(CURSOR_KEY)
        assert notify_new_assignments() == 0

    def test_assigning_yourself_tells_nobody(self, workspace, member, issue):
        added(issue, member, member)
        assert notify_new_assignments() == 0

    def test_a_new_work_item_tells_its_assignees(self, workspace, admin, member, issue):
        IssueAssignee.objects.create(issue=issue, assignee=member, project=issue.project, workspace=workspace)
        IssueActivity.objects.create(
            issue=issue, project=issue.project, workspace=workspace, actor=admin, verb="created"
        )
        assert notify_new_assignments() == 1
        assert OpsNotification.objects.get(kind="ASSIGN").user_id == member.id


@pytest.mark.contract
class TestCheckInReminder:
    def test_a_due_check_in_is_asked_once(self, workspace, member, issue):
        long_ago = timezone.now() - timedelta(minutes=61)
        ActiveTimer.objects.create(
            workspace=workspace, user=member, issue=issue, started_at=long_ago, last_confirmed_at=long_ago
        )
        assert remind_due_check_ins() == 1
        assert remind_due_check_ins() == 0
        row = OpsNotification.objects.get(kind="CHECKIN")
        assert row.user_id == member.id and row.link == "team-ops/workday"

    def test_not_before_it_is_due_and_never_in_a_meeting(self, workspace, member, admin, issue):
        now = timezone.now()
        ActiveTimer.objects.create(workspace=workspace, user=member, issue=issue, started_at=now, last_confirmed_at=now)
        long_ago = now - timedelta(hours=3)
        ActiveTimer.objects.create(
            workspace=workspace, user=admin, started_at=long_ago, last_confirmed_at=long_ago, activity="MEETING"
        )
        assert remind_due_check_ins() == 0


@pytest.mark.contract
class TestLeaveNotifications:
    def test_managers_hear_of_a_request_and_the_person_of_the_decision(
        self, admin_client, member_client, workspace, admin, member
    ):
        monday = next_monday()
        body = {"start_date": str(monday), "end_date": str(monday), "leave_type": "ANNUAL", "note": "Family"}
        leave = member_client.post(url(workspace, "leave-requests/"), body, format="json").data
        asked = OpsNotification.objects.get(kind="LEAVE", user=admin)
        assert member.display_name in asked.title and "Family" in asked.body
        admin_client.post(url(workspace, f"leave-requests/{leave['id']}/"), {"action": "approve"}, format="json")
        told = OpsNotification.objects.get(kind="LEAVE", user=member)
        assert "approved" in told.title and told.link == "team-ops/leave"
