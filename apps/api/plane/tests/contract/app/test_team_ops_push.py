# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F401, F811
"""Push notifications: devices turn them on, new Team Ops notifications reach them."""

import base64
import os
from unittest import mock

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException
from py_vapid import Vapid01

from plane.team_ops.models import OpsNotification, PushSubscription
from plane.team_ops.services import push
from plane.team_ops.services.notifications import notify
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
    member,
    member_client,
    other_workspace,
    outsider,
    outsider_client,
    url,
    workspace,
)

ENDPOINT = "https://push.example.com/send/abc123"
KEYS = {"p256dh": "BPublicKeyOfTheBrowser", "auth": "authsecret"}


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("TEAM_OPS_VAPID_PUBLIC_KEY", "BServerPublicKey")
    monkeypatch.setenv("TEAM_OPS_VAPID_PRIVATE_KEY", "ServerPrivateKey")
    monkeypatch.setenv("TEAM_OPS_VAPID_SUBJECT", "mailto:ops@example.com")


@pytest.fixture
def sender():
    with mock.patch("plane.team_ops.services.push.webpush") as sender:
        yield sender


def subscribe(client, workspace, endpoint=ENDPOINT, **extra):
    return client.post(url(workspace, "push/subscribe/"), {"endpoint": endpoint, "keys": KEYS, **extra}, format="json")


def gone(status_code):
    response = mock.Mock(status_code=status_code)
    return WebPushException("push failed", response=response)


@pytest.mark.contract
class TestPushDevices:
    def test_it_is_off_without_keys(self, member_client, workspace):
        data = member_client.get(url(workspace, "push/")).data

        assert data["enabled"] is False
        assert data["public_key"] == ""

    def test_it_tells_the_browser_the_public_key(self, member_client, workspace, keys):
        data = member_client.get(url(workspace, "push/")).data

        assert data["enabled"] is True
        assert data["public_key"] == "BServerPublicKey"
        assert data["devices"] == []

    def test_a_device_is_added_and_listed(self, member_client, workspace, member, keys):
        response = subscribe(member_client, workspace, device="Chrome on Windows")

        assert response.status_code == 201
        assert [row["device"] for row in response.data["devices"]] == ["Chrome on Windows"]
        assert PushSubscription.objects.get(endpoint=ENDPOINT).user_id == member.id

    def test_the_same_device_twice_is_one_device(self, member_client, workspace, keys):
        subscribe(member_client, workspace)
        subscribe(member_client, workspace)

        assert PushSubscription.objects.filter(endpoint=ENDPOINT).count() == 1

    def test_a_device_moves_to_whoever_signed_in_on_it(self, member_client, lead_client, workspace, lead, keys):
        subscribe(member_client, workspace)
        subscribe(lead_client, workspace)

        assert PushSubscription.objects.get(endpoint=ENDPOINT).user_id == lead.id

    def test_bad_input_is_refused(self, member_client, workspace, keys):
        assert subscribe(member_client, workspace, endpoint="http://plain.example.com/x").status_code == 400
        no_keys = member_client.post(url(workspace, "push/subscribe/"), {"endpoint": ENDPOINT}, format="json")
        assert no_keys.status_code == 400

    def test_subscribing_is_refused_when_push_is_off(self, member_client, workspace):
        assert subscribe(member_client, workspace).status_code == 400

    def test_a_person_turns_off_only_their_own_device(self, member_client, lead_client, workspace, member, keys):
        subscribe(member_client, workspace)
        subscribe(lead_client, workspace, endpoint="https://push.example.com/send/other")

        member_client.post(url(workspace, "push/unsubscribe/"), {"endpoint": "https://push.example.com/send/other"})
        assert PushSubscription.objects.count() == 2

        member_client.post(url(workspace, "push/unsubscribe/"), {"endpoint": ENDPOINT})
        assert [row.endpoint for row in PushSubscription.objects.all()] == ["https://push.example.com/send/other"]

    def test_a_removed_device_can_be_added_again(self, member_client, workspace, keys):
        subscribe(member_client, workspace)
        member_client.post(url(workspace, "push/unsubscribe/"), {"endpoint": ENDPOINT})

        assert subscribe(member_client, workspace).status_code == 201

    def test_a_person_sees_only_their_devices(self, member_client, lead_client, workspace, keys):
        subscribe(lead_client, workspace)

        assert member_client.get(url(workspace, "push/")).data["devices"] == []

    def test_the_test_message_goes_to_the_devices(self, member_client, workspace, keys, sender):
        subscribe(member_client, workspace)

        response = member_client.post(url(workspace, "push/test/"))

        assert response.status_code == 200
        assert response.data["sent"] == 1
        assert sender.call_count == 1
        assert sender.call_args.kwargs["subscription_info"]["endpoint"] == ENDPOINT

    def test_the_test_message_needs_a_device(self, member_client, workspace, keys, sender):
        assert member_client.post(url(workspace, "push/test/")).status_code == 400
        sender.assert_not_called()

    def test_outsiders_are_refused(self, outsider_client, workspace, keys):
        assert outsider_client.get(url(workspace, "push/")).status_code in (401, 403)


