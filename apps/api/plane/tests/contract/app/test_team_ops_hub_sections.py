# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Hub sections: General, News, private messages, Doc Hub, Files, Secrets, and Flows."""

from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status

from plane.db.models import Issue, IssueAssignee, State
from plane.team_ops.models import HubChannel, HubSecret, HubSecretLog, OpsNotification
from plane.team_ops.services import secrets as secret_service
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
    make_module,
    make_project,
    make_team,
    make_user,
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
    return make_project(workspace, admin, "HB", members=[member, colleague])


def h(workspace, path=""):
    return url(workspace, f"hub/{path}")


def channels(client, workspace):
    return {row["name"]: row for row in client.get(h(workspace, "channels/")).data["results"]}


def post(client, workspace, channel_id, body, **extra):
    return client.post(h(workspace, f"channels/{channel_id}/messages/"), {"body": body, **extra}, format="json")


def pdf(name="a.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 x", content_type="application/pdf")


@pytest.mark.contract
class TestGeneralAndNews:
    def test_everyone_has_general_and_news(self, member_client, colleague, workspace):
        rows = channels(member_client, workspace)
        assert {"General", "News"} <= set(rows)
        assert rows["General"]["can_post"] is True and rows["News"]["can_post"] is False

    def test_guests_have_no_hub(self, guest_client, workspace):
        assert guest_client.get(h(workspace, "channels/")).status_code == 403

    def test_general_is_open_to_all_members(self, member_client, colleague, workspace):
        general = channels(member_client, workspace)["General"]["id"]
        assert post(member_client, workspace, general, "hello all").status_code == 201
        assert channels(make_client(colleague), workspace)["General"]["unread"] == 1

    def test_only_admins_write_news_and_everyone_is_notified(self, admin_client, member_client, member, workspace):
        news = channels(member_client, workspace)["News"]["id"]
        assert post(member_client, workspace, news, "fake news").status_code == 403
        assert not post(member_client, workspace, news, "x").data.get("id")
        assert post(admin_client, workspace, news, "Office closed Friday").status_code == 201
        assert OpsNotification.objects.filter(user=member, kind="NEWS").count() == 1
        assert channels(member_client, workspace)["News"]["can_post"] is False
        assert channels(admin_client, workspace)["News"]["can_post"] is True

    def test_general_and_news_exist_once(self, member_client, admin_client, workspace):
        channels(member_client, workspace)
        channels(admin_client, workspace)
        assert HubChannel.objects.filter(workspace=workspace, kind="GENERAL").count() == 1
        assert HubChannel.objects.filter(workspace=workspace, kind="NEWS").count() == 1


@pytest.mark.contract
class TestPrivateMessages:
    def test_any_two_people_can_talk_even_the_admin(self, member_client, admin, member, workspace):
        response = member_client.post(h(workspace, "direct/"), {"user": str(admin.id)}, format="json")
        assert response.status_code == 200 and response.data["name"] == admin.display_name
        assert post(member_client, workspace, response.data["id"], "hi boss").status_code == 201

    def test_the_other_person_sees_it_and_is_notified(self, member_client, admin_client, admin, member, workspace):
        dm = member_client.post(h(workspace, "direct/"), {"user": str(admin.id)}, format="json").data["id"]
        post(member_client, workspace, dm, "hi")
        mine = channels(admin_client, workspace)
        assert member.display_name in mine and mine[member.display_name]["kind"] == "DM"
        assert OpsNotification.objects.filter(user=admin, kind="DIRECT").count() == 1

    def test_same_pair_same_channel(self, member_client, admin_client, admin, member, workspace):
        first = member_client.post(h(workspace, "direct/"), {"user": str(admin.id)}, format="json").data["id"]
        second = admin_client.post(h(workspace, "direct/"), {"user": str(member.id)}, format="json").data["id"]
        assert first == second

    def test_nobody_else_can_read_it(self, member_client, colleague, admin, workspace):
        dm = member_client.post(h(workspace, "direct/"), {"user": str(admin.id)}, format="json").data["id"]
        post(member_client, workspace, dm, "secret plan")
        spy = make_client(colleague)
        assert spy.get(h(workspace, f"channels/{dm}/messages/")).status_code == 404
        assert post(spy, workspace, dm, "boo").status_code == 404

    def test_not_with_yourself_guests_or_other_workspaces(
        self, member_client, member, guest, workspace, other_workspace
    ):
        assert member_client.post(h(workspace, "direct/"), {"user": str(member.id)}, format="json").status_code == 400
        assert member_client.post(h(workspace, "direct/"), {"user": str(guest.id)}, format="json").status_code == 400
        stranger = other_workspace.owner
        assert member_client.post(h(workspace, "direct/"), {"user": str(stranger.id)}, format="json").status_code == 400

    def test_people_list(self, member_client, member, workspace):
        names = {p["id"] for p in member_client.get(h(workspace, "people/")).data["results"]}
        assert member.id not in names and len(names) >= 3


