# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Secrets in the Hub, encrypted end to end.

The browser encrypts every value before it is sent. Each secret has its own random key; that key is wrapped
with the public key of the publisher and of each person allowed to read it. Private keys are locked with each
person's vault passphrase, in the browser. So the server only ever stores and hands out ciphertext: not the
server, not its database, not an admin and not someone who breaks into the machine can read a value.

Workspace admins get no special access. Every reveal, change and change of access is logged, without the value.

Secrets from before end-to-end encryption (`e2e` false) are still encrypted with a server key. Their publisher's
browser converts them the next time the publisher opens their vault; until then they can be read the old way.
"""

# Python imports
import base64
import binascii
import hashlib
import os

# Django imports
from django.conf import settings
from django.db import transaction
from django.db.models import Q

# Third party imports
from cryptography.fernet import Fernet, InvalidToken
from rest_framework.exceptions import NotFound, ParseError

# Module imports
from plane.team_ops.models import HubSecret, HubSecretAccess, HubSecretLog, HubVaultKey
from plane.team_ops.services.access import calendar_user_ids
from plane.team_ops.services.notifications import notify
from plane.team_ops.services.time_entry import parse_uuid

# Base64 sizes: a sealed value of up to ~20 000 characters, an RSA-3072 wrapped key, a wrapped private key.
MAX_CIPHERTEXT = 40000
MAX_WRAPPED = 1024
MAX_PUBLIC_KEY = 1024
MAX_PRIVATE_KEY = 4096
MIN_ITERATIONS = 300_000


# ---- Old secrets (server key): read and converted only ----


def _fernet():
    """The key is `TEAM_OPS_SECRET_KEY` (a Fernet key) when set; otherwise one derived from Django's SECRET_KEY."""
    configured = os.environ.get("TEAM_OPS_SECRET_KEY")
    if configured:
        return Fernet(configured.encode())
    digest = hashlib.sha256(f"team-ops-secrets:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value):
    """Server-key encryption. Only used by tests to make secrets the old way."""
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token):
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        raise ParseError(detail="The secret cannot be read with the current key.")


# ---- Checks on what the browser sends ----


def _blob(value, label, limit, required=True):
    """A base64 string from the browser. The server cannot read it; it only checks its shape and size."""
    if value in (None, "") and not required:
        return ""
    if not isinstance(value, str) or not value or len(value) > limit:
        raise ParseError(detail=f"Invalid {label}.")
    try:
        base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise ParseError(detail=f"Invalid {label}.")
    return value


def _kind(value):
    if value in (None, ""):
        return HubSecret.Kind.SECRET
    if value not in HubSecret.Kind.values:
        raise ParseError(detail="The kind is SECRET or LOGIN.")
    return value


def _sealed(data):
    """The encrypted value: ciphertext, its nonce and the key wrapped for the publisher."""
    if "value" in data:
        # Never accept a value in the clear: it would pass through and could be logged on the server.
        raise ParseError(detail="Secrets are encrypted in the browser. Open your vault and try again.")
    return {
        "ciphertext": _blob(data.get("ciphertext"), "ciphertext", MAX_CIPHERTEXT),
        "iv": _blob(data.get("iv"), "iv", 64),
        "owner_key": _blob(data.get("owner_key"), "owner key", MAX_WRAPPED),
    }


def parse_keys(data):
    """`{user id: wrapped key}` for readers; a reader without a key yet is waiting for it."""
    raw = data.get("keys") or {}
    if not isinstance(raw, dict):
        raise ParseError(detail="Invalid keys.")
    return {str(user_id): _blob(key, "key", MAX_WRAPPED) for user_id, key in raw.items()}


def _name(name):
    name = (name or "").strip()
    if not name or len(name) > 200:
        raise ParseError(detail="Give the secret a name.")
    return name


# ---- Vault keys ----


def vault_of(workspace, user):
    return HubVaultKey.objects.filter(workspace=workspace, user=user).first()


