# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Reminders at 20:00 and 23:30 for people who have logged no task today."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from plane.team_ops.models import (
    CalendarEntry,
    CalendarHoliday,
    DayReport,
    DayReportEntry,
    MicroTask,
    OpsNotification,
)
from plane.team_ops.services.reminders import EVENING, LAST_CALL, remind_missing_day_reports
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    colleague,
    guest,
    lead,
    member,
    next_monday,
    outsider,
    workspace,
)

TEHRAN = ZoneInfo("Asia/Tehran")


def at(day, hour, minute=0):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TEHRAN)


def log_a_task(workspace, user, day):
    task = MicroTask.objects.create(workspace=workspace, assignee=user, title="Call")
    report = DayReport.objects.create(workspace=workspace, user=user, date=day)
    DayReportEntry.objects.create(report=report, micro_task=task, minutes=30)


def told(kind_title):
    return set(OpsNotification.objects.filter(kind="REMIND", title=kind_title).values_list("user_id", flat=True))


@pytest.mark.contract
class TestEveningReminder:
    def test_only_people_without_a_task_are_told(self, workspace, admin, member, colleague, lead):
        monday = next_monday()
        log_a_task(workspace, member, monday)
        remind_missing_day_reports(now=at(monday, 20, 0))
        # Everyone who is expected to report and has not: not the one who logged, not the guest.
        assert told(EVENING.title) == {admin.id, colleague.id, lead.id}
        row = OpsNotification.objects.get(kind="REMIND", user=colleague)
        assert row.link == f"team-ops/workday?date={monday.isoformat()}" and row.actor_id is None

    def test_it_is_sent_once_however_often_the_job_runs(self, workspace, colleague):
        monday = next_monday()
        remind_missing_day_reports(now=at(monday, 20, 0))
        before = OpsNotification.objects.filter(kind="REMIND").count()
        assert before > 0
        assert remind_missing_day_reports(now=at(monday, 20, 1)) == 0
        assert remind_missing_day_reports(now=at(monday, 20, 29)) == 0
        assert OpsNotification.objects.filter(kind="REMIND").count() == before

    def test_not_outside_its_time(self, workspace):
        monday = next_monday()
        for hour, minute in ((19, 59), (21, 0), (22, 15), (23, 29)):
            assert remind_missing_day_reports(now=at(monday, hour, minute)) == 0
        assert not OpsNotification.objects.filter(kind="REMIND").exists()

    def test_it_follows_the_team_clock_not_the_profile_timezone(self, workspace):
        # 20:00 in Tehran is 16:30 UTC; 20:00 UTC is 23:30 in Tehran.
        monday = next_monday()
        assert remind_missing_day_reports(now=at(monday, 20, 0).astimezone(ZoneInfo("UTC"))) > 0
        assert told(EVENING.title) and not told(LAST_CALL.title)


@pytest.mark.contract
class TestLastCall:
    def test_it_goes_to_those_still_empty_and_says_half_an_hour(self, workspace, admin, member, colleague, lead):
        monday = next_monday()
        remind_missing_day_reports(now=at(monday, 20, 0))
        log_a_task(workspace, colleague, monday)
        remind_missing_day_reports(now=at(monday, 23, 30))
        # The evening one reached all four; the last call only those who did not log since.
        assert told(EVENING.title) == {admin.id, member.id, colleague.id, lead.id}
        assert told(LAST_CALL.title) == {admin.id, member.id, lead.id}
        assert "30 minutes" in LAST_CALL.title

    def test_it_is_sent_once_until_the_end_of_the_day(self, workspace):
        monday = next_monday()
        assert remind_missing_day_reports(now=at(monday, 23, 30)) > 0
        assert remind_missing_day_reports(now=at(monday, 23, 45)) == 0
        assert remind_missing_day_reports(now=at(monday, 23, 59)) == 0

    def test_the_next_day_starts_again(self, workspace, member):
        monday = next_monday()
        remind_missing_day_reports(now=at(monday, 23, 30))
        tuesday = monday + timedelta(days=1)
        assert remind_missing_day_reports(now=at(tuesday, 20, 0)) > 0
        assert OpsNotification.objects.filter(kind="REMIND", user=member).count() == 2


@pytest.mark.contract
class TestWhoIsNotAsked:
    def test_not_on_a_weekend(self, workspace):
        saturday = next_monday() + timedelta(days=5)
        assert remind_missing_day_reports(now=at(saturday, 20, 0)) == 0

    def test_not_on_a_holiday(self, workspace):
        monday = next_monday()
        CalendarHoliday.objects.create(workspace=workspace, date=monday, name="Holiday")
        assert remind_missing_day_reports(now=at(monday, 20, 0)) == 0

    def test_not_those_on_leave_or_a_day_off(self, workspace, member, colleague, lead, admin):
        monday = next_monday()
        CalendarEntry.objects.create(
            workspace=workspace, user=member, work_date=monday, work_mode="LEAVE", leave_type="ANNUAL"
        )
        CalendarEntry.objects.create(workspace=workspace, user=colleague, work_date=monday, work_mode="OFF")
        remind_missing_day_reports(now=at(monday, 20, 0))
        assert told(EVENING.title) == {lead.id, admin.id}

    def test_a_report_of_another_day_does_not_count(self, workspace, member):
        monday = next_monday()
        log_a_task(workspace, member, monday - timedelta(days=1))
        remind_missing_day_reports(now=at(monday, 20, 0))
        assert member.id in told(EVENING.title)

    def test_not_people_who_are_not_in_the_workspace(self, workspace, outsider):
        remind_missing_day_reports(now=at(next_monday(), 20, 0))
        assert not OpsNotification.objects.filter(user=outsider).exists()
        assert not OpsNotification.objects.filter(kind="REMIND").exclude(workspace=workspace).exists()
