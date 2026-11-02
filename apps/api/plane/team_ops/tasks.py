# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from celery import shared_task

# Module imports
from plane.team_ops.services.admin_access import sync_admin_access
from plane.team_ops.services.push import deliver
from plane.team_ops.services.weekly_plan import extend_weekly_plans
from plane.team_ops.services.workday import freeze_unanswered_timers


@shared_task
def extend_weekly_plans_task():
    """Write every active weekly plan out to the end of its workspace's horizon."""
    return extend_weekly_plans()


@shared_task
def freeze_unanswered_timers_task():
    """Freeze the timers whose "still working?" check-in was not answered, and tell the managers."""
    return freeze_unanswered_timers()


@shared_task
def sync_admin_access_task():
    """Keep every workspace admin on every project of their workspace, so they can see all of it."""
    return sync_admin_access()


@shared_task
def deliver_push_task(notification_ids):
    """Send new notifications to the phones and browsers their owners turned push on for."""
    return deliver(notification_ids)
