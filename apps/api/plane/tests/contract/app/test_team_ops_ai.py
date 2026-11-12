# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Team Ops AI: work evidence (no AI needed), and the Plane AI proxy endpoints with the service mocked."""

from datetime import timedelta
from unittest import mock

import pytest
import requests
from django.test import override_settings

from plane.db.models import Issue, IssueActivity, IssueAssignee, State
from plane.team_ops.models import DayReport, DayReportEntry
from plane.team_ops.services import ai_client
from plane.team_ops.services.work_evidence import entry_support, level, score_person
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    guest_client,
    lead,
    lead_client,
    make_project,
    make_team,
    member,
    member_client,
    other_workspace,
    outsider,
    outsider_client,
    today,
    url,
    workspace,
)

AI = {"PLANE_AI_URL": "http://plane-ai.test", "PLANE_AI_TOKEN": "t", "PLANE_AI_TIMEOUT": 5}
DAY = today()


def row(**over):
    base = {"kind": "issue", "date": DAY, "key": "A-1", "name": "Task", "minutes": 120, "finished": False, "note": ""}
    return {**base, **over}


class TestEvidenceScoring:
    def test_activity_document_and_note_add_up(self):
        assert entry_support(row(activity=2))[0] == 0.5
        assert entry_support(row(activity=1, document=True))[0] == 0.8
        assert entry_support(row(activity=1, document=True, note="Fixed the sync bug in the parser"))[0] == 1.0
        assert entry_support(row())[0] == 0

    def test_done_but_still_open_halves_support(self):
        support, _, flagged = entry_support(row(activity=1, finished=True, issue_done=False))
        assert support == 0.25 and flagged
        assert entry_support(row(activity=1, finished=True, issue_done=True))[2] is False

    def test_micro_tasks_and_meetings(self):
        assert entry_support(row(kind="micro", is_meeting=True))[0] == 0.8
        assert entry_support(row(kind="micro", note="Call with the client about scope"))[0] == 0.7
        assert entry_support(row(kind="micro"))[0] == 0.4

    def test_person_score_is_minutes_weighted_and_flags_explain(self):
        entries = [
            row(minutes=360, activity=3, document=True, note="Rewrote the importer and its tests"),
            row(key="A-2", minutes=300, finished=True, issue_done=False),
        ]
        reports = [{"date": DAY, "is_late": True, "edit_count": 1}]
        score, facts, flags, items = score_person(entries, reports)
        assert score == round(100 * 360 / 660)
        assert facts["rows_without_any_trace"] == 1 and facts["marked_done_still_open"] == 1
        assert facts["days_over_12h"] == 0 and facts["late_reports"] == 1
        assert any("no activity, document or note" in f for f in flags)
        assert any("4h or more" in f for f in flags)
        assert any("still open" in f for f in flags)
        assert items[0]["key"] == "A-2"  # weakest first

    def test_levels(self):
        assert level(0, False) == "NO_DATA"
        assert level(75, True) == "STRONG" and level(50, True) == "PARTIAL" and level(10, True) == "WEAK"


@pytest.fixture
def reported(workspace, admin, member, colleague):
    """The member reports two rows: one with activity, one marked done that is still open. The colleague
    reports nothing."""
    project = make_project(workspace, admin, "EVD", members=[member, colleague])
    doing = State.objects.create(project=project, name="Doing", group="started")
    worked = Issue.objects.create(project=project, name="Worked", state=doing)
    claimed = Issue.objects.create(project=project, name="Claimed", state=doing)
    for issue in (worked, claimed):
        IssueAssignee.objects.create(issue=issue, assignee=member, project=project)
    IssueActivity.objects.create(issue=worked, project=project, workspace=workspace, actor=member, verb="updated")
    report = DayReport.objects.create(workspace=workspace, user=member, date=DAY, status=DayReport.Status.SUBMITTED)
    DayReportEntry.objects.create(report=report, issue=worked, minutes=180, note="Implemented the export endpoint")
    DayReportEntry.objects.create(report=report, issue=claimed, minutes=300, finished=True)
    return {"project": project, "worked": worked, "claimed": claimed}


def team_url(workspace, **params):
    query = "&".join(f"{k}={v}" for k, v in {"from": DAY, "to": DAY, **params}.items())
    return url(workspace, f"ai/team/?{query}")


