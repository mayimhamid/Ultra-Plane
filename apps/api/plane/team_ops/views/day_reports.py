# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Day Reports, planned time of work items, micro tasks and the task import."""

from datetime import date

# Django imports
from django.db.models import Count, Sum

# Third party imports
from rest_framework import status
from rest_framework.exceptions import ParseError
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, Project, ProjectMember, User, Workspace
from plane.team_ops.models import DayReport, DayReportEntry, MicroTask, PlanUnit
from plane.team_ops.services import day_reports, task_import
from plane.team_ops.services.access import CALENDAR_ROLES, CalendarAccess, calendar_user_ids
from plane.team_ops.services.csv_export import csv_response, csv_safe
from plane.team_ops.services.time_entry import parse_uuid


def _forbidden():
    return Response({"error": "You don't have the required permissions."}, status=status.HTTP_403_FORBIDDEN)


def _workspace_for(request, slug):
    workspace = Workspace.objects.get(slug=slug)
    return workspace if request.user.id in calendar_user_ids(workspace) else None


def _day(value):
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ParseError(detail="The date must look like 2026-11-04.")


def _target_user(request, access, *, write=False):
    """The person whose data is asked for: the caller, or (`user=`) someone the caller may see or edit."""
    raw = request.query_params.get("user") or (request.data.get("user") if write else None)
    if not raw:
        return request.user
    user_id = parse_uuid(raw, "user")
    allowed = access.can_edit_user(user_id) if write else access.can_view_user(user_id)
    if not allowed:
        return None
    return User.objects.filter(pk=user_id).first()


class DayReportEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, day):
        """The report of one day (the caller's, or `?user=` for managers), with its rows and their progress."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        user = _target_user(request, access)
        if user is None:
            return _forbidden()
        payload = day_reports.report_payload(workspace, user, _day(day))
        payload["can_edit"] = user.id == request.user.id
        return Response(payload)

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def put(self, request, slug, day):
        """Save the caller's report: `entries`, `submit` to send it, `reason` for a late send or a change."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        payload = day_reports.save_report(
            workspace=workspace,
            user=request.user,
            actor=request.user,
            day=_day(day),
            rows=request.data.get("entries", []),
            submit=bool(request.data.get("submit")),
            reason=request.data.get("reason", ""),
        )
        payload["can_edit"] = True
        return Response(payload)


class DayReportHistoryEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, day):
        """Every recorded change of a day report: who, when, why, and the rows before and after."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        user = _target_user(request, access)
        if user is None:
            return _forbidden()
        report = DayReport.objects.filter(workspace=workspace, user=user, date=_day(day)).first()
        return Response({"results": day_reports.revisions_payload(report) if report else []})


class DayReportTeamEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """For managers: who sent the report of `?date=` (today by default), hours, and how often it was changed."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        if not access.can_view_team:
            return _forbidden()
        visible = access.visible_user_ids()
        ids = calendar_user_ids(workspace) if visible is None else visible & set(calendar_user_ids(workspace))
        from plane.team_ops.services.weekly_plan import today_in_timezone

        day = (
            _day(request.query_params["date"])
            if request.query_params.get("date")
            else today_in_timezone(request.user.user_timezone)
        )
        reports = {
            r["user_id"]: r
            for r in DayReport.objects.filter(workspace=workspace, user_id__in=ids, date=day)
            .values("user_id", "status", "submitted_at", "is_late", "edit_count")
            .annotate(total=Sum("entries__minutes"), rows=Count("entries"))
        }
        places = {}
        for user_id, location in DayReportEntry.objects.filter(
            report__workspace=workspace, report__user_id__in=ids, report__date=day
        ).values_list("report__user_id", "location"):
            places.setdefault(user_id, []).append(location)
        people = User.objects.filter(pk__in=ids)
        rows = [
            {
                "user": {"id": str(p.id), "display_name": p.display_name, "avatar_url": p.avatar_url},
                "status": reports.get(p.id, {}).get("status"),
                "submitted_at": reports.get(p.id, {}).get("submitted_at"),
                "is_late": reports.get(p.id, {}).get("is_late", False),
                "edit_count": reports.get(p.id, {}).get("edit_count", 0),
                "total_minutes": reports.get(p.id, {}).get("total") or 0,
                # Where the person worked that day: from the rows (both places: HYBRID), else their plan.
                "mode": day_reports.day_place(places.get(p.id, []), day_reports.day_mode(workspace, p, day)),
            }
            for p in people
        ]
        place = (request.query_params.get("place") or "").upper()
        if place in ("REMOTE", "ONSITE", "HYBRID"):
            rows = [row for row in rows if row["mode"] == place]
        rows.sort(key=lambda row: row["user"]["display_name"].lower())
        return Response({"date": day, "results": rows})


class DayReportExportEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """CSV of the day report rows from `from` to `to`. `place=REMOTE|ONSITE` keeps only rows done there;
        `place=HYBRID` keeps the days that had both."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        if not access.can_view_team:
            return _forbidden()
        start, end = _day(request.query_params.get("from", "")), _day(request.query_params.get("to", ""))
        if end < start or (end - start).days > 366:
            raise ParseError(detail="Choose a period of at most a year.")
        visible = access.visible_user_ids()
        ids = calendar_user_ids(workspace) if visible is None else visible & set(calendar_user_ids(workspace))
        entries = list(
            DayReportEntry.objects.filter(
                report__workspace=workspace, report__user_id__in=ids, report__date__gte=start, report__date__lte=end
            )
            .select_related("report", "report__user", "issue", "issue__project", "micro_task")
            .order_by("report__date", "report__user__display_name", "position")
        )
        by_day = {}
        for entry in entries:
            by_day.setdefault((entry.report.user_id, entry.report.date), []).append(entry.location)
        place = (request.query_params.get("place") or "").upper()
        rows = []
        for entry in entries:
            report = entry.report
            day_kind = day_reports.day_place(by_day[(report.user_id, report.date)], "")
            if place in ("REMOTE", "ONSITE") and entry.location != place:
                continue
            if place == "HYBRID" and day_kind != "HYBRID":
                continue
            task = (
                f"{entry.issue.project.identifier}-{entry.issue.sequence_id} {entry.issue.name}"
                if entry.issue_id and entry.issue
                else (entry.micro_task.title if entry.micro_task_id and entry.micro_task else "")
            )
            rows.append(
                [
                    report.date.isoformat(),
                    csv_safe(report.user.display_name),
                    day_kind,
                    csv_safe(entry.issue.project.name if entry.issue_id and entry.issue else "No project"),
                    csv_safe(task),
                    entry.start_time.strftime("%H:%M") if entry.start_time else "",
                    entry.end_time.strftime("%H:%M") if entry.end_time else "",
                    f"{entry.minutes / 60:.2f}",
                    entry.location,
                    "yes" if entry.finished else "",
                    report.status,
                    report.edit_count,
                    csv_safe(entry.note),
                ]
            )
        suffix = f"-{place.lower()}" if place in ("REMOTE", "ONSITE", "HYBRID") else ""
        return csv_response(
            f"day-reports-{start}-{end}{suffix}.csv",
            [
                "Date",
                "Person",
                "Day place",
                "Project",
                "Task",
                "Start",
                "End",
                "Hours",
                "Place",
                "Done",
                "Report",
                "Edits",
                "Note",
            ],
            rows,
            f"Day reports {start} to {end}" + (f", {place.lower()} only" if suffix else ""),
        )


class TaskPlanEndpoint(BaseAPIView):
    def _issue(self, request, slug, issue_id):
        workspace = Workspace.objects.get(slug=slug)
        issue = Issue.issue_objects.filter(pk=issue_id, workspace=workspace).select_related("project").first()
        if (
            issue is None
            or not ProjectMember.objects.filter(
                project_id=issue.project_id, member=request.user, is_active=True
            ).exists()
        ):
            return workspace, None
        return workspace, issue

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, issue_id):
        """Planned time of a work item, all the time reported on it, and the verdict."""
        workspace, issue = self._issue(request, slug, issue_id)
        if issue is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        progress = day_reports.issue_progress([issue.id])[issue.id]
        return Response({**progress.payload(), "can_edit": day_reports.can_plan(request.user, issue)})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def put(self, request, slug, issue_id):
        """Set the planned time: `amount` in `unit` (HOURS or DAYS); an empty amount clears it."""
        workspace, issue = self._issue(request, slug, issue_id)
        if issue is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        if not day_reports.can_plan(request.user, issue):
            return _forbidden()
        day_reports.set_plan(workspace, issue, request.data.get("amount"), request.data.get("unit", PlanUnit.HOURS))
        progress = day_reports.issue_progress([issue.id])[issue.id]
        return Response({**progress.payload(), "can_edit": True})


class MicroTaskListEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Micro tasks of the caller (or `?user=`), open ones first."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        user = _target_user(request, access)
        if user is None:
            return _forbidden()
        tasks = list(MicroTask.objects.filter(workspace=workspace, assignee=user).select_related("assignee")[:500])
        progress = day_reports.micro_progress(tasks)
        return Response({"results": [day_reports.micro_payload(t, progress[t.id]) for t in tasks]})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """New micro task (or meeting with `is_meeting`). `user` gives it to someone the caller manages."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        assignee = _target_user(request, access, write=True)
        if assignee is None:
            return _forbidden()
        task = day_reports.create_micro(
            workspace=workspace,
            assignee=assignee,
            actor=request.user,
            title=request.data.get("title"),
            description=request.data.get("description", ""),
            amount=request.data.get("amount"),
            unit=request.data.get("unit", PlanUnit.HOURS),
            due_date=_day(request.data["due_date"]) if request.data.get("due_date") else None,
            is_meeting=request.data.get("is_meeting", False),
        )
        return Response(day_reports.micro_payload(task), status=status.HTTP_201_CREATED)


