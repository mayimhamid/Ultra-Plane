# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The client for Plane AI, the optional local AI service.

Plane never depends on it: with `PLANE_AI_URL` empty every AI feature is off, and when the service is down
or slow the caller gets an `AIUnavailable` it turns into a friendly message. Plane decides who may do what;
the service only receives the workspace, the user and the projects that user may read.
"""

# Python imports
import logging

# Third party imports
import requests

# Django imports
from django.conf import settings

logger = logging.getLogger("plane.team_ops.ai")


class AIError(Exception):
    """Something the person should be told. `code`: not_configured, unavailable, disabled, bad_request."""

    def __init__(self, code, message, status=503):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


MESSAGES = {
    "not_configured": "AI is not set up on this server.",
    "unavailable": "The AI service is not answering right now. Everything else works as usual; try again later.",
    "disabled": "An admin turned AI off for this workspace.",
    "bad_request": "The AI service could not use this request.",
}


def is_configured():
    return bool(getattr(settings, "PLANE_AI_URL", ""))


def _headers():
    token = getattr(settings, "PLANE_AI_TOKEN", "")
    return {"Authorization": f"Bearer {token}"} if token else {}


def _url(path):
    return f"{settings.PLANE_AI_URL}{path}"


def _error_from(response):
    detail = ""
    try:
        detail = response.json().get("detail", "")
    except ValueError:
        pass
    if response.status_code == 409 and detail == "ai_disabled":
        return AIError("disabled", MESSAGES["disabled"], 409)
    if response.status_code in (400, 404, 422):
        return AIError("bad_request", MESSAGES["bad_request"], 400)
    return AIError("unavailable", MESSAGES["unavailable"], 503)


def call(method, path, *, json=None, params=None, timeout=None):
    """One JSON request. Raises `AIError`; never lets a network error reach the view."""
    if not is_configured():
        raise AIError("not_configured", MESSAGES["not_configured"], 503)
    try:
        response = requests.request(
            method,
            _url(path),
            json=json,
            params=params,
            headers=_headers(),
            timeout=(5, timeout or settings.PLANE_AI_TIMEOUT),
        )
    except requests.RequestException as error:
        logger.warning("plane ai request failed: %s %s: %s", method, path, error.__class__.__name__)
        raise AIError("unavailable", MESSAGES["unavailable"], 503) from error
    if response.status_code == 204:
        return None
    if response.status_code >= 400:
        raise _error_from(response)
    return response.json()


def stream(path, *, json):
    """A server-sent-events request: returns the open response; iterate `iter_content` to relay it."""
    if not is_configured():
        raise AIError("not_configured", MESSAGES["not_configured"], 503)
    try:
        response = requests.post(
            _url(path), json=json, headers=_headers(), stream=True, timeout=(5, settings.PLANE_AI_TIMEOUT)
        )
    except requests.RequestException as error:
        logger.warning("plane ai stream failed: %s", error.__class__.__name__)
        raise AIError("unavailable", MESSAGES["unavailable"], 503) from error
    if response.status_code >= 400:
        error = _error_from(response)
        response.close()
        raise error
    return response


def status(workspace_id):
    """What the pages need to know: is AI usable here, at which effort, and is the model up."""
    if not is_configured():
        return {"configured": False, "reachable": False, "enabled": False}
    try:
        info = call("GET", "/v1/status", timeout=8)
        ws = call("GET", f"/v1/workspaces/{workspace_id}/settings", timeout=8)
    except AIError:
        return {"configured": True, "reachable": False, "enabled": False}
    return {
        "configured": True,
        "reachable": True,
        "enabled": ws["enabled"],
        "effort": ws["effort"],
        "llm": info["llm"],
        "runtime": info["runtime"],
        "model": info["model"],
        "profiles": info["profiles"],
    }


# --- background jobs ------------------------------------------------------------------------------------------
# Slow work (summaries, task proposals, reviews, answers) runs as a job in Plane AI: the request returns at once
# and the page polls, so a busy CPU never runs into a proxy or worker timeout.


def start_job(kind, workspace, user, data, *, audience="user", key=""):
    return call(
        "POST",
        "/v1/jobs",
        json={
            "workspace_id": str(workspace.id),
            "user_id": str(user.id),
            "kind": kind,
            "audience": audience,
            "key": key,
            "input": data,
        },
        timeout=15,
    )


def get_job(workspace, user, job_id, manager):
    return call(
        "GET",
        f"/v1/jobs/{job_id}",
        params={"workspace_id": str(workspace.id), "user_id": str(user.id), "manager": str(bool(manager)).lower()},
        timeout=10,
    )


def latest_job(workspace, user, kind, key, manager):
    jobs = call(
        "GET",
        "/v1/jobs",
        params={
            "workspace_id": str(workspace.id),
            "user_id": str(user.id),
            "kind": kind,
            "key": key,
            "manager": str(bool(manager)).lower(),
            "limit": 1,
        },
        timeout=10,
    )
    return jobs[0] if jobs else None


def list_jobs(workspace, user, kind, manager, limit=20):
    return call(
        "GET",
        "/v1/jobs",
        params={
            "workspace_id": str(workspace.id),
            "user_id": str(user.id),
            "kind": kind,
            "manager": str(bool(manager)).lower(),
            "limit": limit,
        },
        timeout=10,
    )


def send_feedback(workspace, user, job_id, manager, *, item, rating, correction):
    return call(
        "POST",
        f"/v1/jobs/{job_id}/feedback",
        json={
            "workspace_id": str(workspace.id),
            "user_id": str(user.id),
            "manager": bool(manager),
            "item": item,
            "rating": rating,
            "correction": correction,
        },
        timeout=10,
    )


def export_training(workspace):
    """The open streaming response of the JSONL training export."""
    if not is_configured():
        raise AIError("not_configured", MESSAGES["not_configured"], 503)
    try:
        response = requests.get(
            _url("/v1/training/export"),
            params={"workspace_id": str(workspace.id)},
            headers=_headers(),
            stream=True,
            timeout=(5, 120),
        )
    except requests.RequestException as error:
        raise AIError("unavailable", MESSAGES["unavailable"], 503) from error
    if response.status_code >= 400:
        error = _error_from(response)
        response.close()
        raise error
    return response
