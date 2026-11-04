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
from urllib.parse import urlparse

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
    """The VAPID `sub` claim. The push library accepts only `mailto:<email>` or `https://<host>` (no port, no
    path), and refuses every send otherwise, so a site address such as `https://host:4433/` is cut down to
    `https://host` and a bare email gets `mailto:`."""
    value = os.environ.get("TEAM_OPS_VAPID_SUBJECT", "").strip().strip("\"'")
    if not value:
        return "mailto:admin@localhost"
    if value.lower().startswith("mailto:"):
        return value
    if "@" in value and "://" not in value:
        return f"mailto:{value}"
    host = urlparse(value if "://" in value else f"https://{value}").hostname
    return f"https://{host}" if host else "mailto:admin@localhost"


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
            # High urgency: phones in power saving (and iOS with the app closed) deliver it at once
            headers={"Urgency": "high"},
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
    except Exception as error:
        # the push service could not be reached: not the device fault, so keep it and try the next one
        logger.warning(
            "Team Ops push could not reach the push service %s for subscription %s: %s: %s",
            subscription.endpoint.split("/")[2] if "://" in subscription.endpoint else "?",
            subscription.id,
            type(error).__name__,
            str(error)[:300],
        )
        return False
    subscription.failures = 0
    subscription.last_success_at = timezone.now()
    subscription.save(update_fields=["failures", "last_success_at", "updated_at"])
    return True


def _service(endpoint):
    """`apple`, `google`, `mozilla`, `microsoft` or the host: which push service a device uses."""
    host = endpoint.split("/")[2] if "://" in endpoint else "?"
    for name, marker in (("apple", "apple.com"), ("google", "googleapis.com"), ("mozilla", "mozilla.com")):
        if host.endswith(marker):
            return name
    return "microsoft" if "notify.windows.com" in host else host


def send_to_user(user_id, data):
    """Send `data` to every device of a person. Returns how many accepted it."""
    if not is_enabled():
        return 0
    sent, results = 0, []
    for subscription in PushSubscription.objects.filter(user_id=user_id):
        ok = _send(subscription, data)
        sent += int(ok)
        results.append(f"{_service(subscription.endpoint)}={'ok' if ok else 'failed'}")
    # One line per notification, so "did it reach the iPhone?" can be answered from the worker log.
    logger.info(
        "Team Ops push %s to user %s: %s",
        data.get("kind", "?"),
        user_id,
        ", ".join(results) or "no devices",
    )
    return sent


def deliver(notification_ids):
    """Push the given notifications to their owners devices."""
    sent = 0
    for notification in OpsNotification.objects.filter(pk__in=list(notification_ids)).select_related("workspace"):
        sent += send_to_user(notification.user_id, payload_of(notification))
    return sent
