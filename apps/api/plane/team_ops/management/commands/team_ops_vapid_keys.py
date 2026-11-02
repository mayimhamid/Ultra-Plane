# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import base64

# Django imports
from django.core.management.base import BaseCommand

# Third party imports
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01


def _b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class Command(BaseCommand):
    help = "Make a new VAPID key pair for Web Push and print the environment lines to set."

    def add_arguments(self, parser):
        parser.add_argument("--subject", default="mailto:admin@example.com", help="mailto: address of the sender.")

    def handle(self, *args, **options):
        vapid = Vapid01()
        vapid.generate_keys()
        public = vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        private = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
        self.stdout.write(f"TEAM_OPS_VAPID_PUBLIC_KEY={_b64(public)}")
        self.stdout.write(f"TEAM_OPS_VAPID_PRIVATE_KEY={_b64(private)}")
        self.stdout.write(f"TEAM_OPS_VAPID_SUBJECT={options['subject']}")
        self.stdout.write("Keep the private key secret. Changing the pair later turns push off for every device.")
