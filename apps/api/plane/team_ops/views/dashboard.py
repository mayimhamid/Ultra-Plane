# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace
from plane.team_ops.services.access import CALENDAR_ROLES, CalendarAccess
from plane.team_ops.services.dashboard import MAX_DASHBOARD_DAYS, build_dashboard
from plane.team_ops.services.date_params import parse_day_range
from plane.team_ops.services.insights import MAX_INSIGHT_DAYS, build_insights
from plane.team_ops.services.weekly_plan import today_in_timezone
from plane.team_ops.services.team_view import visible_people
from plane.team_ops.services.time_entry import parse_uuid


class DashboardEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """The management dashboard for the people the caller may see (`team`, `project` and `user` narrow it)."""
        workspace = Workspace.objects.get(slug=slug)
        access = CalendarAccess(request.user, workspace)
        if not access.can_view_team:
            return Response({"error": "You don't have the required permissions."}, status=status.HTTP_403_FORBIDDEN)
        params = request.query_params
        start, end = parse_day_range(params, require=True, max_days=MAX_DASHBOARD_DAYS)
        people = visible_people(access, workspace, params)
        data = build_dashboard(workspace, access.settings, people, start, end, request.user.user_timezone)
        return Response({"from": start, "to": end, **data}, status=status.HTTP_200_OK)


class InsightsEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Task risk and workload for the people and projects the caller may see. `from` and `to` set the
        period the workload capacity is measured over; `team`, `project` and `user` narrow the people."""
        workspace = Workspace.objects.get(slug=slug)
        access = CalendarAccess(request.user, workspace)
        if not access.can_view_team:
            return Response({"error": "You don't have the required permissions."}, status=status.HTTP_403_FORBIDDEN)
        params = request.query_params
        start, end = parse_day_range(params, require=True, max_days=MAX_INSIGHT_DAYS)
        people = visible_people(access, workspace, params)
        # A lead's view, or a team/user filter, keeps only work assigned to those people.
        narrowed = access.visible_user_ids() is not None or bool(params.get("team") or params.get("user"))
        today = today_in_timezone(request.user.user_timezone)
        project_id = parse_uuid(params["project"], "project") if params.get("project") else None
        data = build_insights(
            workspace, access.settings, request.user, access.is_admin, people, narrowed, start, end, today, project_id
        )
        return Response({"from": start, "to": end, **data}, status=status.HTTP_200_OK)
