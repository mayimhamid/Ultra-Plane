# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models
from django.db.models import Q

# Module imports
from plane.db.models.base import BaseModel


class HubDoc(BaseModel):
    """A written document in the Doc Hub, with tags and an optional project it belongs to."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_ops_hub_docs")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_ops_hub_docs")
    project = models.ForeignKey(
        "db.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="team_ops_hub_docs"
    )
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    # The Plane Page that holds the text, when the document belongs to a project
    page = models.ForeignKey("db.Page", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # The document this one is inside, so documents can be organized as a tree (a folder of pages).
    parent = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children")

    class Meta:
        verbose_name = "Hub Doc"
        verbose_name_plural = "Hub Docs"
        db_table = "tops_hub_doc"
        ordering = ("-updated_at",)


class HubSecret(BaseModel):
    """A secret (a value, or a username and a password). Stored encrypted with a key kept outside the database;
    the publisher decides who may read it. `e2e` marks secrets saved while Secrets used a browser vault: the
    server cannot open those, so their publisher enters them again.
    """

    class Kind(models.TextChoices):
        SECRET = "SECRET", "Secret"
        LOGIN = "LOGIN", "Username and password"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_ops_hub_secrets")
    publisher = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_ops_hub_secrets"
    )
    project = models.ForeignKey(
        "db.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="team_ops_hub_secrets"
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.SECRET)
    ciphertext = models.TextField()
    e2e = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Hub Secret"
        verbose_name_plural = "Hub Secrets"
        db_table = "tops_hub_secret"
        ordering = ("name",)


class HubSecretAccess(BaseModel):
    """A person the publisher allowed to read a secret."""

    secret = models.ForeignKey(HubSecret, on_delete=models.CASCADE, related_name="access")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")

    class Meta:
        db_table = "tops_hub_secret_access"
        constraints = [
            models.UniqueConstraint(
                fields=["secret", "user"], condition=Q(deleted_at__isnull=True), name="tops_hub_secret_access_once"
            )
        ]


class HubSecretLog(BaseModel):
    """Who did what with a secret. It never holds the value."""

    class Action(models.TextChoices):
        CREATE = "CREATE", "Created"
        REVEAL = "REVEAL", "Revealed"
        UPDATE = "UPDATE", "Changed"
        GRANT = "GRANT", "Access given"
        REVOKE = "REVOKE", "Access removed"

    secret = models.ForeignKey(HubSecret, on_delete=models.CASCADE, related_name="log")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    action = models.CharField(max_length=10, choices=Action.choices)
    target = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "tops_hub_secret_log"
        ordering = ("-created_at",)


class HubLink(BaseModel):
    """A link the team keeps in the Hub (a dashboard, a repository, a tool), with a short note."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_ops_hub_links")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_ops_hub_links")
    title = models.CharField(max_length=200)
    url = models.CharField(max_length=2000)
    note = models.TextField(blank=True, default="")
    group = models.CharField(max_length=60, blank=True, default="")

    class Meta:
        verbose_name = "Hub Link"
        verbose_name_plural = "Hub Links"
        db_table = "tops_hub_link"
        ordering = ("group", "title")
