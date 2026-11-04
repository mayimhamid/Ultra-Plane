# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Tells people when someone else gives them a task.

Plane records every change of a work item as an activity. This reads the new ones (a work item created with
assignees, or an assignee added) and sends a Team Ops notification, so it also reaches the phone. Core code is
not touched.
"""

from datetime import timedelta

# Django imports
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

# Module imports
from plane.db.models import IssueActivity, IssueAssignee
from plane.team_ops.models import OpsNotification
from plane.team_ops.services.notifications import notify

CURSOR_KEY = "team_ops:assignments:cursor"
# On a cold start (no cursor yet) look this far back.
FIRST_LOOK_BACK = timedelta(minutes=10)


def _assigned(activity):
    """Who `activity` gave the work item to."""
    if activity.field == "assignees":
        return [activity.new_identifier] if activity.new_identifier else []
    return list(IssueAssignee.objects.filter(issue_id=activity.issue_id).values_list("assignee_id", flat=True))


def notify_new_assignments(now=None):
    """Send "you have a new task" for activities since the last run; returns how many people were told."""
    now = now or timezone.now()
    since = cache.get(CURSOR_KEY) or now - FIRST_LOOK_BACK
    activities = (
        IssueActivity.objects.filter(created_at__gt=since, created_at__lte=now, issue__isnull=False)
        .filter(
            Q(field="assignees", verb="updated", new_identifier__isnull=False) | Q(verb="created", field__isnull=True)
        )
        .select_related("issue", "issue__project", "workspace", "actor")
        .order_by("created_at")
    )
    told = 0
    for activity in activities:
        issue = activity.issue
        key = f"{issue.project.identifier}-{issue.sequence_id}"
        link = f"browse/{key}"
        people = [user for user in _assigned(activity) if user and user != activity.actor_id]
        # The same assignment is never told twice, even when the cursor was lost.
        already = set(
            OpsNotification.objects.filter(
                kind="ASSIGN", link=link, user_id__in=people, created_at__gte=activity.created_at
            ).values_list("user_id", flat=True)
        )
        people = [user for user in people if user not in already]
        if not people:
            continue
        by = activity.actor.display_name if activity.actor else "Someone"
        told += notify(
            activity.workspace,
            people,
            "ASSIGN",
            f"{by} gave you {key}",
            f"{issue.name} · {issue.project.name}",
            link=link,
            actor=activity.actor,
        )
    cache.set(CURSOR_KEY, now, timeout=None)
    return told
