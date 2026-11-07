# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Secrets in the Hub: stored encrypted, readable only by the publisher and the people the publisher chose.

A secret is either a single value (SECRET) or a username and a password (LOGIN). Everything sensitive, the
username included, is encrypted together (Fernet: AES-128-CBC with an HMAC-SHA256 check) before it reaches the
database. The key is `TEAM_OPS_SECRET_KEY` from the server's environment, never stored in the database, so a
copy of the database alone opens nothing. Several keys can be given, comma separated: the first encrypts, all of
them can read, which lets the key be changed without losing old secrets.

Workspace admins get no special access: if the publisher did not allow them, they cannot read the value.
Every reveal, change and change of access is written to a log the publisher can read, without the value.
"""

# Python imports
import base64
import hashlib
import json
import os

# Django imports
from django.conf import settings
from django.db.models import Q

# Third party imports
from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from rest_framework.exceptions import NotFound, ParseError

# Module imports
from plane.team_ops.models import HubSecret, HubSecretAccess, HubSecretLog
from plane.team_ops.services.access import calendar_user_ids
from plane.team_ops.services.notifications import notify

MAX_VALUE = 20000
MAX_USERNAME = 500


def _fernet():
    """`TEAM_OPS_SECRET_KEY` (one or more Fernet keys, comma separated) when set; otherwise a key derived from
    Django's SECRET_KEY, which also lives outside the database."""
    configured = [key.strip() for key in os.environ.get("TEAM_OPS_SECRET_KEY", "").split(",") if key.strip()]
    digest = hashlib.sha256(f"team-ops-secrets:{settings.SECRET_KEY}".encode()).digest()
    derived = Fernet(base64.urlsafe_b64encode(digest))
    # The derived key always comes last: it still reads secrets saved before TEAM_OPS_SECRET_KEY was set.
    return MultiFernet([*(Fernet(key.encode()) for key in configured), derived])


def encrypt(content):
    """`content` is the dict of a secret's fields, or (old callers) a plain value."""
    data = content if isinstance(content, dict) else {"secret": content}
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt(token):
    """The fields of a secret. Secrets saved before LOGIN existed hold just the value."""
    try:
        text = _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        raise ParseError(detail="The secret cannot be read with the current key.")
    try:
        data = json.loads(text)
    except ValueError:
        return {"secret": text}
    return data if isinstance(data, dict) else {"secret": text}


def write_log(secret, user, action, target_id=None):
    HubSecretLog.objects.create(secret=secret, user=user, action=action, target_id=target_id)


def visible(workspace, user):
    """Secrets the person published or was given access to. Others do not show up at all."""
    # Through the access model's own manager: a joined lookup would still see access that was taken back.
    granted = HubSecretAccess.objects.filter(user=user).values("secret_id")
    return (
        HubSecret.objects.filter(workspace=workspace)
        .filter(Q(publisher=user) | Q(pk__in=granted))
        .select_related("publisher", "project")
    )


def get_visible(workspace, user, pk):
    secret = visible(workspace, user).filter(pk=pk).first()
    if secret is None:
        raise NotFound("Secret not found.")  # the same answer for "missing" and "not yours"
    return secret


def get_published(workspace, user, pk):
    secret = HubSecret.objects.filter(workspace=workspace, pk=pk, publisher=user).first()
    if secret is None:
        raise NotFound("Secret not found.")
    return secret


def _name(name):
    name = (name or "").strip()
    if not name or len(name) > 200:
        raise ParseError(detail="Give the secret a name.")
    return name


def content_of(data, kind=None):
    """The kind and the fields to encrypt, checked. SECRET: `secret`. LOGIN: `username` and `password`."""
    kind = kind or data.get("kind") or HubSecret.Kind.SECRET
    if kind not in HubSecret.Kind.values:
        raise ParseError(detail="The kind is SECRET or LOGIN.")
    if kind == HubSecret.Kind.LOGIN:
        username = data.get("username") or ""
        password = data.get("password")
        if not isinstance(username, str) or len(username) > MAX_USERNAME:
            raise ParseError(detail=f"The username can be at most {MAX_USERNAME} characters.")
        if not isinstance(password, str) or not password or len(password) > MAX_VALUE:
            raise ParseError(detail=f"A password is needed, at most {MAX_VALUE} characters.")
        return kind, {"username": username, "password": password}
    value = data.get("secret", data.get("value"))
    if not isinstance(value, str) or not value or len(value) > MAX_VALUE:
        raise ParseError(detail=f"A secret value is needed, at most {MAX_VALUE} characters.")
    return kind, {"secret": value}


def publish(workspace, user, data, project=None):
    name = _name(data.get("name"))
    kind, content = content_of(data)
    secret = HubSecret.objects.create(
        workspace=workspace,
        publisher=user,
        project=project,
        name=name,
        description=(data.get("description") or "")[:2000],
        kind=kind,
        ciphertext=encrypt(content),
    )
    write_log(secret, user, HubSecretLog.Action.CREATE)
    return secret


def reveal(secret, user):
    if secret.e2e:
        # Saved while Secrets used a browser vault: the server never had its key.
        raise ParseError(detail="This secret was saved with the old vault. Its publisher needs to enter it again.")
    write_log(secret, user, HubSecretLog.Action.REVEAL)
    content = decrypt(secret.ciphertext)
    if secret.kind == HubSecret.Kind.LOGIN:
        return {"kind": secret.kind, "username": content.get("username", ""), "password": content.get("password", "")}
    return {"kind": secret.kind, "secret": content.get("secret", "")}


def update(secret, user, data):
    if data.get("name") is not None:
        secret.name = _name(data.get("name"))
    if data.get("description") is not None:
        secret.description = str(data.get("description"))[:2000]
    if any(field in data for field in ("secret", "value", "password")):
        secret.kind, content = content_of(data, data.get("kind") or secret.kind)
        secret.ciphertext = encrypt(content)
        secret.e2e = False
    secret.save()
    write_log(secret, user, HubSecretLog.Action.UPDATE)
    return secret


def set_access(secret, publisher, user_ids):
    """Replace the list of people allowed to read the secret. Newly allowed people are told."""
    allowed = calendar_user_ids(secret.workspace) - {publisher.id}
    wanted = set(user_ids)
    if not wanted <= allowed:
        raise ParseError(detail="You can only share a secret with colleagues in this workspace.")
    current = set(HubSecretAccess.objects.filter(secret=secret).values_list("user_id", flat=True))
    for user_id in wanted - current:
        HubSecretAccess.objects.create(secret=secret, user_id=user_id)
        write_log(secret, publisher, HubSecretLog.Action.GRANT, user_id)
    for user_id in current - wanted:
        for row in HubSecretAccess.objects.filter(secret=secret, user_id=user_id):
            row.delete(soft=False)
        write_log(secret, publisher, HubSecretLog.Action.REVOKE, user_id)
    notify(
        secret.workspace,
        wanted - current,
        "SECRET",
        f'{publisher.display_name} shared the secret "{secret.name}" with you',
        link="team-ops/hub?section=secrets",
        actor=publisher,
    )
