# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.exceptions import ParseError
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission
from plane.app.views.base import BaseAPIView
from plane.team_ops.models import PushSubscription
from plane.team_ops.services import push
from plane.team_ops.services.access import CALENDAR_ROLES


def _device(request):
    """A short label for the device, from what the browser says it is."""
    given = str(request.data.get("device") or "").strip()
    return (given or request.META.get("HTTP_USER_AGENT", ""))[:200]


def _devices(user):
    return [
        {
            "id": row.id,
            "device": row.device,
            "created_at": row.created_at,
            "last_success_at": row.last_success_at,
        }
        for row in PushSubscription.objects.filter(user=user)
    ]


class PushConfigEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Whether push is set up on this server, the public key the browser needs, and the person's devices."""
        enabled = push.is_enabled()
        return Response(
            {
                "enabled": enabled,
                "public_key": push.public_key() if enabled else "",
                "devices": _devices(request.user),
            }
        )


class PushSubscribeEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Turn push on for this browser or phone. `endpoint` and `keys` are what the browser returned."""
        if not push.is_enabled():
            raise ParseError(detail="Push notifications are not set up on this server.")
        data = request.data
        endpoint = str(data.get("endpoint") or "").strip()
        keys = data.get("keys") or {}
        p256dh = str(keys.get("p256dh") or "").strip()
        auth = str(keys.get("auth") or "").strip()
        if not endpoint.startswith("https://") or len(endpoint) > 1000:
            raise ParseError(detail="This browser gave an address that cannot be used.")
        if not p256dh or not auth or len(p256dh) > 200 or len(auth) > 100:
            raise ParseError(detail="The browser did not give its keys.")
        # One browser belongs to one person: signing in as someone else on it moves the subscription.
        row = PushSubscription.objects.filter(endpoint=endpoint).first()
        if row is None:
            row = PushSubscription(endpoint=endpoint)
        row.user = request.user
        row.p256dh = p256dh
        row.auth = auth
        row.device = _device(request)
        row.failures = 0
        row.save()
        return Response({"devices": _devices(request.user)}, status=status.HTTP_201_CREATED)


class PushUnsubscribeEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Turn push off for one device of the caller, by `endpoint` or `id`."""
        mine = PushSubscription.objects.filter(user=request.user)
        if request.data.get("endpoint"):
            mine = mine.filter(endpoint=str(request.data["endpoint"]))
        elif request.data.get("id"):
            mine = mine.filter(pk=str(request.data["id"]))
        else:
            raise ParseError(detail="Say which device.")
        for row in mine:
            row.delete()
        return Response({"devices": _devices(request.user)})


class PushTestEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Send a test notification to the caller's devices."""
        if not push.is_enabled():
            raise ParseError(detail="Push notifications are not set up on this server.")
        if not PushSubscription.objects.filter(user=request.user).exists():
            raise ParseError(detail="Turn notifications on for this device first.")
        sent = push.send_to_user(
            request.user.id,
            {
                "id": "test",
                "kind": "TEST",
                "title": "Notifications are on",
                "body": "You will see Team Ops notifications here, also when the app is closed.",
                "url": f"/{slug}/notifications/",
                "tag": "team-ops-test",
            },
        )
        return Response({"sent": sent, "devices": _devices(request.user)})
