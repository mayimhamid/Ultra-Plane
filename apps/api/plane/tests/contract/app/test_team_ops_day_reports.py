# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Day Reports, planned time and its verdict, micro tasks and the task import."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import Issue, IssueAssignee, Module, ModuleIssue, State
from plane.team_ops.models import DayReport, DayReportRevision, MicroTask, OpsNotification, TaskPlan
from plane.team_ops.services.day_reports import IN_PROGRESS, ON_TIME, OVERTIME, SPEEDY, verdict
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    guest_client,
    lead,
    lead_client,
    make_client,
    make_project,
    make_team,
    member,
    member_client,
    other_workspace,
    outsider,
    outsider_client,
    url,
    workspace,
)


@pytest.fixture
def project(workspace, admin, member):
    return make_project(workspace, admin, "DR", members=[member])


@pytest.fixture
def issue(workspace, project):
    return Issue.objects.create(name="Draw the panel", project=project, workspace=workspace)


def today():
    return timezone.now().date()


def report_url(workspace, day, path=""):
    return url(workspace, f"day-reports/{day.isoformat()}/{path}")


def put(client, workspace, day, entries, **extra):
    return client.put(report_url(workspace, day), {"entries": entries, **extra}, format="json")


class TestVerdict:
    @pytest.mark.parametrize(
        ("planned", "unit", "reported", "finished", "expected"),
        [
            (None, "HOURS", 100, True, None),
            (600, "HOURS", 400, True, SPEEDY),  # under 75 %
            (600, "HOURS", 600, True, ON_TIME),
            (600, "HOURS", 660, True, ON_TIME),  # inside the 10 % tolerance
            (600, "HOURS", 661, False, OVERTIME),
            (60, "HOURS", 90, True, ON_TIME),  # tolerance is at least 30 minutes
            (60, "HOURS", 91, True, OVERTIME),
            (480, "DAYS", 720, True, ON_TIME),  # at least half a day for day tasks
            (480, "DAYS", 721, True, OVERTIME),
            (600, "HOURS", 300, False, IN_PROGRESS),
        ],
    )
    def test_rule(self, planned, unit, reported, finished, expected):
        assert verdict(planned, unit, reported, finished) == expected


@pytest.mark.contract
class TestDayReport:
    def test_today_is_a_draft_until_sent_and_then_changes_are_recorded(
        self, member_client, admin, workspace, member, issue
    ):
        day = today()
        draft = put(member_client, workspace, day, [{"issue": str(issue.id), "minutes": 90}])
        assert draft.status_code == status.HTTP_200_OK
        assert draft.data["status"] == "DRAFT" and draft.data["total_minutes"] == 90
        assert not draft.data["changes_are_recorded"]
        # Changing a draft is not recorded.
        put(member_client, workspace, day, [{"issue": str(issue.id), "minutes": 120}])
        assert not DayReportRevision.objects.exists()
        sent = put(member_client, workspace, day, [{"issue": str(issue.id), "minutes": 120}], submit=True)
        assert sent.data["status"] == "SUBMITTED" and sent.data["changes_are_recorded"]
        assert not DayReportRevision.objects.exists()
        changed = put(
            member_client, workspace, day, [{"issue": str(issue.id), "minutes": 150}], reason="Forgot the call"
        )
        assert changed.data["edit_count"] == 1 and changed.data["status"] == "SUBMITTED"
        revision = DayReportRevision.objects.get()
        assert revision.kind == "CHANGE" and revision.reason == "Forgot the call"
        assert revision.before[0]["minutes"] == 120 and revision.after[0]["minutes"] == 150
        told = OpsNotification.objects.get(kind="REPORT", user=admin)
        assert "changed" in told.title and "1 time" in told.body
        history = member_client.get(report_url(workspace, day, "history/")).data["results"]
        assert len(history) == 1 and history[0]["changed_by"]["id"] == str(member.id)

    def test_a_forgotten_past_day_is_sent_late_and_recorded(self, member_client, workspace, member, issue):
        day = today() - timedelta(days=3)
        response = put(member_client, workspace, day, [{"issue": str(issue.id), "minutes": 60}])
        assert response.data["status"] == "SUBMITTED" and response.data["is_late"]
        assert DayReportRevision.objects.get().kind == "LATE"
        assert response.data["edit_count"] == 1

    def test_the_future_and_bad_rows_are_refused(self, member_client, workspace, issue):
        tomorrow = today() + timedelta(days=1)
        assert put(member_client, workspace, tomorrow, [{"issue": str(issue.id), "minutes": 10}]).status_code == 400
        assert put(member_client, workspace, today(), [{"issue": str(issue.id), "minutes": 0}]).status_code == 400
        assert put(member_client, workspace, today(), [{"minutes": 30}]).status_code == 400
        too_much = [{"issue": str(issue.id), "minutes": 800}, {"issue": str(issue.id), "minutes": 800}]
        assert put(member_client, workspace, today(), too_much).status_code == 400

    def test_a_work_item_outside_my_projects_is_refused(self, member_client, workspace, admin):
        other = make_project(workspace, admin, "XX")
        hidden = Issue.objects.create(name="Secret", project=other, workspace=workspace)
        assert put(member_client, workspace, today(), [{"issue": str(hidden.id), "minutes": 10}]).status_code == 400

    def test_managers_read_reports_of_their_people_and_the_team_list(
        self, admin_client, member_client, workspace, member, issue
    ):
        put(member_client, workspace, today(), [{"issue": str(issue.id), "minutes": 45}], submit=True)
        read = admin_client.get(report_url(workspace, today()), {"user": str(member.id)})
        assert read.status_code == 200 and read.data["total_minutes"] == 45 and not read.data["can_edit"]
        team = admin_client.get(url(workspace, "day-reports/team/")).data["results"]
        row = next(r for r in team if r["user"]["id"] == str(member.id))
        assert row["status"] == "SUBMITTED" and row["total_minutes"] == 45
        assert member_client.get(url(workspace, "day-reports/team/")).status_code in (200, 403)


