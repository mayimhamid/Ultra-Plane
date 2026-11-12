# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Plain text of Plane content for Plane AI: a work item, a person's Day Report, and documents to index.

Only content the caller may read is built here; the views check access first.
"""

# Module imports
from plane.db.models import Issue, IssueAssignee, IssueComment
from plane.team_ops.models import DayReport, DayReportEntry, HubDoc

MAX_COMMENTS = 30
INDEX_BATCH = 200


def issue_text(issue):
    """A work item with its state, dates, people and latest comments, as one text."""
    assignees = list(IssueAssignee.objects.filter(issue=issue).values_list("assignee__display_name", flat=True))
    lines = [
        f"Work item {issue.project.identifier}-{issue.sequence_id}: {issue.name}",
        f"State: {issue.state.name if issue.state_id else 'none'} ({issue.state.group if issue.state_id else '-'})",
        f"Priority: {issue.priority}",
        f"Start: {issue.start_date or '-'} · Due: {issue.target_date or '-'}",
        f"Assignees: {', '.join(assignees) or 'nobody'}",
        "",
        "Description:",
        (issue.description_stripped or "(no description)").strip(),
    ]
    comments = list(
        IssueComment.objects.filter(issue=issue)
        .order_by("-created_at")
        .values("actor__display_name", "created_at", "comment_stripped")[:MAX_COMMENTS]
    )
    if comments:
        lines += ["", "Comments (newest first):"]
        lines += [
            f"- {c['actor__display_name']} ({c['created_at']:%Y-%m-%d}): {(c['comment_stripped'] or '').strip()}"
            for c in comments
            if (c["comment_stripped"] or "").strip()
        ]
    return "\n".join(lines)


def day_report_text(workspace, user, day):
    """A person's own Day Report of one day."""
    report = DayReport.objects.filter(workspace=workspace, user=user, date=day).first()
    if report is None:
        return ""
    lines = [f"Day Report of {user.display_name} for {day} ({report.status.lower()})"]
    for entry in DayReportEntry.objects.filter(report=report).select_related("issue__project", "micro_task"):
        if entry.issue_id:
            what = f"{entry.issue.project.identifier}-{entry.issue.sequence_id} {entry.issue.name}"
        else:
            what = entry.micro_task.title if entry.micro_task_id else "Task"
        done = " (finished)" if entry.finished else ""
        note = f" - {entry.note.strip()}" if entry.note.strip() else ""
        lines.append(f"- {what}: {entry.minutes} min{done}{note}")
    return "\n".join(lines)


def index_documents(workspace, project_ids):
    """Batches of documents to index: work items of `project_ids` and the workspace's Hub docs."""
    batch = []
    issues = (
        Issue.issue_objects.filter(workspace=workspace, project_id__in=project_ids)
        .values("id", "name", "sequence_id", "project_id", "project__identifier", "description_stripped")
        .iterator(chunk_size=500)
    )
    for row in issues:
        batch.append(
            {
                "source_type": "issue",
                "source_id": str(row["id"]),
                "title": f"{row['project__identifier']}-{row['sequence_id']} {row['name']}"[:300],
                "text": (row["description_stripped"] or "")[:20000],
                "project_id": str(row["project_id"]),
                "url": f"/{workspace.slug}/browse/{row['project__identifier']}-{row['sequence_id']}/",
            }
        )
        if len(batch) >= INDEX_BATCH:
            yield batch
            batch = []
    for doc in (
        HubDoc.objects.filter(workspace=workspace).values("id", "title", "body", "project_id").iterator(chunk_size=500)
    ):
        if doc["project_id"] and doc["project_id"] not in project_ids:
            continue
        batch.append(
            {
                "source_type": "doc",
                "source_id": str(doc["id"]),
                "title": doc["title"][:300],
                "text": (doc["body"] or "")[:20000],
                "project_id": str(doc["project_id"]) if doc["project_id"] else None,
                "url": f"/{workspace.slug}/team-ops/hub/?section=docs",
            }
        )
        if len(batch) >= INDEX_BATCH:
            yield batch
            batch = []
    if batch:
        yield batch