class MicroTaskDetailEndpoint(BaseAPIView):
    def _task(self, request, slug, task_id):
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return None
        task = MicroTask.objects.filter(pk=task_id, workspace=workspace).select_related("assignee").first()
        if task is None:
            return None
        access = CalendarAccess(request.user, workspace)
        mine = request.user.id in (task.assignee_id, task.created_by_id)
        return task if mine or access.can_edit_user(task.assignee_id) else None

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def patch(self, request, slug, task_id):
        task = self._task(request, slug, task_id)
        if task is None:
            return Response({"error": "Micro task not found."}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        if "title" in data:
            if not str(data["title"]).strip():
                raise ParseError(detail="Give the task a title.")
            task.title = str(data["title"]).strip()[:255]
        if "description" in data:
            task.description = str(data["description"] or "")[:5000]
        if "amount" in data:
            unit = data.get("unit", task.unit)
            task.planned_minutes = (
                day_reports.to_minutes(data["amount"], unit) if data["amount"] not in (None, "", 0, "0") else None
            )
            task.unit = unit
        if "due_date" in data:
            task.due_date = _day(data["due_date"]) if data["due_date"] else None
        if "done" in data:
            from django.utils import timezone

            task.done = bool(data["done"])
            task.done_at = timezone.now() if task.done else None
        task.updated_by = request.user
        task.save()
        return Response(day_reports.micro_payload(task))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug, task_id):
        task = self._task(request, slug, task_id)
        if task is None:
            return Response({"error": "Micro task not found."}, status=status.HTTP_404_NOT_FOUND)
        task.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TaskImportEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """What an import file may name: people, and for a project its modules, states and labels."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        project = None
        if request.query_params.get("project"):
            project = Project.objects.filter(
                pk=parse_uuid(request.query_params["project"], "project"), workspace=workspace
            ).first()
            if (
                project is None
                or not ProjectMember.objects.filter(project=project, member=request.user, is_active=True).exists()
            ):
                return _forbidden()
        return Response(task_import.context(workspace, project))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Import tasks. `target`: micro (for `user`) or project (`project`). `dry_run` only checks and previews."""
        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        target = request.data.get("target")
        project = assignee = None
        if target == "micro":
            assignee = _target_user(request, access, write=True)
            if assignee is None:
                return _forbidden()
        elif target == "project":
            project_id = parse_uuid(request.data.get("project"), "project")
            project = Project.objects.filter(pk=project_id, workspace=workspace).first()
            member = (
                project is not None
                and ProjectMember.objects.filter(
                    project=project, member=request.user, is_active=True, role__gte=15
                ).exists()
            )
            if not member:
                return _forbidden()
            if request.data.get("user"):
                assignee = User.objects.filter(pk=parse_uuid(request.data["user"], "user")).first()
        else:
            raise ParseError(detail="Import into micro tasks or into a project.")
        rows, ok = task_import.preview(
            workspace=workspace, target=target, items=request.data.get("items"), project=project, assignee=assignee
        )
        if request.data.get("dry_run", True) or not ok:
            return Response({"ok": ok, "rows": rows, "created": 0})
        created = task_import.create(
            workspace=workspace, actor=request.user, target=target, rows=rows, project=project, assignee=assignee
        )
        return Response({"ok": True, "rows": rows, "created": created}, status=status.HTTP_201_CREATED)


class DayReportSummaryEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """What the team reported from `from` to `to` (at most a year): per person and day, projects, tasks.
        `team`, `user` and `place` (REMOTE, ONSITE, HYBRID) narrow it."""
        from plane.team_ops.services.report_summary import summary
        from plane.team_ops.services.team_view import visible_people

        workspace = _workspace_for(request, slug)
        if workspace is None:
            return _forbidden()
        access = CalendarAccess(request.user, workspace)
        if not access.can_view_team:
            return _forbidden()
        start, end = _day(request.query_params.get("from", "")), _day(request.query_params.get("to", ""))
        if end < start or (end - start).days > 366:
            raise ParseError(detail="Choose a period of at most a year.")
        people = [user_id for user_id, _ in visible_people(access, workspace, request.query_params)]
        place = (request.query_params.get("place") or "").upper()
        return Response(summary(workspace, access.settings, people, start, end, place))