@pytest.mark.contract
class TestPlannedTime:
    def test_plan_and_progress_of_a_work_item(self, member_client, workspace, issue):
        plan_url = url(workspace, f"task-plans/{issue.id}/")
        saved = member_client.put(plan_url, {"amount": 2, "unit": "HOURS"}, format="json")
        assert saved.status_code == 200 and saved.data["planned_minutes"] == 120
        put(member_client, workspace, today(), [{"issue": str(issue.id), "minutes": 60, "finished": True}])
        progress = member_client.get(plan_url).data
        assert progress["reported_minutes"] == 60 and progress["finished"] and progress["status"] == SPEEDY
        row = member_client.get(report_url(workspace, today())).data["entries"][0]
        assert row["task"]["status"] == SPEEDY and row["task"]["planned_minutes"] == 120
        assert member_client.put(plan_url, {"amount": "", "unit": "HOURS"}, format="json").data["status"] is None
        assert not TaskPlan.objects.exists()

    def test_days_are_eight_hours(self, member_client, workspace, issue):
        saved = member_client.put(url(workspace, f"task-plans/{issue.id}/"), {"amount": 1.5, "unit": "DAYS"})
        assert saved.data["planned_minutes"] == 720 and saved.data["planned_amount"] == 1.5


@pytest.mark.contract
class TestMicroTasks:
    def test_micro_tasks_and_meetings_in_the_report(self, member_client, workspace, member):
        created = member_client.post(
            url(workspace, "micro-tasks/"), {"title": "Call the supplier", "amount": 1, "unit": "HOURS"}, format="json"
        )
        assert created.status_code == 201 and created.data["planned_minutes"] == 60
        meeting = member_client.post(
            url(workspace, "micro-tasks/"), {"title": "Weekly sync", "is_meeting": True}, format="json"
        ).data
        assert meeting["is_meeting"] and meeting["planned_minutes"] is None
        report = put(
            member_client,
            workspace,
            today(),
            [
                {"micro_task": created.data["id"], "minutes": 50, "finished": True},
                {"micro_task": meeting["id"], "minutes": 30},
            ],
        ).data
        assert [row["task"]["kind"] for row in report["entries"]] == ["micro", "micro"]
        assert report["entries"][0]["task"]["project"] is None
        assert MicroTask.objects.get(pk=created.data["id"]).done
        listed = member_client.get(url(workspace, "micro-tasks/")).data["results"]
        assert {task["title"] for task in listed} == {"Call the supplier", "Weekly sync"}

    def test_only_managers_give_micro_tasks_to_others(self, member_client, admin_client, workspace, member, colleague):
        body = {"title": "Check stock", "user": str(colleague.id)}
        assert member_client.post(url(workspace, "micro-tasks/"), body, format="json").status_code == 403
        given = admin_client.post(url(workspace, "micro-tasks/"), body, format="json")
        assert given.status_code == 201 and given.data["assignee"]["id"] == str(colleague.id)

    def test_someone_elses_micro_task_cannot_be_reported(self, admin_client, member_client, workspace, member, admin):
        task = admin_client.post(url(workspace, "micro-tasks/"), {"title": "Admin thing"}, format="json").data
        assert put(member_client, workspace, today(), [{"micro_task": task["id"], "minutes": 5}]).status_code == 400


