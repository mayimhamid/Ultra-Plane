# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A Hub file link must point at the address the person is on, never at the storage's internal name.

The link used to be signed for `plane-minio:9000` (the container's name on the Docker network), which no browser can
open. It is now signed for the address of the request, so the site's proxy hands it on to the storage.
"""

from types import SimpleNamespace
from unittest import mock

import pytest
from django.http import HttpRequest

from plane.team_ops.services import hub_files

pytestmark = pytest.mark.unit

LAN = "https://plane.5.160.42.168.sslip.io:4433"
TUNNEL = "https://mg-sfactory.tail4dcede.ts.net"


@pytest.fixture(autouse=True)
def served_on_two_addresses(settings):
    settings.WEB_URL = LAN
    settings.CORS_ALLOWED_ORIGINS = [TUNNEL, LAN]


def request_for(host, scheme="http"):
    request = HttpRequest()
    request.META["HTTP_HOST"] = host
    request.META["SERVER_NAME"] = host
    request.META["SERVER_PORT"] = "80"
    request.META["wsgi.url_scheme"] = scheme
    return request


class TestPublicRequest:
    def test_a_configured_address_keeps_its_own_scheme(self):
        # the proxy handed the request over as plain http; the link must still be https
        shim = hub_files.public_request(request_for("mg-sfactory.tail4dcede.ts.net", scheme="http"))
        assert (shim.scheme, shim.get_host()) == ("https", "mg-sfactory.tail4dcede.ts.net")

    def test_the_port_is_kept(self):
        shim = hub_files.public_request(request_for("plane.5.160.42.168.sslip.io:4433"))
        assert shim.get_host() == "plane.5.160.42.168.sslip.io:4433"

    def test_an_unknown_host_is_left_alone(self):
        request = request_for("evil.example")
        assert hub_files.public_request(request) is request


class TestStorageEndpoint:
    @pytest.fixture(autouse=True)
    def minio(self, monkeypatch):
        monkeypatch.setenv("USE_MINIO", "1")
        monkeypatch.setenv("MINIO_ENDPOINT_SSL", "0")
        monkeypatch.setenv("AWS_S3_ENDPOINT_URL", "http://plane-minio:9000")

    def endpoint(self, request):
        with mock.patch("plane.settings.storage.boto3.client") as client:
            hub_files.get_storage(request)
        return client.call_args.kwargs["endpoint_url"]

    def test_without_a_request_the_internal_address_is_used(self):
        assert self.endpoint(None) == "http://plane-minio:9000"

    def test_with_a_request_the_address_of_the_site_is_used(self):
        shim = hub_files.public_request(request_for("mg-sfactory.tail4dcede.ts.net"))
        assert self.endpoint(shim) == TUNNEL


class TestDownloadUrl:
    def attachment(self):
        return SimpleNamespace(storage_key="team-ops/x/y/z.md", content_type="text/markdown", name="notes.md")

    def test_the_link_is_signed_for_the_request_address(self):
        storage = mock.Mock()
        storage.generate_presigned_url.return_value = "https://signed"
        with mock.patch.object(hub_files, "get_storage", return_value=storage) as get_storage:
            url = hub_files.download_url(self.attachment(), request=request_for("mg-sfactory.tail4dcede.ts.net"))
        assert url == "https://signed"
        shim = get_storage.call_args.args[0]
        assert (shim.scheme, shim.get_host()) == ("https", "mg-sfactory.tail4dcede.ts.net")

    def test_without_a_request_nothing_changes(self):
        storage = mock.Mock()
        with mock.patch.object(hub_files, "get_storage", return_value=storage) as get_storage:
            hub_files.download_url(self.attachment())
        get_storage.assert_called_once_with()