def vault_payload(vault):
    if vault is None:
        return None
    return {
        "public_key": vault.public_key,
        "private_key": vault.private_key,
        "salt": vault.salt,
        "iv": vault.iv,
        "iterations": vault.iterations,
    }


def _vault_fields(data):
    iterations = data.get("iterations")
    if not isinstance(iterations, int) or iterations < MIN_ITERATIONS or iterations > 10_000_000:
        raise ParseError(detail="The vault passphrase must be stretched with more iterations.")
    return {
        "private_key": _blob(data.get("private_key"), "private key", MAX_PRIVATE_KEY),
        "salt": _blob(data.get("salt"), "salt", 64),
        "iv": _blob(data.get("iv"), "iv", 64),
        "iterations": iterations,
    }


def create_vault(workspace, user, data):
    if vault_of(workspace, user):
        raise ParseError(detail="You already have a vault.")
    return HubVaultKey.objects.create(
        workspace=workspace,
        user=user,
        public_key=_blob(data.get("public_key"), "public key", MAX_PUBLIC_KEY),
        **_vault_fields(data),
    )


def change_passphrase(workspace, user, data):
    """The same key pair, locked with a new passphrase (re-encrypted in the browser)."""
    vault = vault_of(workspace, user)
    if vault is None:
        raise NotFound("You have no vault yet.")
    if data.get("public_key") != vault.public_key:
        raise ParseError(detail="The key pair cannot change here; reset the vault instead.")
    for field, value in _vault_fields(data).items():
        setattr(vault, field, value)
    vault.save()
    return vault


@transaction.atomic
def reset_vault(workspace, user):
    """For a forgotten passphrase. Secrets the person published cannot be read by anyone any more and are
    deleted; secrets shared with them wait until each publisher opens their vault and shares them again."""
    vault = vault_of(workspace, user)
    if vault is None:
        raise NotFound("You have no vault yet.")
    vault.delete(soft=False)
    lost = HubSecret.objects.filter(workspace=workspace, publisher=user, e2e=True)
    deleted = lost.count()
    for secret in lost:
        secret.delete()
    waiting = HubSecretAccess.objects.filter(secret__workspace=workspace, user=user).exclude(wrapped_key="")
    rewrap = waiting.update(wrapped_key="")
    return {"deleted": deleted, "waiting": rewrap}


def public_keys(workspace, user_ids):
    """The public keys of colleagues who have a vault, to share a secret with them."""
    allowed = calendar_user_ids(workspace) & set(user_ids)
    rows = HubVaultKey.objects.filter(workspace=workspace, user_id__in=allowed).values_list("user_id", "public_key")
    return {str(user_id): key for user_id, key in rows}


# ---- Secrets ----


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


def _require_vault(workspace, user):
    if vault_of(workspace, user) is None:
        raise ParseError(detail="Set up your vault first.")


@transaction.atomic
def publish(workspace, user, data, project=None):
    _require_vault(workspace, user)
    secret = HubSecret.objects.create(
        workspace=workspace,
        publisher=user,
        project=project,
        name=_name(data.get("name")),
        description=(data.get("description") or "")[:2000],
        kind=_kind(data.get("kind")),
        e2e=True,
        **_sealed(data),
    )
    write_log(secret, user, HubSecretLog.Action.CREATE)
    return secret


def reveal(secret, user):
    """What the browser needs to open the value: the ciphertext and the caller's wrapped key. Logged."""
    if not secret.e2e:
        write_log(secret, user, HubSecretLog.Action.REVEAL)
        return {"e2e": False, "value": decrypt(secret.ciphertext)}
    if secret.publisher_id == user.id:
        key = secret.owner_key
    else:
        key = HubSecretAccess.objects.filter(secret=secret, user=user).values_list("wrapped_key", flat=True).first()
    if not key:
        raise ParseError(
            detail=f"{secret.publisher.display_name} shared this before you had a vault. "
            "It opens for you once they open their vault."
        )
    write_log(secret, user, HubSecretLog.Action.REVEAL)
    return {"e2e": True, "kind": secret.kind, "ciphertext": secret.ciphertext, "iv": secret.iv, "key": key}