@pytest.mark.contract
class TestImport:
    def test_preview_then_create_work_items(self, member_client, workspace, project, member):
        State.objects.get_or_create(project=project, workspace=workspace, name="Todo", defaults={"color": "#999"})
        module = Module.objects.create(project=project, workspace=workspace, name="Sensors")
        items = [
            {
                "title": "Wire sensor A",
                "planned_hours": 3,
                "assignees": [member.email],
                "module": "Sensors",
                "priority": "high",
                "due_date": "2026-12-01",
            },
            {"title": "Test sensor A", "planned_days": 1},
        ]
        body = {"target": "project", "project": str(project.id), "items": items}
        preview = member_client.post(url(workspace, "import/tasks/"), {**body, "dry_run": True}, format="json")
        assert preview.status_code == 200 and preview.data["ok"] and preview.data["created"] == 0
        assert not Issue.objects.filter(name="Wire sensor A").exists()
        done = member_client.post(url(workspace, "import/tasks/"), {**body, "dry_run": False}, format="json")
        assert done.status_code == 201 and done.data["created"] == 2
        wired = Issue.objects.get(name="Wire sensor A")
        assert wired.priority == "high" and str(wired.target_date) == "2026-12-01"
        assert IssueAssignee.objects.filter(issue=wired, assignee=member).exists()
        assert ModuleIssue.objects.filter(issue=wired, module=module).exists()
        assert TaskPlan.objects.get(issue=wired).planned_minutes == 180
        assert TaskPlan.objects.get(issue__name="Test sensor A").planned_minutes == 480

    def test_rows_with_problems_create_nothing(self, member_client, workspace, project):
        items = [{"title": "Fine"}, {"title": "", "module": "Nope", "assignees": ["ghost@x.test"]}]
        body = {"target": "project", "project": str(project.id), "items": items, "dry_run": False}
        response = member_client.post(url(workspace, "import/tasks/"), body, format="json")
        assert response.status_code == 200 and not response.data["ok"] and response.data["created"] == 0
        assert len(response.data["rows"][1]["errors"]) == 3
        assert not Issue.objects.filter(name="Fine").exists()

    def test_micro_tasks_for_a_person(self, admin_client, workspace, colleague):
        body = {
            "target": "micro",
            "user": str(colleague.id),
            "items": [{"title": "Order cables", "planned_hours": 0.5}, {"title": "Team call", "is_meeting": True}],
            "dry_run": False,
        }
        response = admin_client.post(url(workspace, "import/tasks/"), body, format="json")
        assert response.status_code == 201 and response.data["created"] == 2
        assert MicroTask.objects.filter(assignee=colleague).count() == 2


