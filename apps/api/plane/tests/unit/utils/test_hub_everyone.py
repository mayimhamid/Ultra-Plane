# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""`@everyone` in a Hub message tags everyone in the channel, but only when it stands on its own."""

import pytest

from plane.team_ops.services.hub import tags_everyone

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "body",
    [
        "@everyone",
        "@everyone please read this",
        "Hello @everyone!",
        "Hello @everyone, meeting at 10",
        "(@everyone)",
        "line one\n@everyone\nline three",
        "@Everyone",
        "@EVERYONE",
        "Done. @everyone.",
    ],
)
def test_it_tags_everyone(body):
    assert tags_everyone(body)


@pytest.mark.parametrize(
    "body",
    [
        "",
        None,
        "everyone",
        "hello everyone",
        "mail@everyone.com",
        "@everyone_else",
        "@everyoneelse",
        "@@everyone",
        "x@everyone",
        "@every one",
    ],
)
def test_it_does_not_tag_everyone(body):
    assert not tags_everyone(body)
