# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models
from django.db.models import Q

# Module imports
from plane.db.models.base import BaseModel


class PushSubscription(BaseModel):
    """One browser or phone a person turned notifications on for (a Web Push subscription)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_ops_push")
    # The push service address for this browser; one browser belongs to one person at a time.
    endpoint = models.TextField()
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    device = models.CharField(max_length=200, blank=True, default="")
    last_success_at = models.DateTimeField(null=True, blank=True)
    # Consecutive failed deliveries; the subscription is dropped after a few.
    failures = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = "Push Subscription"
        verbose_name_plural = "Push Subscriptions"
        db_table = "tops_push_subscription"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["endpoint"], condition=Q(deleted_at__isnull=True), name="tops_push_endpoint_once"
            )
        ]
