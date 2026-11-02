# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Notifications of Team Ops. They live in their own table so the core inbox is never touched."""

# Django imports
from django.db import transaction

# Module imports
from plane.db.models import WorkspaceMember
from plane.team_ops.models import OpsNotification, OpsTeamMember
from plane.team_ops.services import push

ADMIN_ROLE = 20


def notify(workspace, users, kind, title, body="", link="", actor=None):
    """One notification for each person in `users` (ids or users), never for the actor."""
    ids = {getattr(user, "id", user) for user in users}
    if actor is not None:
        ids.discard(actor.id)
    created = OpsNotification.objects.bulk_create(
        [
            OpsNotification(
                workspace=workspace,
                user_id=user_id,
                actor=actor,
                kind=kind,
                title=title[:200],
                body=body,
                link=link[:300],
            )
            for user_id in ids
        ]
    )
    _push_later(created)
    return len(ids)


def _push_later(created):
    """Hand the new notifications to the push worker once they are saved; a failure here never blocks the caller."""
    if not created or not push.has_subscribers(row.user_id for row in created):
        return
    from plane.team_ops.tasks import deliver_push_task

    notification_ids = [str(row.id) for row in created]

    def enqueue():
        try:
            deliver_push_task.delay(notification_ids)
        except Exception:  # the broker is down: the notification is still in the app
            pass

    transaction.on_commit(enqueue)


def managers_of(workspace, user):
    """The people who are told when something is wrong with `user`'s work: admins and the leads of their teams."""
    admins = set(
        WorkspaceMember.objects.filter(workspace=workspace, role=ADMIN_ROLE, is_active=True).values_list(
            "member_id", flat=True
        )
    )
    team_ids = OpsTeamMember.objects.filter(user=user, team__workspace=workspace).values("team_id")
    leads = set(
        OpsTeamMember.objects.filter(team_id__in=team_ids, role=OpsTeamMember.Role.LEAD).values_list(
            "user_id", flat=True
        )
    )
    return (admins | leads) - {user.id}
