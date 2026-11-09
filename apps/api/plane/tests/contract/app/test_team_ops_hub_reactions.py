# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Reactions on Hub messages: an emoji is put on and taken off by the same call."""

import pytest

from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
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


def say(client, workspace, channel, body="hello"):
    response = client.post(url(workspace, f"hub/channels/{channel}/messages/"), {"body": body}, format="json")
    assert response.status_code == 201, response.data
    return response.data["id"]


def react(client, workspace, message, emoji):
    return client.post(url(workspace, f"hub/messages/{message}/reactions/"), {"emoji": emoji}, format="json")


@pytest.mark.contract
class TestHubReactions:
    def test_reacting_twice_takes_the_reaction_off(self, member_client, workspace):
        message = say(member_client, workspace, general(member_client, workspace))
        first = react(member_client, workspace, message, "👍")
        assert first.status_code == 200
        assert first.data["reactions"] == [
            {"emoji": "👍", "count": 1, "mine": True, "people": [first.data["reactions"][0]["people"][0]]}
        ]
        assert react(member_client, workspace, message, "👍").data["reactions"] == []

    def test_reactions_of_two_people_are_counted_and_seen_by_both(self, member_client, lead_client, workspace):
        channel = general(member_client, workspace)
        message = say(member_client, workspace, channel)
        react(member_client, workspace, message, "❤️")
        reaction = react(lead_client, workspace, message, "❤️").data["reactions"][0]
        assert reaction["count"] == 2 and reaction["mine"] is True
        listed = member_client.get(url(workspace, f"hub/channels/{channel}/messages/")).data["results"]
        assert next(m for m in listed if m["id"] == message)["reactions"][0]["count"] == 2

    def test_a_reaction_is_an_emoji_not_text(self, member_client, workspace):
        message = say(member_client, workspace, general(member_client, workspace))
        assert react(member_client, workspace, message, "ok").status_code == 400
        assert react(member_client, workspace, message, "").status_code == 400

    def test_a_reaction_shows_up_when_polling_for_changes(self, member_client, lead_client, workspace):
        channel = general(member_client, workspace)
        message = say(member_client, workspace, channel)
        since = member_client.get(url(workspace, f"hub/channels/{channel}/messages/")).data["server_time"]
        react(lead_client, workspace, message, "🙏")
        changed = member_client.get(url(workspace, f"hub/channels/{channel}/messages/"), {"since": since}).data
        assert [m["id"] for m in changed["results"]] == [message]
