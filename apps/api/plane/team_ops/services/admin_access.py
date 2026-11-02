# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace admins see every project of their workspace.

Plane decides who may open a project from the project's own member list, so a workspace admin who is not on a
project (above all a private one) cannot see it or its work items. This job keeps every active workspace admin
on every project of their workspace as a project admin. It runs by itself every few minutes and can be run by
hand (`manage.py team_ops_sync_admin_access`); it changes nothing when everyone is already in place.
"""

# Module imports
from plane.db.models import Project, ProjectMember, WorkspaceMember
from plane.db.models.project import ROLE


def grant_project_admin(project, user_id):
    """Make `user_id` an active admin of the project. Returns True if anything changed."""
    member = ProjectMember.objects.filter(project=project, member_id=user_id).first()
    if member is None:
        ProjectMember.objects.create(
            project=project, member_id=user_id, workspace_id=project.workspace_id, role=ROLE.ADMIN.value
        )
        return True
    if member.role == ROLE.ADMIN.value and member.is_active:
        return False
    member.role = ROLE.ADMIN.value
    member.is_active = True
    member.save(update_fields=["role", "is_active", "updated_at"])
    return True


def sync_admin_access(workspace=None):
    """Put every active workspace admin on every project of their workspace. Returns how many rows changed."""
    admins = WorkspaceMember.objects.filter(role=ROLE.ADMIN.value, is_active=True)
    projects = Project.objects.all()
    if workspace is not None:
        admins = admins.filter(workspace=workspace)
        projects = projects.filter(workspace=workspace)
    admin_ids = {}
    for workspace_id, member_id in admins.values_list("workspace_id", "member_id"):
        admin_ids.setdefault(workspace_id, []).append(member_id)
    changed = 0
    for project in projects.iterator():
        for member_id in admin_ids.get(project.workspace_id, ()):
            if grant_project_admin(project, member_id):
                changed += 1
    return changed