@pytest.mark.contract
class TestPushDelivery:
    def deliver_now(self):
        """Run the push task right away instead of through the broker."""
        return mock.patch("plane.team_ops.tasks.deliver_push_task.delay", side_effect=lambda ids: push.deliver(ids))

    def test_a_new_notification_reaches_the_device(
        self, member_client, workspace, member, admin, keys, sender, django_capture_on_commit_callbacks
    ):
        subscribe(member_client, workspace)

        with self.deliver_now(), django_capture_on_commit_callbacks(execute=True):
            notify(
                workspace, [member], OpsNotification.Kind.MENTION, "Ada tagged you", "see this", "team-ops/hub", admin
            )

        assert sender.call_count == 1
        sent = sender.call_args.kwargs
        assert sent["subscription_info"]["endpoint"] == ENDPOINT
        assert sent["vapid_claims"] == {"sub": "mailto:ops@example.com"}
        assert '"title": "Ada tagged you"' in sent["data"]
        assert f'"url": "/{workspace.slug}/team-ops/hub/"' in sent["data"]
        assert sent["headers"] == {"Urgency": "high"}  # delivered at once to a locked phone or a closed app

    def test_nothing_is_queued_when_nobody_turned_push_on(self, workspace, member, admin, keys, sender):
        with self.deliver_now() as delay:
            notify(workspace, [member], OpsNotification.Kind.NEWS, "News", actor=admin)

        delay.assert_not_called()
        sender.assert_not_called()

    def test_nothing_is_queued_when_push_is_off(self, member_client, workspace, member, admin, sender):
        PushSubscription.objects.create(user=member, endpoint=ENDPOINT, p256dh="x", auth="y")

        with self.deliver_now() as delay:
            notify(workspace, [member], OpsNotification.Kind.NEWS, "News", actor=admin)

        delay.assert_not_called()

    def test_a_broker_failure_never_breaks_the_notification(
        self, workspace, member, admin, keys, sender, django_capture_on_commit_callbacks
    ):
        PushSubscription.objects.create(user=member, endpoint=ENDPOINT, p256dh="x", auth="y")

        with mock.patch("plane.team_ops.tasks.deliver_push_task.delay", side_effect=OSError("no broker")):
            with django_capture_on_commit_callbacks(execute=True):
                assert notify(workspace, [member], OpsNotification.Kind.NEWS, "News", actor=admin) == 1

        assert OpsNotification.objects.filter(user=member).count() == 1

    def test_a_device_the_browser_removed_is_forgotten(self, workspace, member, keys, sender):
        PushSubscription.objects.create(user=member, endpoint=ENDPOINT, p256dh="x", auth="y")
        sender.side_effect = gone(410)

        assert push.send_to_user(member.id, {"title": "x"}) == 0

        assert PushSubscription.objects.count() == 0

    def test_a_device_that_keeps_failing_is_dropped_after_a_few_tries(self, workspace, member, keys, sender):
        PushSubscription.objects.create(user=member, endpoint=ENDPOINT, p256dh="x", auth="y")
        sender.side_effect = gone(500)

        for _ in range(push.MAX_FAILURES - 1):
            push.send_to_user(member.id, {"title": "x"})
        assert PushSubscription.objects.get().failures == push.MAX_FAILURES - 1

        push.send_to_user(member.id, {"title": "x"})
        assert PushSubscription.objects.count() == 0

    def test_a_success_clears_the_failures(self, workspace, member, keys, sender):
        row = PushSubscription.objects.create(user=member, endpoint=ENDPOINT, p256dh="x", auth="y", failures=3)

        assert push.send_to_user(member.id, {"title": "x"}) == 1

        row.refresh_from_db()
        assert row.failures == 0
        assert row.last_success_at is not None

    @pytest.mark.parametrize(
        "link, expected",
        [
            ("", "/{slug}/notifications/"),
            ("team-ops/workday", "/{slug}/team-ops/workday/"),
            ("/team-ops/hub/", "/{slug}/team-ops/hub/"),
            ("team-ops/hub?channel=c1", "/{slug}/team-ops/hub/?channel=c1"),
        ],
    )
    def test_the_address_a_notification_opens(self, workspace, link, expected):
        assert push.url_of(workspace, link) == expected.format(slug=workspace.slug)


