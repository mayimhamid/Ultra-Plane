# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Workspace admins are kept on every project of their workspace, so they see all of it."""

import pytest

from plane.db.models import ProjectMember, WorkspaceMember
from plane.team_ops.services.admin_access import sync_admin_access
from plane.tests.contract.app.team_ops_support import (
    ADMIN,
    GUEST,
    MEMBER,
    _no_broker,
    admin,
    colleague,
    guest,
    join,
    lead,
    make_project,
    make_user,
    make_workspace,
    member,
    other_workspace,
    outsider,
    workspace,
)


def role_of(project, user):
    row = ProjectMember.objects.filter(project=project, member=user).first()
    return None if row is None else (row.role, row.is_active)


@pytest.fixture
def boss(workspace):
    """A second workspace admin, who is on no project."""
    user = make_user("boss")
    join(workspace, user, ADMIN)
    return user


@pytest.mark.contract
class TestAdminAccess:
    def test_an_admin_who_is_on_no_project_is_added_as_project_admin(self, workspace, admin, member, boss):
        project = make_project(workspace, member, "AA")

        sync_admin_access()

        assert role_of(project, boss) == (ADMIN, True)

    def test_an_admin_who_is_only_a_guest_of_a_project_is_raised(self, workspace, admin, boss):
        project = make_project(workspace, admin, "AB")
        ProjectMember.objects.create(project=project, member=boss, workspace=workspace, role=GUEST)

        sync_admin_access()

        assert role_of(project, boss) == (ADMIN, True)

    def test_an_admin_whose_project_row_is_inactive_is_reactivated(self, workspace, admin, boss):
        project = make_project(workspace, admin, "AC")
        ProjectMember.objects.create(project=project, member=boss, workspace=workspace, role=MEMBER, is_active=False)

        sync_admin_access()

        assert role_of(project, boss) == (ADMIN, True)

    def test_regular_members_and_guests_are_left_alone(self, workspace, admin, member, guest):
        project = make_project(workspace, admin, "AD")

        sync_admin_access()

        assert role_of(project, member) is None
        assert role_of(project, guest) is None

    def test_a_second_run_changes_nothing(self, workspace, admin, member, boss):
        make_project(workspace, member, "AE")

        assert sync_admin_access() > 0
        assert sync_admin_access() == 0

    def test_an_admin_who_left_the_workspace_is_not_added(self, workspace, admin, member, boss):
        project = make_project(workspace, member, "AF")
        WorkspaceMember.objects.filter(workspace=workspace, member=boss).update(is_active=False)

        sync_admin_access()

        assert role_of(project, boss) is None

    def test_other_workspaces_are_not_touched(self, workspace, other_workspace, admin, boss):
        owner = WorkspaceMember.objects.get(workspace=other_workspace, role=ADMIN).member
        theirs = make_project(other_workspace, owner, "AG")

        sync_admin_access()

        assert role_of(theirs, boss) is None
        assert role_of(theirs, admin) is None

    def test_one_workspace_can_be_synced_alone(self, workspace, other_workspace, admin, member, boss):
        mine = make_project(workspace, member, "AH")
        owner = WorkspaceMember.objects.get(workspace=other_workspace, role=ADMIN).member
        theirs = make_project(other_workspace, member, "AI")
        ProjectMember.objects.filter(project=theirs, member=member).delete()

        sync_admin_access(workspace)

        assert role_of(mine, boss) == (ADMIN, True)
        assert role_of(theirs, owner) is None
