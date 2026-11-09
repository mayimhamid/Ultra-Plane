# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import io

# Django imports
from django.http import HttpResponse

# Third party imports
from rest_framework import status
from rest_framework.exceptions import NotFound, ParseError
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace
from plane.team_ops.models import HubChannel, HubMessage
from plane.team_ops.services import control
from plane.team_ops.services.access import CALENDAR_ROLES, CalendarAccess, calendar_user_ids
from plane.team_ops.services.csv_export import csv_response, csv_safe, hours
from plane.team_ops.services.date_params import parse_day_range
from plane.team_ops.services.team_view import visible_people
from plane.team_ops.services.time_entry import parse_uuid
from plane.team_ops.views.hub import _message_payload

MAX_DAYS = 92


def _forbidden():
    return Response({"error": "You don't have the required permissions."}, status=status.HTTP_403_FORBIDDEN)


def _team_scope(request, slug):
    """`(workspace, access, user ids)` for a caller who may see the team, else `(None, None, None)`."""
    workspace = Workspace.objects.get(slug=slug)
    access = CalendarAccess(request.user, workspace)
    if not access.can_view_team:
        return None, None, None
    return workspace, access, {user_id for user_id, _ in visible_people(access, workspace, request.query_params)}


class ControlTeamEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Every person's state now and their work, places, pauses and freezes in `from`..`to`.
        Filters: `team`, `project`, `user`. `export=csv` downloads the table."""
        workspace, access, user_ids = _team_scope(request, slug)
        if workspace is None:
            return _forbidden()
        start, end = parse_day_range(request.query_params, require=True, max_days=MAX_DAYS)
        rows, totals = control.team_overview(workspace, user_ids, start, end, request.user)
        if request.query_params.get("export") == "csv":
            header = [
                "Person",
                "Worked (h)",
                "Onsite (h)",
                "Remote (h)",
                "Finished work",
                "Tasks",
                "Rest pauses (h)",
                "Frozen (h)",
                "Freezes",
                "Without document",
                "Needed attention",
                "Unplanned days this week",
            ]
            lines = [
                [
                    csv_safe(row["user"]["display_name"]),
                    hours(row["period"]["seconds"]),
                    hours(row["period"]["onsite_seconds"]),
                    hours(row["period"]["remote_seconds"]),
                    row["period"]["sessions"],
                    row["period"]["tasks"],
                    hours(row["period"]["break_seconds"]),
                    hours(row["period"]["frozen_seconds"]),
                    row["period"]["freezes"],
                    row["period"]["without_document"],
                    row["period"]["attention"],
                    row["unplanned_days"],
                ]
                for row in rows
            ]
            return csv_response(f"team-control-{start}-{end}.csv", header, lines, f"Period {start} to {end}")
        return Response({"from": start, "to": end, "results": rows, "totals": totals})


class ControlInterruptionsEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Rest pauses and freezes in a period. Filters: `kind` (BREAK or FREEZE), plus the team filters."""
        workspace, access, user_ids = _team_scope(request, slug)
        if workspace is None:
            return _forbidden()
        start, end = parse_day_range(request.query_params, require=True, max_days=MAX_DAYS)
        kind = request.query_params.get("kind")
        if kind and kind not in ("BREAK", "FREEZE"):
            raise ParseError(detail="Unknown kind.")
        return Response({"results": control.interruption_list(workspace, user_ids, start, end, request.user, kind)})


def _admin(request, slug):
    workspace = Workspace.objects.get(slug=slug)
    return workspace if CalendarAccess(request.user, workspace).is_admin else None


class ControlHubEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        return Response(control.hub_overview(workspace))


class ControlHubChannelEndpoint(BaseAPIView):
    def _channel(self, workspace, pk):
        channel = HubChannel.objects.filter(workspace=workspace, pk=pk).exclude(kind=HubChannel.Kind.DM).first()
        if channel is None:
            raise NotFound("Channel not found.")  # private conversations are never reachable from here
        return channel

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def patch(self, request, slug, pk):
        """Lock a channel (only admins may write in it) or open it again."""
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        channel = self._channel(workspace, pk)
        channel.is_locked = bool(request.data.get("is_locked"))
        channel.save()
        return Response({"id": channel.id, "is_locked": channel.is_locked})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, pk):
        """The latest messages of a channel, for moderation."""
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        channel = self._channel(workspace, pk)
        messages = list(
            HubMessage.objects.filter(channel=channel)
            .select_related("author")
            .prefetch_related("mentions__user", "attachments", "reactions__user")
            .order_by("-created_at")[:50]
        )
        return Response({"results": [_message_payload(m, request.user) for m in messages]})


class ControlHubMessageEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        """Remove a message from a team, project, general or news channel. Private messages cannot be reached."""
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        message = (
            HubMessage.objects.filter(pk=pk, channel__workspace=workspace)
            .exclude(channel__kind=HubChannel.Kind.DM)
            .first()
        )
        if message is None:
            raise NotFound("Message not found.")
        message.is_deleted = True
        message.body = ""
        message.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ControlFlowsEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        return Response(control.flow_overview(workspace))


class ControlHoursEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Hours per person and day, split into onsite, remote, parallel, frozen and rest, with the approval state."""
        workspace, access, user_ids = _team_scope(request, slug)
        if workspace is None:
            return _forbidden()
        start, end = parse_day_range(request.query_params, require=True, max_days=MAX_DAYS)
        data = control.hours_by_day(workspace, user_ids, start, end, request.user)
        return Response({**data, "can_approve": access.is_admin})


class ControlApprovalEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Admins approve (or take back) the days with work of one person in `from`..`to`."""
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        start, end = parse_day_range(request.data, require=True, max_days=MAX_DAYS * 4)
        user_id = parse_uuid(request.data.get("user"), "user")
        if user_id not in {u for u, _ in visible_people(CalendarAccess(request.user, workspace), workspace, {})}:
            raise NotFound("Person not found.")
        changed = control.set_approval(
            workspace, request.user, user_id, start, end, request.data.get("approved", True) is not False
        )
        return Response({"changed": changed})


class ControlRankingEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace, access, user_ids = _team_scope(request, slug)
        if workspace is None:
            return _forbidden()
        start, end = parse_day_range(request.query_params, require=True, max_days=MAX_DAYS)
        return Response(
            {"from": start, "to": end, "results": control.ranking(workspace, user_ids, start, end, request.user)}
        )


class ControlSumEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Everyone's time between two dates as one number. Admins only.

        `parallel_double=1` counts parallel work twice. `export=xlsx` (or `csv`) downloads the table.
        """
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        start, end = parse_day_range(request.query_params, require=True, max_days=366)
        double = request.query_params.get("parallel_double") in ("1", "true")
        user_ids = calendar_user_ids(workspace)
        data = control.sum_time(workspace, user_ids, start, end, request.user, double)
        export = request.query_params.get("export")
        if export in ("xlsx", "csv"):
            return _sum_export(data, export, start, end)
        return Response(data)


def _sum_export(data, kind, start, end):
    header = [
        "Person",
        "Main hours",
        "Onsite (h)",
        "Remote (h)",
        "Parallel (h)",
        "Frozen (h)",
        "Frozen counted (h)",
        "Total (h)",
    ]
    lines = [
        [
            csv_safe(row["user"]["display_name"]),
            round(row["main_seconds"] / 3600, 2),
            round(row["onsite_seconds"] / 3600, 2),
            round(row["remote_seconds"] / 3600, 2),
            round(row["parallel_seconds"] / 3600, 2),
            round(row["frozen_seconds"] / 3600, 2),
            round(row["credited_frozen_seconds"] / 3600, 2),
            round(row["total_seconds"] / 3600, 2),
        ]
        for row in data["results"]
    ]
    note = f"{start} to {end}; parallel work counted {'twice' if data['parallel_double'] else 'once'}"
    if kind == "csv":
        return csv_response(f"sum-time-{start}-{end}.csv", header, lines, note)
    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    sheet.title = "Sum time"
    sheet.append(header)
    for line in lines:
        sheet.append(line)
    sheet.append(["Everyone", *[round(sum(line[i] for line in lines), 2) for i in range(1, len(header))]])
    sheet.append([])
    sheet.append([note])
    buffer = io.BytesIO()
    book.save(buffer)
    response = HttpResponse(
        buffer.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    response["Content-Disposition"] = f'attachment; filename="sum-time-{start}-{end}.xlsx"'
    return response


class ControlFreezeCreditEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Count (or stop counting) a person's frozen time between two dates. Admins only."""
        workspace = _admin(request, slug)
        if workspace is None:
            return _forbidden()
        start, end = parse_day_range(request.data, require=True, max_days=366)
        user_id = parse_uuid(request.data.get("user"), "user")
        if user_id not in calendar_user_ids(workspace):
            raise NotFound("Person not found.")
        credited = request.data.get("credited", True) is not False
        return Response({"changed": control.credit_freezes(workspace, request.user, user_id, start, end, credited)})


class ControlNotificationsEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """What a person was told and whether they read it (`?user=`). No private messages, no secrets."""
        workspace = Workspace.objects.get(slug=slug)
        access = CalendarAccess(request.user, workspace)
        user_id = parse_uuid(request.query_params.get("user"), "user")
        if not access.can_view_user(user_id) or user_id not in calendar_user_ids(workspace):
            return _forbidden()
        return Response({"results": control.notifications_of(workspace, user_id)})