def _b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


@pytest.mark.contract
class TestPushWithRealKeys:
    """No mocked library: a real key pair, a real browser key, and the request that would be sent."""

    def test_the_message_is_signed_and_encrypted(self, workspace, member, monkeypatch):
        vapid = Vapid01()
        vapid.generate_keys()
        public = vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        private = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
        monkeypatch.setenv("TEAM_OPS_VAPID_PUBLIC_KEY", _b64(public))
        monkeypatch.setenv("TEAM_OPS_VAPID_PRIVATE_KEY", _b64(private))
        monkeypatch.setenv("TEAM_OPS_VAPID_SUBJECT", "mailto:ops@example.com")
        browser = ec.generate_private_key(ec.SECP256R1())
        browser_key = browser.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        row = PushSubscription.objects.create(
            user=member, endpoint=ENDPOINT, p256dh=_b64(browser_key), auth=_b64(os.urandom(16))
        )

        with mock.patch("requests.post") as post:
            post.return_value = mock.Mock(status_code=201, ok=True)
            assert push.send_to_user(member.id, {"title": "Hello"}) == 1

        headers = post.call_args.kwargs["headers"]
        assert headers["Authorization"].startswith("vapid t=")
        assert headers["Content-Encoding"] == "aes128gcm"
        assert b"Hello" not in post.call_args.kwargs["data"]
        row.refresh_from_db()
        assert row.last_success_at is not None

    def test_a_network_error_keeps_the_device_and_goes_on(self, workspace, member, keys, sender):
        PushSubscription.objects.create(user=member, endpoint=ENDPOINT, p256dh="x", auth="y")
        PushSubscription.objects.create(user=member, endpoint=ENDPOINT + "2", p256dh="x", auth="y")
        sender.side_effect = [OSError("unreachable"), None]

        assert push.send_to_user(member.id, {"title": "x"}) == 1

        assert PushSubscription.objects.count() == 2


@pytest.mark.parametrize(
    "configured, expected",
    [
        ("https://plane.5.160.42.168.sslip.io:4433", "https://plane.5.160.42.168.sslip.io"),
        ("https://plane.example.com:4433/some/path/", "https://plane.example.com"),
        ("https://plane.example.com", "https://plane.example.com"),
        ("mailto:ops@example.com", "mailto:ops@example.com"),
        ("ops@example.com", "mailto:ops@example.com"),
        ('"mailto:ops@example.com"', "mailto:ops@example.com"),
        ("", "mailto:admin@localhost"),
    ],
)
def test_the_vapid_subject_is_one_the_push_library_accepts(configured, expected):
    """A subject with a port made every push fail; the library's own check must accept what we send."""
    from unittest import mock

    from py_vapid import _check_sub

    from plane.team_ops.services import push as push_service

    with mock.patch.dict("os.environ", {"TEAM_OPS_VAPID_SUBJECT": configured}):
        subject = push_service._subject()
    assert subject == expected
    assert _check_sub(subject)
