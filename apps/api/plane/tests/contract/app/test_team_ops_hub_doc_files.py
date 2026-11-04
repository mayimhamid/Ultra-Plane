# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""A Doc Hub document and its files are one thing, and `@everyone` tags every member of a channel."""

from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from plane.team_ops.models import HubAttachment, HubMention, OpsNotification
from plane.tests.contract.app.team_ops_support import (
    _no_broker,
    admin,
    admin_client,
    colleague,
    guest,
    guest_client,
    join,
    lead,
    lead_client,
    make_client,
    make_project,
    member,
    member_client,
    other_workspace,
    outsider,
    outsider_client,
    url,
    workspace,
)


class FakeStorage:
    def __init__(self):
        self.files = {}

    def upload_file(self, file_obj, key, content_type):
        self.files[key] = file_obj.read()
        return True

    def generate_presigned_url(self, key, expiration, disposition, filename, content_type):
        return f"https://files.test/{key}?expires={expiration}&disposition={disposition}"


@pytest.fixture
def storage():
    fake = FakeStorage()
    with mock.patch("plane.team_ops.services.hub_files.get_storage", return_value=fake):
        yield fake


@pytest.fixture
def project(workspace, admin, member, colleague):
    return make_project(workspace, admin, "DF", members=[member, colleague])


def h(workspace, path=""):
    return url(workspace, f"hub/{path}")


def pdf(name="a.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 x", content_type="application/pdf")


def make_doc(client, workspace, **extra):
    return client.post(h(workspace, "docs/"), {"title": "Runbook", "body": "Steps", **extra}, format="json").data


def add_files(client, workspace, doc_id, *names):
    return client.post(
        h(workspace, "library/"), {"doc": str(doc_id), "files": [pdf(name) for name in names]}, format="multipart"
    )


@pytest.mark.contract
class TestDocumentFiles:
    def test_a_document_holds_its_files(self, member_client, storage, workspace):
        doc = make_doc(member_client, workspace)
        assert doc["files"] == [] and doc["file_count"] == 0
        response = add_files(member_client, workspace, doc["id"], "plan.pdf", "budget.pdf")
        assert response.status_code == 201
        assert {f["source"] for f in response.data["results"]} == {"Document"}
        detail = member_client.get(h(workspace, f"docs/{doc['id']}/")).data
        assert [f["name"] for f in detail["files"]] == ["plan.pdf", "budget.pdf"]
        listed = member_client.get(h(workspace, "docs/")).data["results"][0]
        assert listed["file_count"] == 2 and "files" not in listed

    def test_files_of_a_document_are_not_listed_as_other_files(self, member_client, storage, workspace):
        doc = make_doc(member_client, workspace)
        add_files(member_client, workspace, doc["id"], "plan.pdf")
        member_client.post(h(workspace, "library/"), {"files": [pdf("loose.pdf")]}, format="multipart")
        names = [f["name"] for f in member_client.get(h(workspace, "library/")).data["results"]]
        assert names == ["loose.pdf"]

    def test_whoever_reads_the_document_opens_its_files(self, member_client, lead_client, storage, workspace):
        doc = make_doc(member_client, workspace)
        file_id = add_files(member_client, workspace, doc["id"], "plan.pdf").data["results"][0]["id"]
        link = lead_client.get(h(workspace, f"files/{file_id}/"))
        assert link.status_code == 200 and "expires=300" in link.data["url"]

    def test_the_files_of_a_project_document_stay_with_its_project(
        self, member_client, lead_client, admin_client, project, storage, workspace
    ):
        doc = make_doc(member_client, workspace, project=str(project.id))
        file_id = add_files(member_client, workspace, doc["id"], "secret.pdf").data["results"][0]["id"]
        assert lead_client.get(h(workspace, f"files/{file_id}/")).status_code == 404
        assert lead_client.delete(h(workspace, f"library/{file_id}/")).status_code == 404
        assert add_files(lead_client, workspace, doc["id"], "x.pdf").status_code == 404
        assert admin_client.get(h(workspace, f"files/{file_id}/")).status_code == 200

    def test_only_the_author_or_an_admin_adds_files(self, member_client, lead_client, admin_client, storage, workspace):
        doc = make_doc(member_client, workspace)
        assert add_files(lead_client, workspace, doc["id"], "x.pdf").status_code == 400
        assert add_files(admin_client, workspace, doc["id"], "x.pdf").status_code == 201
        assert add_files(member_client, workspace, "00000000-0000-0000-0000-000000000000", "x.pdf").status_code == 404

    def test_the_author_the_uploader_or_an_admin_removes_a_file(
        self, member_client, lead_client, admin_client, storage, workspace
    ):
        doc = make_doc(member_client, workspace)
        by_admin = add_files(admin_client, workspace, doc["id"], "a.pdf").data["results"][0]["id"]
        by_author = add_files(member_client, workspace, doc["id"], "b.pdf").data["results"][0]["id"]
        assert lead_client.delete(h(workspace, f"library/{by_author}/")).status_code == 400
        # the author of the document removes a file somebody else put on it
        assert member_client.delete(h(workspace, f"library/{by_admin}/")).status_code == 204
        assert admin_client.delete(h(workspace, f"library/{by_author}/")).status_code == 204
        assert member_client.get(h(workspace, f"docs/{doc['id']}/")).data["files"] == []

    def test_deleting_a_document_takes_its_files_with_it(self, member_client, storage, workspace):
        doc = make_doc(member_client, workspace)
        file_id = add_files(member_client, workspace, doc["id"], "plan.pdf").data["results"][0]["id"]
        assert member_client.delete(h(workspace, f"docs/{doc['id']}/")).status_code == 204
        assert not HubAttachment.objects.filter(pk=file_id).exists()
        assert member_client.get(h(workspace, f"files/{file_id}/")).status_code == 404

    def test_another_workspace_cannot_reach_the_files(self, member_client, storage, other_workspace, workspace):
        doc = make_doc(member_client, workspace)
        file_id = add_files(member_client, workspace, doc["id"], "plan.pdf").data["results"][0]["id"]
        foreign = make_client(other_workspace.owner)
        assert foreign.get(url(other_workspace, f"hub/files/{file_id}/")).status_code == 404

    def test_unsafe_files_are_refused_for_a_document_too(self, member_client, storage, workspace):
        doc = make_doc(member_client, workspace)
        bad = SimpleUploadedFile("x.exe", b"MZ", content_type="application/octet-stream")
        response = member_client.post(
            h(workspace, "library/"), {"doc": str(doc["id"]), "files": [bad]}, format="multipart"
        )
        assert response.status_code == 400 and not storage.files


