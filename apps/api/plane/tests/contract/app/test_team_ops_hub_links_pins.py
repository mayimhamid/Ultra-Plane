# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Hub links, and pinned messages numbered by when they were pinned."""

import pytest

from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    guest_client,
    lead,
    lead_client,
    member,
    member_client,
    other_workspace,
    outsider,
    url,
    workspace,
)


def general(client, workspace):
    rows = client.get(url(workspace, "hub/channels/")).data["results"]
    return next(row["id"] for row in rows if row["kind"] == "GENERAL")


def say(client, workspace, channel, body):
    response = client.post(url(workspace, f"hub/channels/{channel}/messages/"), {"body": body}, format="json")
    assert response.status_code == 201, response.data
    return response.data["id"]


@pytest.mark.contract
class TestHubPins:
    def test_pins_are_listed_in_the_order_they_were_pinned(self, member_client, workspace):
        channel = general(member_client, workspace)
        first, second, third = (say(member_client, workspace, channel, text) for text in ("a", "b", "c"))
        for message in (third, first, second):
            assert member_client.post(url(workspace, f"hub/messages/{message}/pin/")).status_code == 200
        pins = member_client.get(url(workspace, f"hub/channels/{channel}/pins/")).data["results"]
        assert [p["id"] for p in pins] == [third, first, second]
        assert all(p["pinned_at"] for p in pins)

    def test_unpinning_and_deleting_remove_the_pin(self, member_client, workspace):
        channel = general(member_client, workspace)
        one, two = say(member_client, workspace, channel, "a"), say(member_client, workspace, channel, "b")
        member_client.post(url(workspace, f"hub/messages/{one}/pin/"))
        member_client.post(url(workspace, f"hub/messages/{two}/pin/"))
        assert member_client.delete(url(workspace, f"hub/messages/{one}/pin/")).data["pinned_at"] is None
        member_client.delete(url(workspace, f"hub/messages/{two}/"))
        assert member_client.get(url(workspace, f"hub/channels/{channel}/pins/")).data["results"] == []

    def test_a_pin_shows_up_when_polling(self, member_client, lead_client, workspace):
        channel = general(member_client, workspace)
        message = say(member_client, workspace, channel, "a")
        since = member_client.get(url(workspace, f"hub/channels/{channel}/messages/")).data["server_time"]
        lead_client.post(url(workspace, f"hub/messages/{message}/pin/"))
        changed = member_client.get(url(workspace, f"hub/channels/{channel}/messages/"), {"since": since}).data
        assert [m["id"] for m in changed["results"]] == [message] and changed["results"][0]["pinned_at"]


@pytest.mark.contract
class TestHubLinks:
    def test_a_link_is_saved_and_everyone_sees_it(self, member_client, lead_client, workspace):
        response = member_client.post(
            url(workspace, "hub/links/"),
            {"title": "Grafana", "url": "grafana.example.com/d/1", "group": "Monitoring"},
            format="json",
        )
        assert response.status_code == 201
        assert response.data["url"] == "https://grafana.example.com/d/1"
        titles = [link["title"] for link in lead_client.get(url(workspace, "hub/links/")).data["results"]]
        assert titles == ["Grafana"]

    def test_only_web_addresses_are_accepted(self, member_client, workspace):
        for bad in ("javascript:alert(1)", "ftp://x.test/file", ""):
            response = member_client.post(url(workspace, "hub/links/"), {"title": "x", "url": bad}, format="json")
            assert response.status_code == 400, bad

    def test_the_title_defaults_to_the_address(self, member_client, workspace):
        response = member_client.post(url(workspace, "hub/links/"), {"url": "https://a.test"}, format="json")
        assert response.data["title"] == "https://a.test"

    def test_only_the_author_or_an_admin_changes_a_link(self, member_client, lead_client, admin_client, workspace):
        link = member_client.post(url(workspace, "hub/links/"), {"url": "https://a.test"}, format="json").data["id"]
        path = url(workspace, f"hub/links/{link}/")
        assert lead_client.patch(path, {"title": "x"}, format="json").status_code == 403
        assert member_client.patch(path, {"title": "Mine"}, format="json").data["title"] == "Mine"
        assert admin_client.delete(path).status_code == 204

    def test_guests_have_no_links(self, guest_client, workspace):
        assert guest_client.get(url(workspace, "hub/links/")).status_code == 403
