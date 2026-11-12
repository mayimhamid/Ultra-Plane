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
from plane.team_ops.services import ai_client, ai_content, ai_review
from plane.team_ops.services.access import CALENDAR_ROLES, CalendarAccess
from plane.team_ops.services.date_params import parse_day, parse_day_range
from plane.team_ops.services.tasks import visible_projects
from plane.team_ops.services.team_view import visible_people
from plane.team_ops.services.time_entry import parse_uuid
from plane.team_ops.services.weekly_plan import today_in_timezone
from plane.team_ops.services.work_evidence import MAX_EVIDENCE_DAYS, ai_payload, build_evidence
from plane.team_ops.services.work_quality import build_quality

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
            job = ai_client.start_job(
                "summarize", workspace, request.user, {"kind": kind, "title": title, "text": text[:200000]}
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(job, status=status.HTTP_202_ACCEPTED)


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
            job = ai_client.start_job("tasks", workspace, request.user, {"prompt": prompt[:100000]})
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(job, status=status.HTTP_202_ACCEPTED)


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
        """Managers: start Plane AI's explanation of the same evidence (a review per person and a team summary).
        Returns the job; its result is polled at `ai/jobs/<id>/`."""
        workspace, evidence, start, end = self._evidence(request, slug, request.data)
        if evidence is None:
            return _forbidden()
        payload = ai_payload(workspace, evidence, start, end)
        payload.pop("workspace_id")
        try:
            job = ai_client.start_job("team_review", workspace, request.user, payload, audience="managers")
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(job, status=status.HTTP_202_ACCEPTED)


def _manager_people(request, slug, params):
    """The workspace, access and the people a manager may see (narrowed by `team`/`user`); people is `None`
    when the caller may not see the team."""
    workspace, access = _context(request, slug)
    if not access.can_view_team:
        return workspace, access, None
    return workspace, access, visible_people(access, workspace, params)


class AIJobEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, pk):
        """A job the caller started, or a managers' job when the caller may see the team."""
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        try:
            job = ai_client.get_job(workspace, request.user, pk, access.can_view_team)
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(job)


class AIJobFeedbackEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug, pk):
        """Rate an answer: `rating` 1 (right) or -1 (wrong), `correction` the right answer, `item` the part
        (a person in a daily review). Rated answers become training data for a better local model."""
        workspace, access = _context(request, slug)
        if not access.is_calendar_user:
            return _forbidden()
        rating = request.data.get("rating")
        if rating not in (1, -1):
            raise ParseError(detail="rating must be 1 or -1.")
        try:
            ai_client.send_feedback(
                workspace,
                request.user,
                pk,
                access.can_view_team,
                item=str(request.data.get("item") or "")[:100],
                rating=rating,
                correction=str(request.data.get("correction") or "")[:10000],
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response({"ok": True}, status=status.HTTP_201_CREATED)


def _day(request, source):
    return parse_day(source.get("date") or str(today_in_timezone(request.user.user_timezone)), "date")


class AIDailyReviewEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Managers: the rows of one day's reports (`date`, `team`, `user`) and the latest AI review of exactly
        those people, if there is one."""
        workspace, access, people = _manager_people(request, slug, request.query_params)
        if people is None:
            return _forbidden()
        day = _day(request, request.query_params)
        rows = ai_review.daily_rows(workspace, people, day)
        review = None
        if ai_client.is_configured():
            try:
                review = ai_client.latest_job(
                    workspace, request.user, "daily_review", f"daily:{day}:{ai_review.people_key(people)}", True
                )
            except ai_client.AIError:
                review = None
        return Response({"date": day, "people": rows, "review": review})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Managers: ask Plane AI whether the time on every row fits the work described. Returns the job."""
        workspace, access, people = _manager_people(request, slug, request.data)
        if people is None:
            return _forbidden()
        day = _day(request, request.data)
        rows = [person for person in ai_review.daily_rows(workspace, people, day) if person["rows"]]
        if not rows:
            raise ParseError(detail="Nobody sent a Day Report for that day.")
        try:
            job = ai_client.start_job(
                "daily_review",
                workspace,
                request.user,
                {"day": str(day), "people": rows},
                audience="managers",
                key=f"daily:{day}:{ai_review.people_key(people)}",
            )
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(job, status=status.HTTP_202_ACCEPTED)


class AIAskEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Managers: the caller's recent questions and answers."""
        workspace, access = _context(request, slug)
        if not access.can_view_team:
            return _forbidden()
        try:
            jobs = ai_client.list_jobs(workspace, request.user, "ask", False)
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(jobs)

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Managers: ask a question about the team for `from`-`to` (`team` narrows it). Plane builds the data the
        caller may see; Plane AI answers only from it. Returns the job."""
        workspace, access, people = _manager_people(request, slug, request.data)
        if people is None:
            return _forbidden()
        question = (request.data.get("question") or "").strip()
        if not question:
            raise ParseError(detail="Write a question.")
        start, end = parse_day_range(request.data, require=True, max_days=MAX_EVIDENCE_DAYS)
        narrowed = access.visible_user_ids() is not None or bool(request.data.get("team") or request.data.get("user"))
        today = today_in_timezone(request.user.user_timezone)
        sections = ai_review.ask_sections(
            workspace, access, request.user, people, narrowed, start, end, today, question
        )
        data = {
            "question": question[:2000],
            "period": f"{start} to {end}",
            "sections": sections,
            "project_ids": _project_ids(workspace, access),
        }
        try:
            job = ai_client.start_job("ask", workspace, request.user, data)
        except ai_client.AIError as error:
            return _ai_error(error)
        return Response(job, status=status.HTTP_202_ACCEPTED)


class AITrainingExportEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Admins: download the rated answers as JSONL (chat format) to fine-tune the local model."""
        workspace, access = _context(request, slug)
        if not access.is_admin:
            return _forbidden()
        try:
            upstream = ai_client.export_training(workspace)
        except ai_client.AIError as error:
            return _ai_error(error)

        def relay():
            try:
                for piece in upstream.iter_content(chunk_size=65536):
                    if piece:
                        yield piece
            finally:
                upstream.close()

        response = StreamingHttpResponse(relay(), content_type="application/x-ndjson")
        response["Content-Disposition"] = f'attachment; filename="plane-ai-training-{workspace.slug}.jsonl"'
        return response


class AIQualityEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Managers: quality of work per person for `from`-`to` (`team`, `user` narrow it), with the period before
        as the trend: delivery on time, reopened work, estimates, focus, documents. No AI needed."""
        workspace, access, people = _manager_people(request, slug, request.query_params)
        if people is None:
            return _forbidden()
        start, end = parse_day_range(request.query_params, require=True, max_days=MAX_EVIDENCE_DAYS)
        projects = visible_projects(workspace, request.user, access.is_admin)
        return Response({"from": start, "to": end, **build_quality(workspace, projects, people, start, end)})
