# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Doc Hub documents are organized as a tree: a document can be put inside another one."""

import pytest

from plane.team_ops.models import HubDoc
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    lead,
    lead_client,
    make_project,
    member,
    member_client,
    other_workspace,
    outsider,
    url,
    workspace,
)


@pytest.fixture
def project(workspace, admin, member):
    return make_project(workspace, admin, "DT", members=[member])


def h(workspace, path=""):
    return url(workspace, f"hub/{path}")


def make(client, workspace, title, parent=None, **extra):
    payload = {"title": title, "body": f"# {title}", **extra}
    if parent is not None:
        payload["parent"] = str(parent)
    response = client.post(h(workspace, "docs/"), payload, format="json")
    assert response.status_code == 201, response.data
    return response.data


@pytest.mark.contract
class TestDocTree:
    def test_a_document_is_put_inside_another_and_knows_its_path(self, member_client, workspace):
        monitor = make(member_client, workspace, "factory-monitor")
        nginx = make(member_client, workspace, "nginx", monitor["id"])
        tls = make(member_client, workspace, "TLS", nginx["id"])
        assert monitor["parent"] is None and nginx["parent"] == monitor["id"]
        opened = member_client.get(h(workspace, f"docs/{tls['id']}/")).data
        assert [item["title"] for item in opened["path"]] == ["factory-monitor", "nginx"]
        assert opened["body"] == "# TLS"
        listed = {doc["id"]: doc["parent"] for doc in member_client.get(h(workspace, "docs/")).data["results"]}
        assert listed[tls["id"]] == nginx["id"] and listed[monitor["id"]] is None

    def test_a_document_can_be_moved_inside_another_and_out_again(self, member_client, workspace):
        a = make(member_client, workspace, "A")
        b = make(member_client, workspace, "B")
        path = h(workspace, f"docs/{b['id']}/")
        assert member_client.patch(path, {"parent": a["id"]}, format="json").data["parent"] == a["id"]
        assert member_client.patch(path, {"parent": None}, format="json").data["parent"] is None

    def test_no_loops(self, member_client, workspace):
        a = make(member_client, workspace, "A")
        b = make(member_client, workspace, "B", a["id"])
        c = make(member_client, workspace, "C", b["id"])
        own = member_client.patch(h(workspace, f"docs/{a['id']}/"), {"parent": a["id"]}, format="json")
        below = member_client.patch(h(workspace, f"docs/{a['id']}/"), {"parent": c["id"]}, format="json")
        assert own.status_code == 400 and below.status_code == 400

    def test_nesting_has_a_limit(self, member_client, workspace):
        parent = None
        for level in range(8):
            parent = make(member_client, workspace, f"level {level}", parent)["id"]
        too_deep = member_client.post(
            h(workspace, "docs/"), {"title": "one more", "parent": str(parent)}, format="json"
        )
        assert too_deep.status_code == 400

    def test_the_parent_must_be_readable(self, member_client, lead_client, project, workspace):
        private = make(member_client, workspace, "Internal", project=str(project.id))
        response = lead_client.post(h(workspace, "docs/"), {"title": "Sneaky", "parent": private["id"]}, format="json")
        assert response.status_code == 400

    def test_deleting_a_document_moves_what_was_inside_up(self, member_client, workspace):
        top = make(member_client, workspace, "Top")
        middle = make(member_client, workspace, "Middle", top["id"])
        leaf = make(member_client, workspace, "Leaf", middle["id"])
        assert member_client.delete(h(workspace, f"docs/{middle['id']}/")).status_code == 204
        assert HubDoc.objects.get(pk=leaf["id"]).parent_id == top["id"]
        assert member_client.get(h(workspace, f"docs/{leaf['id']}/")).status_code == 200
