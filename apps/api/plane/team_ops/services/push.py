# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Web Push: Team Ops notifications on a person's browser and phone, also when the app is closed.

The keys are a VAPID pair (see `manage.py team_ops_vapid_keys`), set in the environment as
`TEAM_OPS_VAPID_PUBLIC_KEY`, `TEAM_OPS_VAPID_PRIVATE_KEY` and `TEAM_OPS_VAPID_SUBJECT` (a `mailto:` address).
Without them the feature is off and nothing is sent.
"""

# Python imports
import json
import logging
import os

# Django imports
from django.utils import timezone

# Third party imports
from pywebpush import WebPushException, webpush

# Module imports
from plane.team_ops.models import OpsNotification, PushSubscription

logger = logging.getLogger("plane.team_ops")

MAX_FAILURES = 5


def public_key():
    return os.environ.get("TEAM_OPS_VAPID_PUBLIC_KEY", "").strip()


def is_enabled():
    return bool(public_key() and os.environ.get("TEAM_OPS_VAPID_PRIVATE_KEY", "").strip())


def _subject():
    return os.environ.get("TEAM_OPS_VAPID_SUBJECT", "").strip() or "mailto:admin@localhost"


def url_of(workspace, link):
    """The address a notification opens: a path inside the app, with the workspace in front."""
    path, _, query = (link or "").lstrip("/").partition("?")
    base = f"/{workspace.slug}/{path.strip('/') or 'notifications'}/"
    return f"{base}?{query}" if query else base


def payload_of(notification):
    return {
        "id": str(notification.id),
        "kind": notification.kind,
        "title": notification.title,
        "body": notification.body[:200],
        "url": url_of(notification.workspace, notification.link),
        # a newer notification of the same kind replaces the one still on screen
        "tag": f"team-ops-{notification.kind.lower()}",
    }


def has_subscribers(user_ids):
    return is_enabled() and PushSubscription.objects.filter(user_id__in=list(user_ids)).exists()


def _send(subscription, data):
    """One delivery. Returns True when the push service accepted it."""
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(data),
            vapid_private_key=os.environ.get("TEAM_OPS_VAPID_PRIVATE_KEY", "").strip(),
            vapid_claims={"sub": _subject()},
            ttl=24 * 3600,
        )
    except WebPushException as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        # 404 and 410: the browser or phone removed the subscription for good
        if status in (404, 410):
            subscription.delete()
            return False
        subscription.failures += 1
        if subscription.failures >= MAX_FAILURES:
            subscription.delete()
        else:
            subscription.save(update_fields=["failures", "updated_at"])
        logger.warning("Team Ops push failed (%s) for subscription %s", status, subscription.id)
        return False
    except Exception:
        # the push service could not be reached: not the device fault, so keep it and try the next one
        logger.warning("Team Ops push could not reach the push service for subscription %s", subscription.id)
        return False
    subscription.failures = 0
    subscription.last_success_at = timezone.now()
    subscription.save(update_fields=["failures", "last_success_at", "updated_at"])
    return True


def send_to_user(user_id, data):
    """Send `data` to every device of a person. Returns how many accepted it."""
    if not is_enabled():
        return 0
    sent = 0
    for subscription in PushSubscription.objects.filter(user_id=user_id):
        if _send(subscription, data):
            sent += 1
    return sent


def deliver(notification_ids):
    """Push the given notifications to their owners devices."""
    sent = 0
    for notification in OpsNotification.objects.filter(pk__in=list(notification_ids)).select_related("workspace"):
        sent += send_to_user(notification.user_id, payload_of(notification))
    return sent
