# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.core.management.base import BaseCommand

# Module imports
from plane.db.models import Workspace
from plane.team_ops.services.admin_access import sync_admin_access


class Command(BaseCommand):
    help = "Make every workspace admin an admin of every project of their workspace."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", help="Only this workspace (slug).")

    def handle(self, *args, **options):
        workspace = None
        if options.get("workspace"):
            workspace = Workspace.objects.get(slug=options["workspace"])
        self.stdout.write(f"changed: {sync_admin_access(workspace)}")
