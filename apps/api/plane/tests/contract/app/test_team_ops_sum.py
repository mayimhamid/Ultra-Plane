# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""SumTime, counted freezes, what a person was told, and the notice when someone is put in a flow."""

import io
from datetime import timedelta

import pytest
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import status

from plane.db.models import Issue
from plane.team_ops.models import FreezeCredit, OpsNotification, WorkInterruption, WorkSession
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
    make_module,
    make_project,
    member,
    member_client,
    other_workspace,
    outsider,
    outsider_client,
    url,
    workspace,
)


@pytest.fixture
def project(workspace, admin, member, colleague):
    return make_project(workspace, admin, "SM", members=[member, colleague])


@pytest.fixture
def issue(workspace, project):
    return Issue.objects.create(name="Task", project=project, workspace=workspace)


def span(back=2):
    today = timezone.now().date()
    return {"from": str(today - timedelta(days=back)), "to": str(today)}


def work(workspace, user, issue, minutes, place="REMOTE", parallel=False):
    end = timezone.now()
    return WorkSession.objects.create(
        workspace=workspace,
        user=user,
        project=issue.project,
        issue=issue,
        started_at=end - timedelta(minutes=minutes),
        finished_at=end,
        duration_seconds=minutes * 60,
        summary="x",
        location=place,
        is_parallel=parallel,
    )


def freeze(workspace, user, issue, minutes):
    began = timezone.now() - timedelta(minutes=minutes + 5)
    return WorkInterruption.objects.create(
        workspace=workspace,
        user=user,
        kind="FREEZE",
        issue=issue,
        started_at=began,
        ended_at=began + timedelta(minutes=minutes),
    )


def sum_url(workspace, path=""):
    return url(workspace, f"control/sum/{path}")


def row_of(data, user):
    return next(r for r in data["results"] if r["user"]["id"] == user.id)


@pytest.mark.contract
class TestSumTime:
    def test_every_person_with_their_total(self, admin_client, workspace, member, colleague, issue):
        work(workspace, member, issue, 120, "ONSITE")
        work(workspace, member, issue, 60, "REMOTE")
        data = admin_client.get(sum_url(workspace), span()).data
        mine = row_of(data, member)
        assert mine["main_seconds"] == 10800 and mine["onsite_seconds"] == 7200 and mine["remote_seconds"] == 3600
        assert mine["total_seconds"] == 10800
        assert row_of(data, colleague)["total_seconds"] == 0
        assert len(data["results"]) >= 4  # everyone, not a team
        assert data["total_seconds"] == 10800

    def test_parallel_time_counts_once_or_twice(self, admin_client, workspace, member, issue):
        work(workspace, member, issue, 60)
        work(workspace, member, issue, 30, parallel=True)
        assert row_of(admin_client.get(sum_url(workspace), span()).data, member)["total_seconds"] == 5400
        double = admin_client.get(sum_url(workspace), {**span(), "parallel_double": "1"}).data
        assert double["parallel_double"] is True
        assert row_of(double, member)["total_seconds"] == 3600 + 2 * 1800

    def test_frozen_time_is_only_added_once_an_admin_counts_it(self, admin_client, workspace, member, issue):
        work(workspace, member, issue, 60)
        freeze(workspace, member, issue, 20)
        before = row_of(admin_client.get(sum_url(workspace), span()).data, member)
        assert before["frozen_seconds"] == 1200 and before["credited_frozen_seconds"] == 0
        assert before["total_seconds"] == 3600
        body = {"user": str(member.id), **span()}
        assert admin_client.post(sum_url(workspace, "freeze/"), body, format="json").data["changed"] == 1
        after = row_of(admin_client.get(sum_url(workspace), span()).data, member)
        assert after["credited_frozen_seconds"] == 1200 and after["total_seconds"] == 4800
        assert admin_client.post(sum_url(workspace, "freeze/"), body, format="json").data["changed"] == 0
        undone = admin_client.post(sum_url(workspace, "freeze/"), {**body, "credited": False}, format="json")
        assert undone.data["changed"] == 1 and not FreezeCredit.objects.exists()
        assert row_of(admin_client.get(sum_url(workspace), span()).data, member)["total_seconds"] == 3600

    def test_dates_are_respected(self, admin_client, workspace, member, issue):
        work(workspace, member, issue, 60)
        old = {
            "from": str(timezone.now().date() - timedelta(days=30)),
            "to": str(timezone.now().date() - timedelta(days=10)),
        }
        assert row_of(admin_client.get(sum_url(workspace), old).data, member)["total_seconds"] == 0
        assert admin_client.get(sum_url(workspace)).status_code == 400
        assert admin_client.get(sum_url(workspace), {"from": "2020-01-01", "to": "2027-01-01"}).status_code == 400

    def test_excel_export_has_everyone_and_a_total_row(self, admin_client, workspace, member, issue):
        work(workspace, member, issue, 90)
        response = admin_client.get(sum_url(workspace), {**span(), "export": "xlsx"})
        assert response.status_code == 200 and "spreadsheetml" in response["Content-Type"]
        sheet = load_workbook(io.BytesIO(response.content)).active
        rows = list(sheet.iter_rows(values_only=True))
        assert rows[0][0] == "Person" and rows[0][-1] == "Total (h)"
        assert any(r[0] == member.display_name and r[-1] == 1.5 for r in rows)
        total = next(r for r in rows if r[0] == "Everyone")
        assert total[-1] == 1.5

    def test_csv_export_and_formula_safety(self, admin_client, workspace, member, issue):
        member.display_name = "=SUM(A1)"
        member.save()
        work(workspace, member, issue, 60)
        text = admin_client.get(sum_url(workspace), {**span(), "export": "csv"}).content.decode("utf-8-sig")
        assert "'=SUM(A1)" in text and "1.0" in text

    def test_admins_only(self, member_client, lead_client, guest_client, workspace, member):
        for client in (member_client, lead_client, guest_client):
            assert client.get(sum_url(workspace), span()).status_code == status.HTTP_403_FORBIDDEN
            body = {"user": str(member.id), **span()}
            assert client.post(sum_url(workspace, "freeze/"), body, format="json").status_code == 403

    def test_other_workspaces_are_out_of_reach(self, admin_client, workspace, other_workspace):
        body = {"user": str(other_workspace.owner.id), **span()}
        assert admin_client.post(sum_url(workspace, "freeze/"), body, format="json").status_code == 404