@pytest.mark.contract
class TestDocHub:
    def test_write_tag_and_find(self, member_client, project, workspace):
        response = member_client.post(
            h(workspace, "docs/"),
            {
                "title": "Deploy runbook",
                "body": "Steps...",
                "tags": ["Ops", "runbook", "ops"],
                "project": str(project.id),
            },
            format="json",
        )
        assert response.status_code == 201 and response.data["tags"] == ["ops", "runbook"]
        listing = member_client.get(h(workspace, "docs/"), {"tag": "ops"}).data
        assert [d["title"] for d in listing["results"]] == ["Deploy runbook"] and listing["tags"] == ["ops", "runbook"]
        assert member_client.get(h(workspace, "docs/"), {"q": "zzz"}).data["results"] == []
        assert len(member_client.get(h(workspace, "docs/"), {"project": str(project.id)}).data["results"]) == 1

    def test_project_docs_are_for_project_members(self, member_client, lead_client, admin_client, project, workspace):
        doc = member_client.post(
            h(workspace, "docs/"), {"title": "Internal", "project": str(project.id)}, format="json"
        ).data
        assert lead_client.get(h(workspace, f"docs/{doc['id']}/")).status_code == 404
        assert lead_client.get(h(workspace, "docs/")).data["results"] == []
        assert admin_client.get(h(workspace, f"docs/{doc['id']}/")).status_code == 200

    def test_docs_without_a_project_are_open(self, member_client, lead_client, workspace):
        doc = member_client.post(h(workspace, "docs/"), {"title": "Welcome"}, format="json").data
        assert lead_client.get(h(workspace, f"docs/{doc['id']}/")).data["title"] == "Welcome"

    def test_cannot_tie_a_doc_to_someone_elses_project(self, lead_client, project, workspace):
        response = lead_client.post(h(workspace, "docs/"), {"title": "X", "project": str(project.id)}, format="json")
        assert response.status_code == 400

    def test_only_the_author_or_an_admin_changes_it(self, member_client, lead_client, admin_client, workspace):
        doc = member_client.post(h(workspace, "docs/"), {"title": "Mine"}, format="json").data
        path = h(workspace, f"docs/{doc['id']}/")
        assert lead_client.patch(path, {"title": "hacked"}, format="json").status_code == 400
        assert lead_client.delete(path).status_code == 400
        assert member_client.patch(path, {"title": "Mine v2", "tags": ["a"]}, format="json").data["title"] == "Mine v2"
        assert admin_client.delete(path).status_code == 204

    def test_a_project_doc_is_written_as_a_plane_page(self, member_client, project, workspace):
        from plane.db.models import Page, ProjectPage

        payload = {"title": "Runbook", "body": "Step 1 <b>\nStep 2", "project": str(project.id)}
        doc = member_client.post(h(workspace, "docs/"), payload, format="json").data
        page = Page.objects.get(pk=doc["page"])
        assert page.name == "Runbook"
        assert page.description_html == "<p>Step 1 &lt;b&gt;</p><p>Step 2</p>"
        assert ProjectPage.objects.filter(page=page, project=project).exists()
        # the text now lives in the Page; the hub text is not changed from here
        path = h(workspace, f"docs/{doc['id']}/")
        changed = member_client.patch(path, {"title": "Runbook 2", "body": "ignored"}, format="json").data
        page.refresh_from_db()
        assert page.name == "Runbook 2"
        assert changed["page"] == doc["page"]

    def test_a_doc_without_a_project_has_no_page(self, member_client, workspace):
        doc = member_client.post(h(workspace, "docs/"), {"title": "Welcome", "body": "hi"}, format="json").data
        assert doc["page"] is None
        assert doc["body"] == "hi"

    def test_giving_a_doc_a_project_later_makes_its_page(self, member_client, project, workspace):
        doc = member_client.post(h(workspace, "docs/"), {"title": "Late", "body": "text"}, format="json").data
        path = h(workspace, f"docs/{doc['id']}/")
        changed = member_client.patch(path, {"project": str(project.id)}, format="json").data
        assert changed["page"] is not None

    def test_title_is_required(self, member_client, workspace):
        assert member_client.post(h(workspace, "docs/"), {"title": " "}, format="json").status_code == 400