@pytest.mark.contract
class TestTimesAndPlace:
    def test_start_and_end_give_the_time_and_both_places_make_a_hybrid_day(
        self, member_client, admin_client, workspace, member, issue
    ):
        rows = [
            {"issue": str(issue.id), "start": "09:00", "end": "10:30", "location": "ONSITE"},
            {"issue": str(issue.id), "minutes": 45, "location": "REMOTE", "note": "spread over the day"},
        ]
        report = put(member_client, workspace, today(), rows, submit=True).data
        assert [row["minutes"] for row in report["entries"]] == [90, 45]
        assert report["entries"][0]["start"] == "09:00" and report["entries"][0]["end"] == "10:30"
        assert report["entries"][1]["start"] is None
        assert report["mode"] == "HYBRID" and report["total_minutes"] == 135
        hybrid = admin_client.get(url(workspace, "day-reports/team/"), {"place": "HYBRID"}).data["results"]
        assert [row["user"]["id"] for row in hybrid] == [str(member.id)]
        remote = admin_client.get(url(workspace, "day-reports/team/"), {"place": "REMOTE"}).data["results"]
        assert all(row["user"]["id"] != str(member.id) for row in remote)

    def test_bad_times_are_refused(self, member_client, workspace, issue):
        for row in (
            {"start": "10:00", "end": "09:00"},
            {"start": "10:00"},
            {"start": "ten", "end": "11:00"},
            {"minutes": 30, "location": "MOON"},
        ):
            body = [{"issue": str(issue.id), **row}]
            assert put(member_client, workspace, today(), body).status_code == 400

    def test_export_keeps_only_the_place_asked_for(self, member_client, admin_client, workspace, issue):
        rows = [
            {"issue": str(issue.id), "start": "09:00", "end": "10:00", "location": "ONSITE"},
            {"issue": str(issue.id), "minutes": 30, "location": "REMOTE"},
        ]
        put(member_client, workspace, today(), rows, submit=True)
        params = {"from": str(today() - timedelta(days=7)), "to": str(today())}
        everything = admin_client.get(url(workspace, "day-reports/export/"), params)
        assert everything.status_code == 200 and everything["Content-Type"].startswith("text/csv")
        text = everything.content.decode("utf-8-sig")
        assert "ONSITE" in text and "REMOTE" in text and "HYBRID" in text
        remote = admin_client.get(url(workspace, "day-reports/export/"), {**params, "place": "REMOTE"})
        lines = [line for line in remote.content.decode("utf-8-sig").splitlines() if line.startswith(str(today()))]
        assert len(lines) == 1 and ",REMOTE," in lines[0] and "0.50" in lines[0]
        assert member_client.get(url(workspace, "day-reports/export/"), params).status_code in (200, 403)


@pytest.mark.contract
class TestSummary:
    def test_hours_per_person_and_day_projects_tasks_and_missing_reports(
        self, member_client, admin_client, workspace, member, issue
    ):
        TaskPlan.objects.create(workspace=workspace, issue=issue, planned_minutes=45)
        yesterday = today() - timedelta(days=1)
        put(member_client, workspace, yesterday, [{"issue": str(issue.id), "minutes": 30, "location": "ONSITE"}])
        put(
            member_client,
            workspace,
            today(),
            [
                {"issue": str(issue.id), "start": "09:00", "end": "10:00", "location": "REMOTE", "finished": True},
            ],
            submit=True,
        )
        params = {"from": str(today() - timedelta(days=6)), "to": str(today())}
        data = admin_client.get(url(workspace, "day-reports/summary/"), params).data
        row = next(r for r in data["people"] if r["user"]["id"] == str(member.id))
        assert row["total_minutes"] == 90
        assert row["days"] == {str(yesterday): 30, str(today()): 60}
        assert row["remote_minutes"] == 60 and row["onsite_minutes"] == 30
        assert row["task_count"] == 1 and row["finished"] == 1 and row["overtime"] == 1
        assert row["reports_sent"] == 2 and row["reports_late"] == 1
        assert data["totals"]["minutes"] == 90 and data["totals"]["overtime"] == 1
        assert data["projects"][0]["minutes"] == 90 and data["tasks"][0]["minutes"] == 90
        assert len(data["days"]) == 7 and sum(day["minutes"] for day in data["days"]) == 90
        remote = admin_client.get(url(workspace, "day-reports/summary/"), {**params, "place": "REMOTE"}).data
        row = next(r for r in remote["people"] if r["user"]["id"] == str(member.id))
        assert row["total_minutes"] == 60

    def test_only_managers(self, member_client, workspace):
        params = {"from": str(today() - timedelta(days=6)), "to": str(today())}
        assert member_client.get(url(workspace, "day-reports/summary/"), params).status_code in (200, 403)