@pytest.mark.contract
class TestNotificationsOfAPerson:
    def test_a_manager_sees_titles_and_read_state_but_not_private_messages(
        self, admin_client, member_client, workspace, member, admin
    ):
        OpsNotification.objects.create(workspace=workspace, user=member, kind="FREEZE", title="Frozen", body="b")
        OpsNotification.objects.create(
            workspace=workspace, user=member, kind="NEWS", title="News", read_at=timezone.now()
        )
        OpsNotification.objects.create(workspace=workspace, user=member, kind="DIRECT", title="Secret chat", body="hi")
        OpsNotification.objects.create(workspace=workspace, user=member, kind="SECRET", title="A secret")
        rows = admin_client.get(url(workspace, "control/notifications/"), {"user": str(member.id)}).data["results"]
        assert {r["title"]: r["read"] for r in rows} == {"Frozen": False, "News": True}
        assert all("body" not in r for r in rows)
        assert member_client.get(url(workspace, "control/notifications/"), {"user": str(admin.id)}).status_code == 403

    def test_a_person_can_mark_one_unread_again(self, member_client, workspace, member):
        note = OpsNotification.objects.create(workspace=workspace, user=member, kind="NEWS", title="N")
        member_client.post(url(workspace, "notifications/"), {"id": str(note.id)}, format="json")
        assert member_client.get(url(workspace, "notifications/")).data["unread"] == 0
        member_client.post(url(workspace, "notifications/"), {"id": str(note.id), "read": False}, format="json")
        assert member_client.get(url(workspace, "notifications/")).data["unread"] == 1


@pytest.mark.contract
class TestFlowNotice:
    def create(self, client, workspace, project, *groups):
        return client.post(
            url(workspace, "teamflow/flows/"),
            {
                "project": str(project.id),
                "name": "Release",
                "stages": [{"name": f"S{i}", "modules": [str(m.id) for m in g]} for i, g in enumerate(groups)],
            },
            format="json",
        )

    def test_everyone_on_the_modules_of_a_new_flow_is_told_except_the_author(
        self, member_client, workspace, project, member, colleague, admin
    ):
        one = make_module(workspace, project, "One", lead=member)
        two = make_module(workspace, project, "Two", members=[colleague], lead=admin)
        assert self.create(member_client, workspace, project, [one], [two]).status_code == 201
        told = {n.user_id: n for n in OpsNotification.objects.filter(kind="FLOW")}
        assert set(told) == {colleague.id, admin.id}
        note = told[colleague.id]
        assert "Release" in note.title and project.name in note.body and note.link == "team-ops/teamflow"

    def test_editing_only_tells_the_people_added(self, member_client, workspace, project, member, colleague, admin):
        one = make_module(workspace, project, "One", lead=member)
        two = make_module(workspace, project, "Two", lead=admin)
        flow = self.create(member_client, workspace, project, [one]).data
        OpsNotification.objects.all().delete()
        member_client.put(
            url(workspace, f"teamflow/flows/{flow['id']}/"),
            {
                "name": "Release",
                "stages": [
                    {"name": "S0", "modules": [str(one.id)]},
                    {"name": "S1", "modules": [str(two.id)]},
                ],
            },
            format="json",
        )
        assert set(OpsNotification.objects.filter(kind="FLOW").values_list("user_id", flat=True)) == {admin.id}