@pytest.mark.contract
class TestFilesLibrary:
    def test_share_with_the_workspace_and_download(self, member_client, lead_client, storage, workspace):
        response = member_client.post(h(workspace, "library/"), {"files": [pdf()]}, format="multipart")
        assert response.status_code == 201
        file_id = response.data["results"][0]["id"]
        assert [f["name"] for f in lead_client.get(h(workspace, "library/")).data["results"]] == ["a.pdf"]
        link = lead_client.get(h(workspace, f"files/{file_id}/"))
        assert link.status_code == 200 and "expires=300" in link.data["url"]

    def test_unsafe_files_are_refused(self, member_client, storage, workspace):
        bad = SimpleUploadedFile("x.exe", b"MZ", content_type="application/octet-stream")
        assert member_client.post(h(workspace, "library/"), {"files": [bad]}, format="multipart").status_code == 400
        assert member_client.post(h(workspace, "library/"), {}, format="multipart").status_code == 400
        assert not storage.files

    def test_the_list_includes_files_from_my_channels_only(
        self, member_client, lead_client, project, storage, workspace
    ):
        wd = channels(member_client, workspace)[project.name]["id"]
        member_client.post(
            h(workspace, f"channels/{wd}/messages/"), {"body": "see", "files": [pdf("proj.pdf")]}, format="multipart"
        )
        mine = member_client.get(h(workspace, "library/")).data["results"]
        assert [(f["name"], f["source"]) for f in mine] == [("proj.pdf", project.name)]
        assert lead_client.get(h(workspace, "library/")).data["results"] == []

    def test_other_workspaces_and_guests(self, member_client, guest_client, storage, other_workspace, workspace):
        file_id = member_client.post(h(workspace, "library/"), {"files": [pdf()]}, format="multipart").data["results"][
            0
        ]["id"]
        foreign = make_client(other_workspace.owner)
        assert foreign.get(url(other_workspace, f"hub/files/{file_id}/")).status_code == 404
        assert guest_client.get(h(workspace, f"files/{file_id}/")).status_code == 403

    def test_only_the_uploader_or_an_admin_removes_it(
        self, member_client, lead_client, admin_client, storage, workspace
    ):
        file_id = member_client.post(h(workspace, "library/"), {"files": [pdf()]}, format="multipart").data["results"][
            0
        ]["id"]
        assert lead_client.delete(h(workspace, f"library/{file_id}/")).status_code == 400
        assert admin_client.delete(h(workspace, f"library/{file_id}/")).status_code == 204