@pytest.mark.contract
class TestWorkEvidenceEndpoint:
    @pytest.mark.django_db
    def test_evidence_without_any_ai(self, admin_client, workspace, member, colleague, reported):
        data = admin_client.get(team_url(workspace)).data
        people = {p["user"]["id"]: p for p in data["people"]}
        mine = people[member.id]
        assert mine["facts"]["reported_minutes"] == 480
        assert mine["facts"]["rows_with_activity"] == 1
        assert mine["facts"]["marked_done_still_open"] == 1
        assert mine["level"] in ("PARTIAL", "WEAK")
        assert people[colleague.id]["level"] == "NO_DATA"
        assert data["team"]["people_reporting"] == 1
        assert data["notice"]

    @pytest.mark.django_db
    def test_only_people_who_may_see_the_team(self, member_client, guest_client, outsider_client, workspace, reported):
        for client in (member_client, guest_client, outsider_client):
            assert client.get(team_url(workspace)).status_code == 403

    @pytest.mark.django_db
    def test_a_lead_sees_only_their_team(self, lead_client, workspace, lead, member, colleague, reported):
        make_team(workspace, "Platform", leads=[lead], members=[member])
        ids = {p["user"]["id"] for p in lead_client.get(team_url(workspace)).data["people"]}
        assert colleague.id not in ids and member.id in ids

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_ai_review_is_a_managers_job_with_only_numbers_and_flags(self, admin_client, workspace, reported):
        job = {"id": "j1", "status": "queued"}
        with mock.patch.object(ai_client, "call", return_value=job) as call:
            resp = admin_client.post(url(workspace, "ai/team/"), {"from": str(DAY), "to": str(DAY)}, format="json")
        assert resp.status_code == 202 and resp.data["id"] == "j1"
        method, path = call.call_args.args
        body = call.call_args.kwargs["json"]
        assert (method, path) == ("POST", "/v1/jobs")
        assert body["kind"] == "team_review" and body["audience"] == "managers"
        assert body["workspace_id"] == str(workspace.id)
        assert set(body["input"]["members"][0]) == {"user_id", "name", "score", "facts", "flags"}


@pytest.mark.contract
class TestAIProxy:
    @pytest.mark.django_db
    @override_settings(PLANE_AI_URL="")
    def test_not_configured_means_off(self, member_client, workspace):
        data = member_client.get(url(workspace, "ai/")).data
        assert data["configured"] is False and data["enabled"] is False
        resp = member_client.post(url(workspace, "ai/summarize/"), {"kind": "text", "text": "x"}, format="json")
        assert resp.status_code == 503 and resp.data["code"] == "not_configured"

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_service_down_is_a_friendly_503(self, member_client, workspace):
        with mock.patch.object(requests, "request", side_effect=requests.ConnectionError()):
            resp = member_client.post(url(workspace, "ai/summarize/"), {"kind": "text", "text": "x"}, format="json")
            status = member_client.get(url(workspace, "ai/")).data
        assert resp.status_code == 503 and resp.data["code"] == "unavailable"
        assert (status["configured"], status["reachable"], status["enabled"]) == (True, False, False)

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_settings_are_for_admins(self, admin_client, member_client, workspace):
        body = {"enabled": True, "effort": "low"}
        assert member_client.patch(url(workspace, "ai/settings/"), body, format="json").status_code == 403
        assert (
            admin_client.patch(
                url(workspace, "ai/settings/"), {"enabled": True, "effort": "max"}, format="json"
            ).status_code
            == 400
        )
        status = {"configured": True, "reachable": True, "enabled": True, "effort": "low"}
        with mock.patch.object(ai_client, "call") as call, mock.patch.object(ai_client, "status", return_value=status):
            resp = admin_client.patch(url(workspace, "ai/settings/"), body, format="json")
        assert resp.status_code == 200 and resp.data["effort"] == "low"
        assert call.call_args.kwargs["json"]["effort"] == "low"

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_summary_of_a_work_item_needs_project_access(self, admin, member_client, workspace, reported):
        from plane.tests.contract.app.team_ops_support import make_project as mk

        hidden_project = mk(workspace, admin, "HID")
        hidden = Issue.objects.create(project=hidden_project, name="Secret plan")
        with mock.patch.object(ai_client, "call", return_value={"id": "j", "status": "queued"}) as call:
            denied = member_client.post(
                url(workspace, "ai/summarize/"), {"kind": "issue", "issue": str(hidden.id)}, format="json"
            )
            allowed = member_client.post(
                url(workspace, "ai/summarize/"), {"kind": "issue", "issue": str(reported["worked"].id)}, format="json"
            )
        assert denied.status_code == 403
        assert allowed.status_code == 202 and allowed.data["id"] == "j"
        sent = call.call_args.kwargs["json"]["input"]["text"]
        assert "Worked" in sent and "Secret plan" not in sent

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_chat_and_search_only_send_readable_projects(self, admin, member, member_client, workspace, reported):
        from plane.tests.contract.app.team_ops_support import make_project as mk

        hidden_project = mk(workspace, admin, "HID")
        with mock.patch.object(ai_client, "call", return_value={"results": []}) as call:
            member_client.get(url(workspace, "ai/search/?q=export"))
        projects = call.call_args.kwargs["json"]["project_ids"]
        assert str(reported["project"].id) in projects and str(hidden_project.id) not in projects

        upstream = mock.Mock()
        upstream.iter_content.return_value = [b"event: meta\ndata: {}\n\n", b"event: done\ndata: {}\n\n"]
        with mock.patch.object(ai_client, "stream", return_value=upstream) as stream:
            resp = member_client.post(url(workspace, "ai/chat/"), {"message": "hi"}, format="json")
            body = b"".join(resp.streaming_content)
        assert resp["Content-Type"] == "text/event-stream"
        assert b"event: done" in body
        sent = stream.call_args.kwargs["json"]
        assert sent["user_id"] == str(member.id) and str(hidden_project.id) not in sent["project_ids"]
        upstream.close.assert_called_once()

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_index_is_for_admins(self, admin_client, member_client, workspace, reported):
        assert member_client.post(url(workspace, "ai/index/")).status_code == 403
        with mock.patch.object(ai_client, "call", return_value={"documents": 2, "chunks": 2}) as call:
            data = admin_client.post(url(workspace, "ai/index/")).data
        assert data["documents"] >= 2
        docs = call.call_args.kwargs["json"]["documents"]
        assert {d["source_type"] for d in docs} == {"issue"}