def _store_keys(secret, keys):
    """Give each current reader the wrapped key sent for them; the others wait for it."""
    for row in HubSecretAccess.objects.filter(secret=secret):
        row.wrapped_key = keys.get(str(row.user_id), "")
        row.save(update_fields=["wrapped_key"])


@transaction.atomic
def update(secret, user, data):
    if data.get("name") is not None:
        secret.name = _name(data.get("name"))
    if data.get("description") is not None:
        secret.description = str(data.get("description"))[:2000]
    if "ciphertext" in data or "value" in data:
        # A new value comes with a new key, wrapped again for everyone who may read it.
        _require_vault(secret.workspace, user)
        for field, value in _sealed(data).items():
            setattr(secret, field, value)
        secret.kind = _kind(data.get("kind") or secret.kind)
        secret.e2e = True
        _store_keys(secret, parse_keys(data))
    secret.save()
    write_log(secret, user, HubSecretLog.Action.UPDATE)
    return secret


@transaction.atomic
def convert(secret, user, data):
    """An old server-key secret, encrypted again in the publisher's browser. The old ciphertext is gone."""
    if secret.e2e:
        raise ParseError(detail="This secret is already encrypted end to end.")
    _require_vault(secret.workspace, user)
    for field, value in _sealed(data).items():
        setattr(secret, field, value)
    secret.kind = _kind(data.get("kind"))
    secret.e2e = True
    secret.save()
    _store_keys(secret, parse_keys(data))
    write_log(secret, user, HubSecretLog.Action.UPDATE)
    return secret


@transaction.atomic
def set_access(secret, publisher, user_ids, keys=None):
    """Replace the list of people allowed to read the secret. Newly allowed people are told.

    `keys` holds the secret's key wrapped for new readers who have a vault; anyone without one waits for it.
    """
    allowed = calendar_user_ids(secret.workspace) - {publisher.id}
    wanted = set(user_ids)
    if not wanted <= allowed:
        raise ParseError(detail="You can only share a secret with colleagues in this workspace.")
    keys = keys or {}
    current = set(HubSecretAccess.objects.filter(secret=secret).values_list("user_id", flat=True))
    for user_id in wanted - current:
        HubSecretAccess.objects.create(secret=secret, user_id=user_id, wrapped_key=keys.get(str(user_id), ""))
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


def pending(workspace, publisher):
    """Readers of the publisher's secrets who now have a vault but no key yet, with what the browser needs to
    wrap one: the secret's key wrapped for the publisher, and the reader's public key."""
    rows = (
        HubSecretAccess.objects.filter(secret__workspace=workspace, secret__publisher=publisher, secret__e2e=True)
        .filter(wrapped_key="")
        .select_related("secret")
    )
    vaults = dict(
        HubVaultKey.objects.filter(workspace=workspace, user_id__in=[row.user_id for row in rows]).values_list(
            "user_id", "public_key"
        )
    )
    return [
        {
            "secret": str(row.secret_id),
            "user": str(row.user_id),
            "owner_key": row.secret.owner_key,
            "public_key": vaults[row.user_id],
        }
        for row in rows
        if row.user_id in vaults
    ]


def fill_pending(workspace, publisher, items):
    """Store keys the publisher's browser wrapped for readers who were waiting. Returns how many."""
    if not isinstance(items, list):
        raise ParseError(detail="Invalid keys.")
    done = 0
    for item in items:
        if not isinstance(item, dict):
            raise ParseError(detail="Invalid keys.")
        key = _blob(item.get("wrapped_key"), "key", MAX_WRAPPED)
        done += HubSecretAccess.objects.filter(
            secret__workspace=workspace,
            secret__publisher=publisher,
            secret__e2e=True,
            secret_id=parse_uuid(item.get("secret"), "secret"),
            user_id=parse_uuid(item.get("user"), "user"),
            wrapped_key="",
        ).update(wrapped_key=key)
    return done