@pytest.mark.contract
class TestSecrets:
    """End-to-end: the browser encrypts. These tests send stand-in base64 blobs, as the browser would."""

    CIPHER = "Y2lwaGVydGV4dA=="  # "ciphertext"
    IV = "bm9uY2Vub25jZTEy"
    OWNER = "b3duZXIta2V5"
    LEAD_KEY = "bGVhZC1rZXk="

    @staticmethod
    def vault(client, workspace, public="cHVibGljLWtleQ=="):
        return client.post(
            h(workspace, "vault/"),
            {"public_key": public, "private_key": "bG9ja2Vk", "salt": "c2FsdA==", "iv": "aXY=", "iterations": 600000},
            format="json",
        )

    def make(self, client, workspace, **extra):
        self.vault(client, workspace)
        return client.post(
            h(workspace, "secrets/"),
            {
                "name": "DB password",
                "description": "prod",
                "kind": "LOGIN",
                "ciphertext": self.CIPHER,
                "iv": self.IV,
                "owner_key": self.OWNER,
                **extra,
            },
            format="json",
        )

    def test_the_server_only_stores_what_the_browser_sealed(self, member_client, workspace):
        response = self.make(member_client, workspace)
        assert response.status_code == 201 and "ciphertext" not in response.data
        stored = HubSecret.objects.get()
        assert stored.e2e and stored.kind == "LOGIN" and stored.ciphertext == self.CIPHER
        assert self.CIPHER not in str(member_client.get(h(workspace, "secrets/")).data)

    def test_a_value_in_the_clear_is_refused(self, member_client, workspace):
        response = self.make(member_client, workspace, value="s3cr3t!")
        assert response.status_code == 400 and HubSecret.objects.count() == 0

    def test_a_vault_is_needed_first(self, member_client, workspace):
        response = member_client.post(
            h(workspace, "secrets/"),
            {"name": "x", "ciphertext": self.CIPHER, "iv": self.IV, "owner_key": self.OWNER},
            format="json",
        )
        assert response.status_code == 400

    def test_bad_blobs_and_names_are_refused(self, member_client, workspace):
        assert self.make(member_client, workspace, ciphertext="not base64!").status_code == 400
        assert self.make(member_client, workspace, name="").status_code == 400
        assert self.make(member_client, workspace, kind="OTHER").status_code == 400

    def test_the_publisher_gets_the_sealed_value_and_it_is_logged(self, member_client, workspace):
        secret = self.make(member_client, workspace).data["id"]
        response = member_client.post(h(workspace, f"secrets/{secret}/reveal/"))
        assert response.data == {
            "e2e": True,
            "kind": "LOGIN",
            "ciphertext": self.CIPHER,
            "iv": self.IV,
            "key": self.OWNER,
        }
        assert response["Cache-Control"] == "no-store"
        assert HubSecretLog.objects.filter(action="REVEAL").count() == 1

    def test_nobody_else_sees_it_not_even_the_admin(self, member_client, admin_client, lead_client, workspace):
        secret = self.make(member_client, workspace).data["id"]
        for other in (admin_client, lead_client):
            assert other.get(h(workspace, "secrets/")).data["results"] == []
            assert other.post(h(workspace, f"secrets/{secret}/reveal/")).status_code == 404
            assert other.patch(h(workspace, f"secrets/{secret}/"), {"name": "x"}, format="json").status_code == 404
            assert other.delete(h(workspace, f"secrets/{secret}/")).status_code == 404
            assert other.put(h(workspace, f"secrets/{secret}/access/"), {"users": []}, format="json").status_code == 404
            assert other.post(h(workspace, f"secrets/{secret}/convert/"), {}, format="json").status_code == 404
        assert HubSecretLog.objects.filter(action="REVEAL").count() == 0

    def test_a_reader_gets_their_own_wrapped_key(self, member_client, lead_client, lead, admin_client, workspace):
        self.vault(lead_client, workspace, public="bGVhZC1wdWI=")
        secret = self.make(member_client, workspace).data["id"]
        keys = member_client.get(h(workspace, f"vault/keys/?users={lead.id}")).data["keys"]
        assert keys == {str(lead.id): "bGVhZC1wdWI="}
        response = member_client.put(
            h(workspace, f"secrets/{secret}/access/"),
            {"users": [str(lead.id)], "keys": {str(lead.id): self.LEAD_KEY}},
            format="json",
        )
        assert response.status_code == 200 and response.data["shared_with"] == [str(lead.id)]
        assert response.data["waiting"] == [] and response.data["owner_key"] == self.OWNER
        assert OpsNotification.objects.filter(user=lead, kind="SECRET").count() == 1
        seen = lead_client.get(h(workspace, "secrets/")).data["results"]
        assert len(seen) == 1 and seen[0]["is_publisher"] is False and seen[0]["is_waiting"] is False
        assert "shared_with" not in seen[0] and "owner_key" not in seen[0]
        assert lead_client.post(h(workspace, f"secrets/{secret}/reveal/")).data["key"] == self.LEAD_KEY
        # a reader cannot pass it on or change it
        assert (
            lead_client.put(h(workspace, f"secrets/{secret}/access/"), {"users": []}, format="json").status_code == 404
        )
        assert lead_client.patch(h(workspace, f"secrets/{secret}/"), {"name": "x"}, format="json").status_code == 404
        assert admin_client.post(h(workspace, f"secrets/{secret}/reveal/")).status_code == 404

    def test_someone_without_a_vault_waits_until_the_publisher_wraps_their_key(
        self, member_client, lead_client, lead, workspace
    ):
        secret = self.make(member_client, workspace, users=[str(lead.id)]).data["id"]
        assert lead_client.get(h(workspace, "secrets/")).data["results"][0]["is_waiting"] is True
        assert lead_client.post(h(workspace, f"secrets/{secret}/reveal/")).status_code == 400
        # nothing to do for the publisher until the reader has a vault
        assert member_client.get(h(workspace, "vault/pending/")).data["results"] == []
        self.vault(lead_client, workspace, public="bGVhZC1wdWI=")
        waiting = member_client.get(h(workspace, "vault/pending/")).data["results"]
        assert waiting == [
            {"secret": str(secret), "user": str(lead.id), "owner_key": self.OWNER, "public_key": "bGVhZC1wdWI="}
        ]
        items = [{"secret": str(secret), "user": str(lead.id), "wrapped_key": self.LEAD_KEY}]
        assert member_client.post(h(workspace, "vault/pending/"), {"items": items}, format="json").data["done"] == 1
        assert lead_client.post(h(workspace, f"secrets/{secret}/reveal/")).data["key"] == self.LEAD_KEY
        # a reader cannot fill keys for someone else's secret
        assert lead_client.post(h(workspace, "vault/pending/"), {"items": items}, format="json").data["done"] == 0

    def test_access_can_be_taken_back(self, member_client, lead_client, lead, workspace):
        self.vault(lead_client, workspace)
        secret = self.make(member_client, workspace, users=[str(lead.id)], keys={str(lead.id): self.LEAD_KEY})
        secret = secret.data["id"]
        assert lead_client.post(h(workspace, f"secrets/{secret}/reveal/")).status_code == 200
        member_client.put(h(workspace, f"secrets/{secret}/access/"), {"users": []}, format="json")
        assert lead_client.post(h(workspace, f"secrets/{secret}/reveal/")).status_code == 404
        actions = list(HubSecretLog.objects.values_list("action", flat=True))
        assert "GRANT" in actions and "REVOKE" in actions

    def test_log_is_for_the_publisher_and_has_no_value(self, member_client, lead_client, lead, workspace):
        self.vault(lead_client, workspace)
        secret = self.make(member_client, workspace, users=[str(lead.id)], keys={str(lead.id): self.LEAD_KEY})
        secret = secret.data["id"]
        lead_client.post(h(workspace, f"secrets/{secret}/reveal/"))
        log = member_client.get(h(workspace, f"secrets/{secret}/access/"))
        actions = [row["action"] for row in log.data["results"]]
        assert actions[0] == "REVEAL" and {"GRANT", "CREATE"} == set(actions[1:3])
        assert self.CIPHER not in str(log.data)
        assert lead_client.get(h(workspace, f"secrets/{secret}/access/")).status_code == 404

    def test_can_only_share_with_colleagues(self, member_client, guest, other_workspace, workspace):
        secret = self.make(member_client, workspace).data["id"]
        for user in (guest, other_workspace.owner):
            response = member_client.put(
                h(workspace, f"secrets/{secret}/access/"), {"users": [str(user.id)]}, format="json"
            )
            assert response.status_code == 400
        assert member_client.get(h(workspace, f"vault/keys/?users={other_workspace.owner.id}")).data["keys"] == {}

    def test_a_new_value_comes_with_new_keys(self, member_client, lead_client, lead, workspace):
        self.vault(lead_client, workspace)
        secret = self.make(member_client, workspace, users=[str(lead.id)], keys={str(lead.id): self.LEAD_KEY})
        secret = secret.data["id"]
        response = member_client.patch(
            h(workspace, f"secrets/{secret}/"),
            {"name": "DB", "kind": "SECRET", "ciphertext": "bmV3", "iv": self.IV, "owner_key": "bmV3LW93bmVy"},
            format="json",
        )
        # no new key was sent for the reader: they wait for it
        assert response.data["name"] == "DB" and response.data["waiting"] == [str(lead.id)]
        assert member_client.post(h(workspace, f"secrets/{secret}/reveal/")).data["ciphertext"] == "bmV3"
        assert (
            member_client.patch(h(workspace, f"secrets/{secret}/"), {"value": "plain"}, format="json").status_code
            == 400
        )

    def test_old_secrets_are_read_the_old_way_then_converted(self, member, member_client, lead, lead_client, workspace):
        old = HubSecret.objects.create(
            workspace=workspace, publisher=member, name="Old", ciphertext=secret_service.encrypt("s3cr3t!")
        )
        member_client.put(h(workspace, f"secrets/{old.id}/access/"), {"users": [str(lead.id)]}, format="json")
        assert lead_client.post(h(workspace, f"secrets/{old.id}/reveal/")).data == {"e2e": False, "value": "s3cr3t!"}
        assert member_client.get(h(workspace, "secrets/")).data["results"][0]["e2e"] is False
        self.vault(member_client, workspace)
        payload = {"kind": "SECRET", "ciphertext": self.CIPHER, "iv": self.IV, "owner_key": self.OWNER}
        response = member_client.post(h(workspace, f"secrets/{old.id}/convert/"), payload, format="json")
        assert response.status_code == 200 and response.data["e2e"] is True
        old.refresh_from_db()
        assert old.ciphertext == self.CIPHER and "gAAAA" not in old.ciphertext
        # the reader had no vault: they wait for their key
        assert response.data["waiting"] == [str(lead.id)]
        again = member_client.post(h(workspace, f"secrets/{old.id}/convert/"), payload, format="json")
        assert again.status_code == 400

    def test_a_wrong_server_key_does_not_leak_old_secrets(self, member, member_client, workspace):
        old = HubSecret.objects.create(
            workspace=workspace, publisher=member, name="Old", ciphertext=secret_service.encrypt("s3cr3t!")
        )
        with mock.patch.dict("os.environ", {"TEAM_OPS_SECRET_KEY": "8w1o6mZyVJvX8s0Rk1y5l2m3n4o5p6q7r8s9t0u1v2w="}):
            assert member_client.post(h(workspace, f"secrets/{old.id}/reveal/")).status_code == 400

    def test_the_vault(self, member_client, workspace):
        assert member_client.get(h(workspace, "vault/")).data["vault"] is None
        assert self.vault(member_client, workspace).status_code == 201
        assert self.vault(member_client, workspace).status_code == 400  # only one
        vault = member_client.get(h(workspace, "vault/"))
        assert vault.data["vault"]["iterations"] == 600000 and vault["Cache-Control"] == "no-store"
        changed = {**vault.data["vault"], "private_key": "bmV3LWxvY2s=", "salt": "bmV3LXNhbHQ="}
        assert member_client.put(h(workspace, "vault/"), changed, format="json").status_code == 200
        assert member_client.get(h(workspace, "vault/")).data["vault"]["private_key"] == "bmV3LWxvY2s="
        # the key pair itself cannot be swapped by a passphrase change
        swapped = {**changed, "public_key": "b3RoZXI="}
        assert member_client.put(h(workspace, "vault/"), swapped, format="json").status_code == 400

    def test_a_weak_passphrase_stretch_is_refused(self, member_client, workspace):
        response = member_client.post(
            h(workspace, "vault/"),
            {"public_key": "cHVi", "private_key": "bG9ja2Vk", "salt": "c2FsdA==", "iv": "aXY=", "iterations": 1000},
            format="json",
        )
        assert response.status_code == 400

    def test_resetting_the_vault(self, member_client, lead_client, lead, workspace):
        self.vault(lead_client, workspace)
        lead_secret = self.make(lead_client, workspace).data["id"]
        mine = self.make(member_client, workspace, users=[str(lead.id)], keys={str(lead.id): self.LEAD_KEY})
        mine = mine.data["id"]
        result = lead_client.delete(h(workspace, "vault/")).data
        assert result == {"deleted": 1, "waiting": 1}
        assert not HubSecret.objects.filter(pk=lead_secret).exists()
        assert lead_client.get(h(workspace, "vault/")).data["vault"] is None
        assert lead_client.get(h(workspace, "secrets/")).data["results"][0]["is_waiting"] is True
        assert member_client.get(h(workspace, "secrets/")).data["results"][0]["id"] == mine

    def test_other_workspaces_cannot_reach_it(self, member_client, other_workspace, workspace):
        secret = self.make(member_client, workspace).data["id"]
        foreign = make_client(other_workspace.owner)
        assert foreign.post(url(other_workspace, f"hub/secrets/{secret}/reveal/")).status_code == 404

    def test_guests_have_no_secrets(self, guest_client, workspace):
        assert guest_client.get(h(workspace, "secrets/")).status_code == 403
        assert guest_client.get(h(workspace, "vault/")).status_code == 403