@pytest.mark.contract
class TestManagersAI:
    @pytest.mark.django_db
    @override_settings(**AI)
    def test_daily_review_rows_and_job(self, admin_client, member_client, workspace, member, reported):
        assert member_client.get(url(workspace, f"ai/daily/?date={DAY}")).status_code == 403
        with mock.patch.object(ai_client, "call", return_value=[]):
            data = admin_client.get(url(workspace, f"ai/daily/?date={DAY}")).data
        mine = next(p for p in data["people"] if p["user_id"] == str(member.id))
        rows = {r["task"]: r for r in mine["rows"]}
        assert rows["Worked"]["evidence"]["activity"] is True and rows["Worked"]["minutes"] == 180
        assert rows["Claimed"]["done_but_open"] is True and rows["Claimed"]["evidence"]["activity"] is False
        assert data["review"] is None

        with mock.patch.object(ai_client, "call", return_value={"id": "d1", "status": "queued"}) as call:
            resp = admin_client.post(url(workspace, "ai/daily/"), {"date": str(DAY)}, format="json")
        assert resp.status_code == 202
        body = call.call_args.kwargs["json"]
        assert body["kind"] == "daily_review" and body["audience"] == "managers"
        assert body["key"].startswith(f"daily:{DAY}:")
        assert [p["name"] for p in body["input"]["people"]] == ["member"]  # only people who reported

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_daily_review_needs_reports(self, admin_client, workspace):
        resp = admin_client.post(url(workspace, "ai/daily/"), {"date": str(DAY)}, format="json")
        assert resp.status_code == 400

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_ask_sends_sections_built_from_plane_data(self, admin_client, member_client, workspace, reported):
        body = {"question": "Who worked the most?", "from": str(DAY), "to": str(DAY)}
        assert member_client.post(url(workspace, "ai/ask/"), body, format="json").status_code == 403
        with mock.patch.object(ai_client, "call", return_value={"id": "a1", "status": "queued"}) as call:
            resp = admin_client.post(url(workspace, "ai/ask/"), body, format="json")
        assert resp.status_code == 202
        sent = call.call_args.kwargs["json"]
        assert sent["kind"] == "ask" and sent["audience"] == "user"
        sections = sent["input"]["sections"]
        assert set(sections) == {"people", "daily_notes", "evidence", "risks", "workload"}
        assert "member: 8.0 h reported" in sections["people"]["text"]
        assert "Implemented the export endpoint" in sections["daily_notes"]["text"]
        assert str(reported["project"].id) in sent["input"]["project_ids"]

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_job_polling_passes_the_manager_flag(self, admin_client, member_client, workspace):
        with mock.patch.object(ai_client, "call", return_value={"id": "x", "status": "done"}) as call:
            admin_client.get(url(workspace, "ai/jobs/00000000-0000-0000-0000-000000000001/"))
            assert call.call_args.kwargs["params"]["manager"] == "true"
            member_client.get(url(workspace, "ai/jobs/00000000-0000-0000-0000-000000000001/"))
            assert call.call_args.kwargs["params"]["manager"] in ("true", "false")

    @pytest.mark.django_db
    @override_settings(**AI)
    def test_feedback_and_training_export(self, admin_client, member_client, workspace):
        job = "00000000-0000-0000-0000-000000000002"
        assert (
            admin_client.post(url(workspace, f"ai/jobs/{job}/feedback/"), {"rating": 5}, format="json").status_code
            == 400
        )
        with mock.patch.object(ai_client, "call", return_value={"ok": True}) as call:
            resp = admin_client.post(
                url(workspace, f"ai/jobs/{job}/feedback/"),
                {"rating": -1, "item": "p1", "correction": "x"},
                format="json",
            )
        assert resp.status_code == 201
        assert call.call_args.kwargs["json"]["rating"] == -1

        assert member_client.get(url(workspace, "ai/training/")).status_code == 403
        upstream = mock.Mock()
        upstream.iter_content.return_value = [b'{"messages": []}\n']
        with mock.patch.object(ai_client, "export_training", return_value=upstream):
            resp = admin_client.get(url(workspace, "ai/training/"))
            body = b"".join(resp.streaming_content)
        assert body == b'{"messages": []}\n' and "attachment" in resp["Content-Disposition"]
        upstream.close.assert_called_once()
