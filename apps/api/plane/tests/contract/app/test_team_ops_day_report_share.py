# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Telling people about a task of the Day Report: a note, tagged people, and a post in the Hub."""

from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from plane.db.models import Issue
from plane.team_ops.models import HubAttachment, HubMention, HubMessage
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    lead,
    lead_client,
    make_project,
    member,
    member_client,
    other_workspace,
    outsider,
    url,
    workspace,
)


class FakeStorage:
    def upload_file(self, upload, key, content_type):
        return True


@pytest.fixture
def storage():
    with mock.patch("plane.team_ops.services.hub_files.get_storage", return_value=FakeStorage()):
        yield


@pytest.fixture
def project(workspace, admin, member, colleague):
    return make_project(workspace, admin, "SH", members=[member, colleague])


@pytest.fixture
def issue(workspace, project):
    return Issue.objects.create(name="Draw the panel", project=project, workspace=workspace)


def share(client, workspace, **data):
    return client.post(url(workspace, "day-reports/share/"), data, format="multipart")


@pytest.mark.contract
class TestShareATask:
    def test_a_tagged_person_is_told_and_gets_the_file(self, member_client, storage, workspace, issue, colleague):
        notes = SimpleUploadedFile("notes.md", b"# Done", content_type="text/markdown")
        response = share(
            member_client, workspace, issue=str(issue.id), finished="true", users=[str(colleague.id)], files=[notes]
        )
        assert response.status_code == 201, response.data
        message = HubMessage.objects.get(channel__project=issue.project)
        assert message.body.startswith("Done: SH-1 Draw the panel")
        assert HubMention.objects.filter(message=message, user=colleague).exists()
        assert HubAttachment.objects.filter(message=message, name="notes.md").exists()

    def test_somebody_has_to_be_tagged(self, member_client, workspace, issue):
        assert share(member_client, workspace, issue=str(issue.id)).status_code == 400

    def test_only_a_member_of_the_project_shares_its_work_items(self, lead_client, workspace, issue, colleague):
        assert share(lead_client, workspace, issue=str(issue.id), users=[str(colleague.id)]).status_code == 400


@pytest.mark.contract
class TestTaskDocument:
    def test_files_of_a_finished_task_become_a_document_in_the_doc_hub(self, member_client, storage, workspace, issue):
        from plane.team_ops.models import HubDoc

        pdf = SimpleUploadedFile("report.pdf", b"%PDF-1.4", content_type="application/pdf")
        response = member_client.post(
            url(workspace, "day-reports/document/"),
            {"issue": str(issue.id), "day": "2026-11-10", "files": [pdf]},
            format="multipart",
        )
        assert response.status_code == 201, response.data
        doc = HubDoc.objects.get(pk=response.data["id"])
        assert doc.title == "SH-1 Draw the panel (2026-11-10)" and doc.project == issue.project
        assert HubAttachment.objects.filter(doc=doc, name="report.pdf").exists()

    def test_a_file_is_needed(self, member_client, workspace, issue):
        response = member_client.post(
            url(workspace, "day-reports/document/"), {"issue": str(issue.id), "day": "2026-11-10"}, format="multipart"
        )
        assert response.status_code == 400
