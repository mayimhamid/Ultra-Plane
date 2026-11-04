# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The Day Report: at the end of the day each person lists the tasks they worked on and how long each took.

It replaces the running timer. A task has a planned time; the time reported on it, by everyone and on every
day, says whether it is going Speedy, On time or OverTime. A report changed after it was sent, or sent for a
past day, keeps a revision so admins can see what changed and how often.
"""

# Django imports
from django.conf import settings
from django.db import models
from django.db.models import Q

# Module imports
from plane.db.models.base import BaseModel


class PlanUnit(models.TextChoices):
    HOURS = "HOURS", "Hours"
    DAYS = "DAYS", "Days"


class TaskPlan(BaseModel):
    """How long a Plane work item is planned to take."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_ops_task_plans")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="team_ops_plans")
    planned_minutes = models.PositiveIntegerField()
    unit = models.CharField(max_length=10, choices=PlanUnit.choices, default=PlanUnit.HOURS)

    class Meta:
        verbose_name = "Task Plan"
        verbose_name_plural = "Task Plans"
        db_table = "tops_task_plan"
        constraints = [
            models.UniqueConstraint(
                fields=["issue"], condition=Q(deleted_at__isnull=True), name="tops_task_plan_one_per_issue"
            )
        ]


class MicroTask(BaseModel):
    """A small task with no project: a call, a quick fix, a meeting. It has its own planned time."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_ops_micro_tasks")
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_ops_micro_tasks"
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    is_meeting = models.BooleanField(default=False)
    planned_minutes = models.PositiveIntegerField(null=True, blank=True)
    unit = models.CharField(max_length=10, choices=PlanUnit.choices, default=PlanUnit.HOURS)
    due_date = models.DateField(null=True, blank=True)
    done = models.BooleanField(default=False)
    done_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Micro Task"
        verbose_name_plural = "Micro Tasks"
        db_table = "tops_micro_task"
        ordering = ("done", "-created_at")
        indexes = [models.Index(fields=["workspace", "assignee", "done"], name="tops_micro_ws_user_done_idx")]

    def __str__(self):
        return self.title


class DayReport(BaseModel):
    """One person's report of one day."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        SUBMITTED = "SUBMITTED", "Submitted"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_ops_day_reports")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_ops_day_reports")
    date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    # Sent after the day was over (a forgotten report).
    is_late = models.BooleanField(default=False)
    # Changes made after the report was sent, or on a past day.
    edit_count = models.PositiveIntegerField(default=0)
    last_edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Day Report"
        verbose_name_plural = "Day Reports"
        db_table = "tops_day_report"
        ordering = ("-date",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "date"],
                condition=Q(deleted_at__isnull=True),
                name="tops_day_report_one_per_user_day",
            )
        ]
        indexes = [models.Index(fields=["workspace", "date"], name="tops_day_report_ws_date_idx")]

    def __str__(self):
        return f"{self.user_id} {self.date}"


class DayReportEntry(BaseModel):
    """One row of a Day Report: a work item or a micro task, and the time spent on it that day."""

    report = models.ForeignKey(DayReport, on_delete=models.CASCADE, related_name="entries")
    issue = models.ForeignKey(
        "db.Issue", on_delete=models.SET_NULL, null=True, blank=True, related_name="team_ops_day_entries"
    )
    micro_task = models.ForeignKey(
        MicroTask, on_delete=models.SET_NULL, null=True, blank=True, related_name="day_entries"
    )
    minutes = models.PositiveIntegerField()
    # From and to, when the work was done in one go; empty for work spread over the day (only `minutes`).
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    # REMOTE or ONSITE: where this piece of work was done. Both in one day make it a hybrid day.
    location = models.CharField(max_length=10, blank=True, default="")
    # The person finished the task with this row.
    finished = models.BooleanField(default=False)
    note = models.TextField(blank=True, default="")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Day Report Entry"
        verbose_name_plural = "Day Report Entries"
        db_table = "tops_day_report_entry"
        ordering = ("position",)
        constraints = [
            models.CheckConstraint(condition=Q(minutes__lte=24 * 60), name="tops_day_entry_at_most_a_day"),
        ]


class DayReportRevision(models.Model):
    """A change to a sent report, or a report sent late. Never changed or removed."""

    id = models.BigAutoField(primary_key=True)
    report = models.ForeignKey(DayReport, on_delete=models.CASCADE, related_name="revisions")
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    changed_at = models.DateTimeField(auto_now_add=True)
    # LATE: sent for a day that was over; CHANGE: a sent report was changed.
    kind = models.CharField(max_length=10)
    reason = models.TextField(blank=True, default="")
    before = models.JSONField(default=list)
    after = models.JSONField(default=list)

    class Meta:
        verbose_name = "Day Report Revision"
        verbose_name_plural = "Day Report Revisions"
        db_table = "tops_day_report_revision"
        ordering = ("-changed_at",)
