# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""AI in Team Ops: help for members (summaries, task proposals, chat, search) and the managers' AI tab.

Every endpoint works out who may see what here, in Plane, and sends Plane AI only the content and the
project ids the caller may read. With Plane AI not configured or not answering, these endpoints say so and
the rest of Plane is not affected. Work evidence (`GET ai/team/`) needs no AI at all.
"""

# Python imports
import logging

# Django imports
from django.http import StreamingHttpResponse

# Third party imports
from rest_framework import status
from rest_framework.exceptions import ParseError
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, Workspace
from plane.team_ops.services import ai_client, ai_content
from plane.team_ops.services.access import CALENDAR_ROLES, CalendarAccess
from plane.team_ops.services.date_params import parse_day, parse_day_range
from plane.team_ops.services.tasks import visible_projects
from plane.team_ops.services.team_view import visible_people
from plane.team_ops.services.time_entry import parse_uuid
from plane.team_ops.services.weekly_plan import today_in_timezone
from plane.team_ops.services.work_evidence import MAX_EVIDENCE_DAYS, ai_payload, build_evidence

logger = logging.getLogger("plane.team_ops.ai")

EFFORTS = ("high", "medium", "low")


def _forbidden():
    return Response({"error": "You don't have the required permissions."}, status=status.HTTP_403_FORBIDDEN)


def _ai_error(error):
    return Response({"error": error.message, "code": error.code}, status=error.status)


def _context(request, slug):
    workspace = Workspace.objects.get(slug=slug)
    return workspace, CalendarAccess(request.user, workspace)


def _project_ids(workspace, access):
    return [str(pk) for pk in visible_projects(workspace, access.user, access.is_admin).values_list("id", flat=True)]


class AIStatusEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Whether AI can be used in this workspace, at which effort; `can_manage` for admins."""
        workspace, access = _context(request, slug)
        data = ai_client.status(workspace.id)
        data["can_manage"] = access.is_admin
        data["can_analyze"] = access.can_view_team
        return Response(data)


class AISettingsEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def patch(self, request, slug):
        """Admins: turn AI on or off for the workspace and pick the effort (high, medium, low)."""
        workspace, access = _context(request, slug)
        if not access.is_admin:
            return _forbidden()
        enabled = request.data.get("enabled")
        effort = request.data.get("effort")
        if not isinstance(enabled, bool) or effort not in EFFORTS:
            raise ParseError(detail="Send enabled (true or false) and effort (high, medium or low).")
        try:
            ai_client.call(
                "PUT",
                f"/v1/workspaces/{workspace.id}/settings",
                json={"enabled": enabled, "effort": effort, "user_id": str(request.user.id)},
                timeout=10,
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        data = ai_client.status(workspace.id)
        data["can_manage"] = True
        data["can_analyze"] = access.can_view_team
        return Response(data)


class AISummarizeEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """A summary of a work item (`issue`), of the caller's Day Report (`day_report` with `date`), or of
        `text` the person pasted."""
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        kind = request.data.get("kind", "text")
        title = ""
        if kind == "issue":
            issue_id = parse_uuid(request.data.get("issue"), "issue")
            issue = (
                Issue.issue_objects.filter(
                    pk=issue_id, project__in=visible_projects(workspace, request.user, access.is_admin)
                )
                .select_related("project", "state")
                .first()
            )
            if issue is None:
                return _forbidden()
            text, title = ai_content.issue_text(issue), issue.name
        elif kind == "day_report":
            day = parse_day(request.data.get("date") or str(today_in_timezone(request.user.user_timezone)), "date")
            text, title = ai_content.day_report_text(workspace, request.user, day), f"Day Report {day}"
            if not text:
                raise ParseError(detail="There is no Day Report for that day.")
        elif kind == "text":
            text = (request.data.get("text") or "").strip()
            title = (request.data.get("title") or "").strip()[:300]
            if not text:
                raise ParseError(detail="Paste the text to summarize.")
        else:
            raise ParseError(detail="kind must be issue, day_report or text.")
        try:
            data = ai_client.call(
                "POST",
                "/v1/summarize",
                json={"workspace_id": str(workspace.id), "kind": kind, "title": title, "text": text[:200000]},
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(data)


class AITaskProposalEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Task proposals for the import preview. `prompt` is the one the import dialog builds (it already
        names the people, modules and states the caller may use). Nothing is created here."""
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        prompt = (request.data.get("prompt") or "").strip()
        if not prompt:
            raise ParseError(detail="Describe the work first.")
        try:
            data = ai_client.call(
                "POST", "/v1/tasks/propose", json={"workspace_id": str(workspace.id), "prompt": prompt[:100000]}
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response({"tasks": data["tasks"]})


class AIChatEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """The caller's own conversations, newest first."""
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        try:
            data = ai_client.call(
                "GET",
                "/v1/conversations",
                params={"workspace_id": str(workspace.id), "user_id": str(request.user.id)},
                timeout=10,
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(data)

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Ask the assistant. The answer streams back as server-sent events (`meta`, `token`, `done`/`error`).
        It may use the work items and documents of the projects the caller can open."""
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        message = (request.data.get("message") or "").strip()
        if not message:
            raise ParseError(detail="Write a message.")
        conversation = request.data.get("conversation") or None
        if conversation:
            conversation = str(parse_uuid(conversation, "conversation"))
        try:
            upstream = ai_client.stream(
                "/v1/chat",
                json={
                    "workspace_id": str(workspace.id),
                    "user_id": str(request.user.id),
                    "conversation_id": conversation,
                    "message": message[:8000],
                    "project_ids": _project_ids(workspace, access),
                    "use_workspace": bool(request.data.get("use_workspace", True)),
                },
            )
        except ai_client.AIError as error:
            return _ai_error(error)

        def relay():
            try:
                for piece in upstream.iter_content(chunk_size=None):
                    if piece:
                        yield piece
            except Exception as error:  # the connection dropped mid-answer
                logger.warning("ai chat relay stopped: %s", error.__class__.__name__)
                yield b'event: error\ndata: {"detail": "llm_unavailable"}\n\n'
            finally:
                upstream.close()

        response = StreamingHttpResponse(relay(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class AIConversationEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, pk):
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        try:
            data = ai_client.call(
                "GET",
                f"/v1/conversations/{pk}",
                params={"workspace_id": str(workspace.id), "user_id": str(request.user.id)},
                timeout=10,
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(data)

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        try:
            ai_client.call(
                "DELETE",
                f"/v1/conversations/{pk}",
                params={"workspace_id": str(workspace.id), "user_id": str(request.user.id)},
                timeout=10,
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AISearchEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Search work items and documents by meaning, in the projects the caller can open."""
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        query = (request.query_params.get("q") or "").strip()
        if not query:
            return Response({"results": []})
        try:
            data = ai_client.call(
                "POST",
                "/v1/search",
                json={
                    "workspace_id": str(workspace.id),
                    "query": query[:500],
                    "project_ids": _project_ids(workspace, access),
                    "limit": 15,
                },
                timeout=20,
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(data)


class AIIndexEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Admins: send the workspace's work items and Hub docs to Plane AI for search and grounded answers."""
        workspace, access = _context(request, slug)
        if not access.is_admin:
            return _forbidden()
        documents = chunks = 0
        try:
            for batch in ai_content.index_documents(workspace, _project_ids(workspace, access)):
                result = ai_client.call(
                    "POST", "/v1/documents", json={"workspace_id": str(workspace.id), "documents": batch}
                )
                documents += result["documents"]
                chunks += result["chunks"]
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response({"documents": documents, "chunks": chunks})


class AITeamAnalysisEndpoint(BaseAPIView):
    def _evidence(self, request, slug, params):
        workspace, access = _context(request, slug)
        if not access.can_view_team:
            return workspace, None, None, None
        start, end = parse_day_range(params, require=True, max_days=MAX_EVIDENCE_DAYS)
        people = visible_people(access, workspace, params)
        return workspace, build_evidence(workspace, people, start, end), start, end

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Managers: work evidence per person for `from`-`to` (`team`, `user` narrow it). No AI needed."""
        workspace, evidence, start, end = self._evidence(request, slug, request.query_params)
        if evidence is None:
            return _forbidden()
        return Response({"from": start, "to": end, **evidence})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Managers: the same evidence, explained by Plane AI (a review per person and a team summary)."""
        workspace, evidence, start, end = self._evidence(request, slug, request.data)
        if evidence is None:
            return _forbidden()
        try:
            review = ai_client.call("POST", "/v1/analyze/team", json=ai_payload(workspace, evidence, start, end))
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response({"from": start, "to": end, **evidence, "review": review})
