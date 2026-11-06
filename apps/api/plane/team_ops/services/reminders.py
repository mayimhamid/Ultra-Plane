# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Evening reminders for people who have not logged any task today.

Two reminders go out on the team's clock: at 20:00 a plain one, and at 23:30 a last call (half an hour left).
Each goes only to a person who is expected to work that day (a working weekday, no holiday, no leave or day
off) and whose Day Report for the day still has no row. A reminder is sent once per person per day.

The clock is `TEAM_OPS_REMINDER_TIMEZONE` (default `Asia/Tehran`), not each person's profile timezone: the
profiles of this team are mostly left at UTC, which would fire the reminders at 23:30 and 03:00 local time.
"""

# Python imports
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import WorkspaceMember
from plane.team_ops.models import (
    CalendarEntry,
    CalendarHoliday,
    CalendarSettings,
    DayReportEntry,
    OpsNotification,
    default_working_weekdays,
)
from plane.team_ops.services.notifications import notify

DEFAULT_ZONE = "Asia/Tehran"
KIND = "REMIND"
# Guests are not asked to report; members and admins are.
MEMBER_ROLE = 15
AWAY_MODES = ("LEAVE", "OFF")


@dataclass(frozen=True)
class Slot:
    start: time
    # Exclusive. `None`: until the end of the day.
    end: time | None
    title: str
    body: str

    def is_open(self, moment):
        return self.start <= moment and (self.end is None or moment < self.end)


EVENING = Slot(
    start=time(20, 0),
    end=time(21, 0),
    title="Log your tasks for today",
    body="You have not logged any task today. Open the Day Report, add what you worked on and send it.",
)
LAST_CALL = Slot(
    start=time(23, 30),
    end=None,
    title="Only 30 minutes left to log your tasks",
    body=(
        "Your Day Report for today is still empty. Once the day is over it counts as late and your managers "
        "are told. Fill it in now."
    ),
)
SLOTS = (EVENING, LAST_CALL)


def team_zone():
    """The clock the reminders follow; an unknown name falls back to the default."""
    name = os.environ.get("TEAM_OPS_REMINDER_TIMEZONE", "").strip() or DEFAULT_ZONE
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_ZONE)


def remind_missing_day_reports(now=None):
    """Send the reminder whose time it is to everyone who still owes a report; returns how many were told."""
    zone = team_zone()
    local = (now or timezone.now()).astimezone(zone)
    open_slots = [slot for slot in SLOTS if slot.is_open(local.time())]
    return sum(_remind(slot, local.date()) for slot in open_slots)


def _people_by_workspace():
    rows = WorkspaceMember.objects.filter(
        is_active=True, role__gte=MEMBER_ROLE, member__is_active=True, member__is_bot=False
    ).select_related("workspace")
    people = defaultdict(lambda: (None, []))
    for row in rows:
        workspace, ids = people[row.workspace_id]
        people[row.workspace_id] = (row.workspace, [*ids, row.member_id])
    return people.values()


def _is_working_day(workspace, day):
    row = CalendarSettings.objects.filter(workspace=workspace).first()
    weekdays = row.working_weekdays if row else default_working_weekdays()
    if day.isoweekday() not in weekdays:
        return False
    return not CalendarHoliday.objects.filter(workspace=workspace, date=day).exists()


def _remind(slot, day):
    # The day is in the link, so "told today" does not depend on when the job happened to run.
    link = f"team-ops/workday?date={day.isoformat()}"
    told = 0
    for workspace, user_ids in _people_by_workspace():
        if not _is_working_day(workspace, day):
            continue
        away = set(
            CalendarEntry.objects.filter(
                workspace=workspace, work_date=day, user_id__in=user_ids, work_mode__in=AWAY_MODES
            ).values_list("user_id", flat=True)
        )
        logged = set(
            DayReportEntry.objects.filter(
                report__workspace=workspace, report__date=day, report__user_id__in=user_ids
            ).values_list("report__user_id", flat=True)
        )
        already = set(
            OpsNotification.objects.filter(
                workspace=workspace, kind=KIND, title=slot.title, link=link, user_id__in=user_ids
            ).values_list("user_id", flat=True)
        )
        due = [user_id for user_id in user_ids if user_id not in away | logged | already]
        if due:
            told += notify(workspace, due, KIND, slot.title, slot.body, link=link)
    return told
