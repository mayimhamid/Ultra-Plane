# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Mentioning colleagues in Hub documents and links."""

import pytest

from plane.team_ops.models import OpsNotification
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


def told(user):
    return list(OpsNotification.objects.filter(user=user, kind="MENTION").values_list("title", flat=True))


@pytest.mark.contract
class TestMentions:
    def test_people_chosen_for_a_document_are_told(self, member_client, workspace, member, colleague):
        response = member_client.post(
            url(workspace, "hub/docs/"),
            {"title": "Runbook", "body": "steps", "mentions": [str(colleague.id)]},
            format="json",
        )
        assert response.status_code == 201
        assert told(colleague) == [f"{member.display_name} mentioned you in a document"]

    def test_an_at_name_in_the_text_tells_that_person_once(self, member_client, workspace, colleague):
        doc = member_client.post(
            url(workspace, "hub/docs/"), {"title": "Notes", "body": f"ask @{colleague.display_name}"}, format="json"
        ).data
        assert len(told(colleague)) == 1
        member_client.patch(
            url(workspace, f"hub/docs/{doc['id']}/"),
            {"body": f"ask @{colleague.display_name} again"},
            format="json",
        )
        assert len(told(colleague)) == 1  # already mentioned in the earlier text

    def test_a_project_document_only_tells_project_members(self, member_client, workspace, admin, member, lead):
        project = make_project(workspace, admin, "MN", members=[member])
        member_client.post(
            url(workspace, "hub/docs/"),
            {"title": "Private", "body": "x", "project": str(project.id), "mentions": [str(lead.id)]},
            format="json",
        )
        assert told(lead) == []

    def test_links_tell_the_people_chosen(self, member_client, workspace, colleague):
        member_client.post(
            url(workspace, "hub/links/"),
            {"url": "https://a.test", "title": "Board", "mentions": [str(colleague.id)]},
            format="json",
        )
        assert len(told(colleague)) == 1
