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
    """A secret (a value, or a username and password). The publisher decides who may read it.

    End-to-end (`e2e`): the browser encrypts the value with a random key, and wraps that key with the public key
    of the publisher (`owner_key`) and of each reader (`HubSecretAccess.wrapped_key`). The private keys are locked
    by each person's vault passphrase, which never reaches the server: the server, its database and anyone who
    gets into them hold only ciphertext. Secrets from before (`e2e` false) are encrypted with a server key; the
    publisher's browser converts them the next time the publisher opens their vault.
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
    # AES-GCM nonce of the ciphertext, and the secret's key wrapped for the publisher (both base64)
    iv = models.CharField(max_length=64, blank=True, default="")
    owner_key = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Hub Secret"
        verbose_name_plural = "Hub Secrets"
        db_table = "tops_hub_secret"
        ordering = ("name",)


class HubSecretAccess(BaseModel):
    """A person the publisher allowed to read a secret."""

    secret = models.ForeignKey(HubSecret, on_delete=models.CASCADE, related_name="access")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    # The secret's key wrapped with this person's public key. Empty while they have no vault yet: the
    # publisher's browser fills it in the next time the publisher opens their vault.
    wrapped_key = models.TextField(blank=True, default="")

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


class HubVaultKey(BaseModel):
    """A person's key pair for Secrets. The private key is encrypted in the browser with a key derived from the
    person's vault passphrase (PBKDF2); the server never sees the passphrase or the private key in the clear."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="+")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    public_key = models.TextField()
    private_key = models.TextField()
    salt = models.CharField(max_length=64)
    iv = models.CharField(max_length=64)
    iterations = models.PositiveIntegerField()

    class Meta:
        db_table = "tops_hub_vault_key"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"], condition=Q(deleted_at__isnull=True), name="tops_hub_vault_key_once"
            )
        ]
