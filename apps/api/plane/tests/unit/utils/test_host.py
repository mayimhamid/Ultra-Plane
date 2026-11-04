# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A site served under several addresses keeps people on the address they came in on.

Every address is listed in CORS_ALLOWED_ORIGINS. Redirects (after sign-in, sign-out, errors) go to the matching
origin; any other host falls back to WEB_URL, so the Host header can never send anyone to a host that is not
configured.
"""

import pytest
from django.http import HttpRequest

from plane.authentication.utils.host import base_host as auth_base_host
from plane.utils.host import base_host, request_origin
from plane.utils.path_validator import get_safe_redirect_url

pytestmark = pytest.mark.unit

LAN = "https://plane.5.160.42.168.sslip.io:4433"
TUNNEL = "https://mg-sfactory.tail4dcede.ts.net"

SETTINGS = {
    "WEB_URL": LAN,
    "APP_BASE_URL": None,
    "ADMIN_BASE_URL": None,
    "SPACE_BASE_URL": None,
    "CORS_ALLOWED_ORIGINS": [TUNNEL, LAN, "http://localhost:9095"],
}


@pytest.fixture(autouse=True)
def served_on_two_addresses(settings):
    for name, value in SETTINGS.items():
        setattr(settings, name, value)


def request_for(host):
    request = HttpRequest()
    request.META["HTTP_HOST"] = host
    request.META["SERVER_NAME"] = host
    request.META["SERVER_PORT"] = "80"
    return request


class TestRequestOrigin:
    def test_tunnel_host_gives_the_tunnel_origin(self):
        assert request_origin(request_for("mg-sfactory.tail4dcede.ts.net")) == TUNNEL

    def test_lan_host_with_port_gives_the_lan_origin(self):
        assert request_origin(request_for("plane.5.160.42.168.sslip.io:4433")) == LAN

    def test_host_is_compared_without_case(self):
        assert request_origin(request_for("MG-SFactory.TAIL4DCEDE.ts.net")) == TUNNEL

    def test_unknown_host_gives_nothing(self):
        assert request_origin(request_for("evil.example")) is None

    def test_known_name_on_another_port_gives_nothing(self):
        assert request_origin(request_for("plane.5.160.42.168.sslip.io:9999")) is None

    def test_no_request_gives_nothing(self):
        assert request_origin(None) is None

    def test_without_cors_origins_nothing_is_matched(self, settings):
        settings.CORS_ALLOWED_ORIGINS = []
        assert request_origin(request_for("mg-sfactory.tail4dcede.ts.net")) is None


class TestBaseHost:
    @pytest.mark.parametrize("function", [base_host, auth_base_host])
    def test_app_redirect_stays_on_the_tunnel(self, function):
        assert function(request_for("mg-sfactory.tail4dcede.ts.net"), is_app=True) == TUNNEL

    @pytest.mark.parametrize("function", [base_host, auth_base_host])
    def test_app_redirect_stays_on_the_lan_address(self, function):
        assert function(request_for("plane.5.160.42.168.sslip.io:4433"), is_app=True) == LAN

    @pytest.mark.parametrize("function", [base_host, auth_base_host])
    def test_unknown_host_falls_back_to_web_url(self, function):
        assert function(request_for("evil.example"), is_app=True) == LAN

    @pytest.mark.parametrize("function", [base_host, auth_base_host])
    def test_no_request_falls_back_to_web_url(self, function):
        assert function(None) == LAN

    @pytest.mark.parametrize("function", [base_host, auth_base_host])
    def test_admin_and_space_paths_follow_the_address(self, function):
        request = request_for("mg-sfactory.tail4dcede.ts.net")
        assert function(request, is_admin=True) == f"{TUNNEL}/god-mode/"
        assert function(request, is_space=True) == f"{TUNNEL}/spaces/"

    @pytest.mark.parametrize("function", [base_host, auth_base_host])
    def test_an_explicit_app_base_url_still_wins(self, function, settings):
        settings.APP_BASE_URL = "https://app.example.com"
        assert function(request_for("mg-sfactory.tail4dcede.ts.net"), is_app=True) == "https://app.example.com"


class TestSafeRedirectKeepsThePath:
    def test_path_is_kept_on_the_tunnel(self):
        url = get_safe_redirect_url(base_url=TUNNEL, next_path="/smartfactory/")
        assert url == f"{TUNNEL}/?next_path=/smartfactory/"

    def test_path_is_kept_on_the_lan_address(self):
        url = get_safe_redirect_url(base_url=LAN, next_path="/smartfactory/")
        assert url == f"{LAN}/?next_path=/smartfactory/"

    def test_a_host_that_is_not_configured_loses_the_path(self):
        url = get_safe_redirect_url(base_url="https://evil.example", next_path="/smartfactory/")
        assert url == "https://evil.example"