@pytest.mark.contract
class TestFlows:
    def stages(self, *groups):
        return [{"name": f"Stage {i + 1}", "modules": [str(m.id) for m in group]} for i, group in enumerate(groups)]

    def flow(self, client, workspace, project, *groups):
        return client.post(
            url(workspace, "teamflow/flows/"),
            {"project": str(project.id), "name": "Release", "stages": self.stages(*groups)},
            format="json",
        )

    def task(self, workspace, project, user, done):
        group = "completed" if done else "unstarted"
        state = State.objects.filter(project=project, group=group).first() or State.objects.create(
            name="Done" if done else "Todo", group=group, project=project, workspace=workspace
        )
        item = Issue.objects.create(name="t", project=project, workspace=workspace, state=state)
        IssueAssignee.objects.create(issue=item, assignee=user, project=project, workspace=workspace)
        return item

    def test_people_of_the_project_and_admins_draw_flows(
        self, member_client, lead_client, admin_client, project, member, workspace
    ):
        one = make_module(workspace, project, "One")
        two = make_module(workspace, project, "Two")
        assert self.flow(lead_client, workspace, project, [one]).status_code == 403  # not in the project
        assert self.flow(member_client, workspace, project, [one]).status_code == 201
        response = self.flow(admin_client, workspace, project, [one], [two])
        assert response.status_code == 201 and [s["name"] for s in response.data["stages"]] == ["Stage 1", "Stage 2"]

    def test_a_stage_is_as_far_as_its_modules(self, admin_client, project, member, colleague, workspace):
        a, b = self.task(workspace, project, member, True), self.task(workspace, project, member, False)
        c = self.task(workspace, project, colleague, True)
        build = make_module(workspace, project, "Build", lead=member, issues=[a, b])
        test = make_module(workspace, project, "Test", members=[colleague], issues=[c])
        flow = self.flow(admin_client, workspace, project, [build], [test]).data
        first, second = flow["stages"]
        assert first["percent"] == 50 and first["pending"] is False
        assert first["modules"][0]["percent"] == 50 and first["modules"][0]["name"] == "Build"
        assert [p["id"] for p in first["modules"][0]["people"]] == [member.id]
        assert second["pending"] is True and second["modules"][0]["percent"] == 100

    def test_several_modules_in_a_stage_add_up(self, admin_client, project, member, workspace):
        done, open_ = self.task(workspace, project, member, True), self.task(workspace, project, member, False)
        one = make_module(workspace, project, "One", issues=[done])
        two = make_module(workspace, project, "Two", issues=[open_, self.task(workspace, project, member, False)])
        stage = self.flow(admin_client, workspace, project, [one, two]).data["stages"][0]
        assert (stage["done"], stage["total"], stage["percent"]) == (1, 3, 33)

    def test_the_next_stage_starts_when_the_previous_is_done(self, admin_client, project, member, workspace):
        first = make_module(workspace, project, "A", issues=[self.task(workspace, project, member, True)])
        second = make_module(workspace, project, "B")
        flow = self.flow(admin_client, workspace, project, [first], [second]).data
        assert flow["stages"][0]["percent"] == 100 and flow["stages"][1]["pending"] is False

    def test_modules_without_tasks_have_no_percent_and_block_the_next_stage(self, admin_client, project, workspace):
        flow = self.flow(
            admin_client,
            workspace,
            project,
            [make_module(workspace, project, "A")],
            [make_module(workspace, project, "B")],
        ).data
        assert flow["stages"][0]["modules"][0]["percent"] is None and flow["stages"][1]["pending"] is True

    def test_people_come_from_the_module_and_its_tasks(self, admin_client, project, member, colleague, lead, workspace):
        item = self.task(workspace, project, colleague, False)
        module = make_module(workspace, project, "A", lead=member, issues=[item])
        stage = self.flow(admin_client, workspace, project, [module]).data["stages"][0]
        assert {p["id"] for p in stage["modules"][0]["people"]} == {member.id, colleague.id}

    def test_validation(self, admin_client, project, workspace, admin):
        mine = make_module(workspace, project, "Mine")
        other_project = make_project(workspace, admin, "OT")
        foreign = make_module(workspace, other_project, "Foreign")
        bad_cases = [
            [],  # no stages
            [[]],  # empty stage
            [[mine], [mine]],  # the same module twice
            [[foreign]],  # a module of another project
        ]
        for groups in bad_cases:
            assert self.flow(admin_client, workspace, project, *groups).status_code == 400
        blank = admin_client.post(
            url(workspace, "teamflow/flows/"),
            {"project": str(project.id), "name": " ", "stages": self.stages([mine])},
            format="json",
        )
        assert blank.status_code == 400

    def test_members_see_flows_of_their_projects_only(
        self, admin_client, member_client, lead_client, project, workspace
    ):
        self.flow(admin_client, workspace, project, [make_module(workspace, project)])
        assert len(member_client.get(url(workspace, "teamflow/flows/")).data["results"]) == 1
        assert lead_client.get(url(workspace, "teamflow/flows/")).data["results"] == []
        assert member_client.get(url(workspace, "teamflow/flows/")).data["can_manage"] is True

    def test_edit_and_delete(self, admin_client, member_client, lead_client, project, workspace):
        one, two = make_module(workspace, project, "One"), make_module(workspace, project, "Two")
        flow = self.flow(admin_client, workspace, project, [one]).data
        path = url(workspace, f"teamflow/flows/{flow['id']}/")
        changed = admin_client.put(path, {"name": "Release 2", "stages": self.stages([one], [two])}, format="json")
        assert changed.status_code == 200 and len(changed.data["stages"]) == 2 and changed.data["name"] == "Release 2"
        assert lead_client.put(path, {"name": "x", "stages": []}, format="json").status_code == 403
        assert lead_client.delete(path).status_code == 403
        assert (
            member_client.put(path, {"name": "x", "stages": []}, format="json").status_code == 400
        )  # allowed, invalid
        assert member_client.delete(path).status_code == 204

    def test_the_modules_of_a_project_with_their_people(
        self, admin_client, member_client, lead_client, project, member, workspace
    ):
        make_module(workspace, project, "Alpha", lead=member)
        query = {"project": str(project.id)}
        rows = admin_client.get(url(workspace, "teamflow/flows/modules/"), query).data["results"]
        assert [r["name"] for r in rows] == ["Alpha"] and [p["id"] for p in rows[0]["people"]] == [member.id]
        assert len(member_client.get(url(workspace, "teamflow/flows/modules/"), query).data["results"]) == 1
        assert lead_client.get(url(workspace, "teamflow/flows/modules/"), query).status_code == 403