@pytest.mark.contract
class TestEveryone:
    def general(self, client, workspace):
        rows = client.get(h(workspace, "channels/")).data["results"]
        return next(row["id"] for row in rows if row["name"] == "General")

    def say(self, client, workspace, channel_id, body):
        return client.post(h(workspace, f"channels/{channel_id}/messages/"), {"body": body}, format="json")

    def test_everyone_in_the_channel_is_tagged_except_the_author(
        self, member_client, member, lead, colleague, workspace
    ):
        channel = self.general(member_client, workspace)
        response = self.say(member_client, workspace, channel, "Meeting at ten @everyone")
        assert response.status_code == 201
        tagged = set(HubMention.objects.filter(message_id=response.data["id"]).values_list("user_id", flat=True))
        assert member.id not in tagged
        assert {lead.id, colleague.id} <= tagged
        notice = OpsNotification.objects.filter(user=lead, kind="MENTION").first()
        assert notice is not None and "tagged everyone" in notice.title

    def test_only_the_members_of_a_project_channel_are_tagged(
        self, member_client, member, colleague, lead, admin, project, workspace
    ):
        rows = member_client.get(h(workspace, "channels/")).data["results"]
        channel = next(row["id"] for row in rows if row["name"] == project.name)
        response = self.say(member_client, workspace, channel, "@everyone look")
        tagged = set(HubMention.objects.filter(message_id=response.data["id"]).values_list("user_id", flat=True))
        # the project's members (its admin included), not the colleague who is not in it
        assert tagged == {colleague.id, admin.id} and lead.id not in tagged

    def test_a_word_that_only_looks_like_it_tags_nobody(self, member_client, workspace):
        channel = self.general(member_client, workspace)
        response = self.say(member_client, workspace, channel, "write to mail@everyone.com or ask everyone")
        assert not HubMention.objects.filter(message_id=response.data["id"]).exists()
