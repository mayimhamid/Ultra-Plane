# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from urllib.parse import urlparse

# Django imports
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpRequest

# Third party imports
from rest_framework.request import Request

# Module imports
from plane.utils.ip_address import get_client_ip


def request_origin(request: Request | HttpRequest | None) -> str | None:
    """The configured origin (CORS_ALLOWED_ORIGINS) the request came in on, or None.

    A site that is reachable under more than one address (for instance a LAN name and a public tunnel) lists them
    all in CORS_ALLOWED_ORIGINS; redirects then stay on the address the person is using instead of jumping to
    WEB_URL. Only the host (and port) is compared, because a proxy in front may hand the request over as plain
    http; the scheme is the one that is configured. The Host header is never echoed back: it only selects one of
    the configured origins.
    """
    allowed = getattr(settings, "CORS_ALLOWED_ORIGINS", None) or []
    if request is None or not allowed:
        return None
    try:
        host = request.get_host()
    except Exception:
        return None
    if not isinstance(host, str):
        return None
    host = host.lower()
    for origin in allowed:
        if urlparse(origin).netloc.lower() == host:
            return origin.rstrip("/")
    return None


def base_host(
    request: Request | HttpRequest,
    is_admin: bool = False,
    is_space: bool = False,
    is_app: bool = False,
) -> str:
    """Utility function to return host / origin from the request"""
    # Calculate the base origin from request
    base_origin = request_origin(request) or settings.WEB_URL or settings.APP_BASE_URL

    if not base_origin:
        raise ImproperlyConfigured("APP_BASE_URL or WEB_URL is not set")

    # Admin redirection
    if is_admin:
        admin_base_path = getattr(settings, "ADMIN_BASE_PATH", None)
        if not isinstance(admin_base_path, str):
            admin_base_path = "/god-mode/"
        if not admin_base_path.startswith("/"):
            admin_base_path = "/" + admin_base_path
        if not admin_base_path.endswith("/"):
            admin_base_path += "/"

        if settings.ADMIN_BASE_URL:
            return settings.ADMIN_BASE_URL + admin_base_path
        else:
            return base_origin + admin_base_path

    # Space redirection
    if is_space:
        space_base_path = getattr(settings, "SPACE_BASE_PATH", None)
        if not isinstance(space_base_path, str):
            space_base_path = "/spaces/"
        if not space_base_path.startswith("/"):
            space_base_path = "/" + space_base_path
        if not space_base_path.endswith("/"):
            space_base_path += "/"

        if settings.SPACE_BASE_URL:
            return settings.SPACE_BASE_URL + space_base_path
        else:
            return base_origin + space_base_path

    # App Redirection
    if is_app:
        if settings.APP_BASE_URL:
            return settings.APP_BASE_URL
        else:
            return base_origin

    return base_origin


def user_ip(request: Request | HttpRequest) -> str:
    return get_client_ip(request=request)
