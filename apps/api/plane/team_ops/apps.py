# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig
from django.conf import settings


class TeamOpsConfig(AppConfig):
    name = "plane.team_ops"
    label = "team_ops"
    verbose_name = "Team Ops"

    def ready(self):
        if not settings.TEAM_OPS_ENABLED:
            return
        # Registered here, not in plane/celery.py, so the feature stays out of Core files.
        from celery.schedules import crontab

        from plane.celery import app

        app.conf.beat_schedule["team-ops-extend-calendar-weekly-plans"] = {
            "task": "plane.team_ops.tasks.extend_weekly_plans_task",
            "schedule": crontab(hour=0, minute=30),  # UTC 00:30
        }
        # Every minute, so the "still working?" reminder goes out when the check-in falls due.
        app.conf.beat_schedule["team-ops-freeze-unanswered-timers"] = {
            "task": "plane.team_ops.tasks.freeze_unanswered_timers_task",
            "schedule": crontab(minute="*"),
        }
        app.conf.beat_schedule["team-ops-notify-new-assignments"] = {
            "task": "plane.team_ops.tasks.notify_new_assignments_task",
            "schedule": crontab(minute="*"),
        }
        # Every minute: the task itself only acts inside the 20:00 and 23:30 windows and tells each person once.
        app.conf.beat_schedule["team-ops-remind-missing-day-reports"] = {
            "task": "plane.team_ops.tasks.remind_missing_day_reports_task",
            "schedule": crontab(minute="*"),
        }
        app.conf.beat_schedule["team-ops-sync-admin-access"] = {
            "task": "plane.team_ops.tasks.sync_admin_access_task",
            "schedule": crontab(minute="*/5"),
        }
