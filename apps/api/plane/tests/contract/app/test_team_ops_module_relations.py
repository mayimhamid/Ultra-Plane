# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""The relation graph of a module: its work items and the relations among them."""

import pytest

from plane.db.models import Issue, IssueRelation, State
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


@pytest.fixture
def project(workspace, admin, member):
    project = make_project(workspace, admin, "MR", members=[member])
    State.objects.create(name="Todo", group="unstarted", default=True, project=project, workspace=workspace)
    return project


def make(workspace, project, name):
    return Issue.objects.create(name=name, project=project, workspace=workspace)


def relate(workspace, project, issue, related, kind):
    return IssueRelation.objects.create(
        issue=issue, related_issue=related, relation_type=kind, project=project, workspace=workspace
    )


def graph(workspace, project, module):
    return url(workspace, f"projects/{project.id}/modules/{module.id}/relations/")


@pytest.mark.contract
class TestModuleRelations:
    def test_lists_items_and_relations_between_them(self, member_client, workspace, project):
        a, b, c, outside = (make(workspace, project, name) for name in ("A", "B", "C", "Outside"))
        module = make_module(workspace, project, issues=[a, b, c])
        # `b` is blocked by `a`: the edge runs a -> b
        relate(workspace, project, b, a, "blocked_by")
        relate(workspace, project, b, c, "relates_to")
        relate(workspace, project, c, outside, "duplicate")

        data = member_client.get(graph(workspace, project, module)).data

        assert [item["name"] for item in data["issues"]] == ["A", "B", "C"]
        edges = {(row["from"], row["to"], row["type"]) for row in data["relations"]}
        assert edges == {(a.id, b.id, "blocking"), (b.id, c.id, "relates_to")}

    def test_a_sub_work_item_names_its_parent_when_both_are_in_the_module(self, member_client, workspace, project):
        parent, child, other = (make(workspace, project, name) for name in ("P", "C", "O"))
        child.parent = parent
        child.save()
        other.parent = make(workspace, project, "Elsewhere")
        other.save()
        module = make_module(workspace, project, issues=[parent, child, other])

        rows = {row["name"]: row["parent"] for row in member_client.get(graph(workspace, project, module)).data["issues"]}

        assert rows == {"P": None, "C": parent.id, "O": None}

    def test_a_module_of_another_project_is_not_found(self, member_client, workspace, project, admin):
        other = make_project(workspace, admin, "OT")
        module = make_module(workspace, other)
        assert member_client.get(graph(workspace, project, module)).status_code == 404

    def test_outsiders_are_refused(self, outsider_client, workspace, project):
        module = make_module(workspace, project)
        assert outsider_client.get(graph(workspace, project, module)).status_code in (401, 403)
