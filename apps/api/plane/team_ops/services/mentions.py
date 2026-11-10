# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Mentioning people in Hub documents and links: chosen by name from a list, or written as @name in the text."""

from plane.db.models import ProjectMember, User
from plane.team_ops.services.access import calendar_user_ids
from plane.team_ops.services.notifications import notify


def mentioned_in_text(workspace, text):
    """Ids of the colleagues written as @display_name in `text`."""
    text = (text or "").lower()
    if "@" not in text:
        return set()
    users = User.objects.filter(pk__in=calendar_user_ids(workspace)).values_list("id", "display_name")
    return {user_id for user_id, name in users if name and f"@{name.lower()}" in text}


def notify_mentions(workspace, actor, *, chosen, text, before="", what, title, link, project=None):
    """Tell the people chosen, and those newly written as @name (not already in `before`), about `what`.
    When the item belongs to a project only its members are told, so a mention never shows a private item."""
    allowed = set(calendar_user_ids(workspace))
    ids = (set(chosen or ()) & allowed) | (mentioned_in_text(workspace, text) - mentioned_in_text(workspace, before))
    if project is not None:
        members = set(ProjectMember.objects.filter(project=project, is_active=True).values_list("member_id", flat=True))
        ids &= members
    ids.discard(actor.id)
    if not ids:
        return 0
    return notify(workspace, ids, "MENTION", f"{actor.display_name} mentioned you in {what}", title, link, actor=actor)
