# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work evidence: does what people reported match what Plane recorded?

For every row of a sent Day Report (a work item or a micro task, its minutes, whether it was marked done)
this looks for traces of the work: activity by that person on the work item (changes, comments, attachments)
around that day, a work session with a document, a written note, and whether a task marked done is really
done. Each row gets a support value from 0 to 1, a person's score is the minutes-weighted average (0-100),
and every gap becomes a plain-language flag.

Everything is arithmetic over Plane's own rows, so it works without any AI. Plane AI only reads these
numbers and explains them. Missing evidence is a reason to ask, not proof: meetings, calls, research and
offline work leave few traces.
"""

# Python imports
from collections import defaultdict
from datetime import timedelta

# Django imports
from django.db.models import Count

# Module imports
from plane.db.models import Issue, IssueActivity
from plane.team_ops.models import DayReport, DayReportEntry, WorkSession

MAX_EVIDENCE_DAYS = 62
# Most rows listed per person (the weakest first).
ITEMS_PER_PERSON = 12
# A note this long counts as an explanation.
NOTE_MIN_CHARS = 20
# A reported day longer than this is flagged.
LONG_DAY_MINUTES = 12 * 60
# A row this long with no trace at all is called out on its own.
BIG_ENTRY_MINUTES = 4 * 60
# Evidence counts from the day before to the day after the reported day (time zones, late commits).
NEAR_DAYS = (-1, 0, 1)

NOTICE = (
    "Evidence compares what was reported with what Plane recorded: activity on the work item, documents, "
    "notes and task states. Low evidence is a reason to ask, not proof: meetings, calls, research and offline "
    "work leave few traces."
)


def entry_support(entry):
    """Support (0-1) for one reported row and the evidence behind it.

    `entry` is a dict: `kind` (issue|micro), `minutes`, `finished`, `note`, `is_meeting`, `activity` (events by
    the person on the work item around that day), `document` (a work session with a document that day),
    `issue_done` (the work item is completed or cancelled now; `None` for micro tasks).
    """
    has_note = len((entry.get("note") or "").strip()) >= NOTE_MIN_CHARS
    evidence = {"activity": entry.get("activity", 0) > 0, "document": bool(entry.get("document")), "note": has_note}
    if entry["kind"] == "micro":
        support = 0.8 if entry.get("is_meeting") else (0.7 if has_note else 0.4)
    else:
        support = (0.5 if evidence["activity"] else 0) + (0.3 if evidence["document"] else 0) + (0.2 if has_note else 0)
    done_but_open = bool(entry.get("finished")) and entry["kind"] == "issue" and entry.get("issue_done") is False
    if done_but_open:
        support *= 0.5
    return round(support, 2), evidence, done_but_open


def score_person(entries, reports):
    """`entries`: dicts as for `entry_support` plus `date`, `key`, `name`. `reports`: `[{date, is_late,
    edit_count}]`. Returns `(score, facts, flags, items)`."""
    total = sum(e["minutes"] for e in entries)
    weighted = 0.0
    no_trace = []
    done_open = []
    items = []
    per_day = defaultdict(int)
    for e in entries:
        support, evidence, done_but_open = entry_support(e)
        weighted += support * e["minutes"]
        per_day[e["date"]] += e["minutes"]
        if e["kind"] == "issue" and not any(evidence.values()):
            no_trace.append(e)
        if done_but_open:
            done_open.append(e)
        items.append(
            {
                "date": e["date"],
                "kind": e["kind"],
                "key": e.get("key") or "",
                "name": e.get("name") or "",
                "minutes": e["minutes"],
                "finished": bool(e.get("finished")),
                "evidence": evidence,
                "done_but_open": done_but_open,
                "support": support,
            }
        )
    score = round(100 * weighted / total) if total else 0
    issue_entries = [e for e in entries if e["kind"] == "issue"]
    long_days = sorted(day for day, minutes in per_day.items() if minutes > LONG_DAY_MINUTES)
    late = sum(1 for r in reports if r["is_late"])
    edited = sum(1 for r in reports if r["edit_count"])
    no_trace_minutes = sum(e["minutes"] for e in no_trace)
    big_no_trace = [e for e in no_trace if e["minutes"] >= BIG_ENTRY_MINUTES]

    facts = {
        "reported_minutes": total,
        "reported_hours": round(total / 60, 1),
        "reports_sent": len(reports),
        "reported_tasks": len({(e["kind"], e.get("key") or e.get("name")) for e in entries}),
        "work_item_rows": len(issue_entries),
        "rows_with_activity": sum(1 for e in issue_entries if e.get("activity", 0) > 0),
        "rows_with_document": sum(1 for e in issue_entries if e.get("document")),
        "rows_with_note": sum(1 for e in entries if len((e.get("note") or "").strip()) >= NOTE_MIN_CHARS),
        "rows_without_any_trace": len(no_trace),
        "hours_without_any_trace": round(no_trace_minutes / 60, 1),
        "marked_done": sum(1 for e in entries if e.get("finished")),
        "marked_done_still_open": len(done_open),
        "micro_task_hours": round(sum(e["minutes"] for e in entries if e["kind"] == "micro") / 60, 1),
        "days_over_12h": len(long_days),
        "late_reports": late,
        "changed_reports": edited,
    }
    flags = []
    if no_trace:
        flags.append(
            f"{len(no_trace)} work item rows ({facts['hours_without_any_trace']}h) have no activity, document or note"
        )
    if big_no_trace:
        flags.append(f"{len(big_no_trace)} rows of 4h or more have no trace at all")
    if done_open:
        flags.append(f"{len(done_open)} tasks marked done in a Day Report are still open in Plane")
    if long_days:
        flags.append(f"{len(long_days)} days with more than 12 hours reported")
    if late:
        flags.append(f"{late} reports were sent after the day was over")
    if edited:
        flags.append(f"{edited} reports were changed after they were sent")
    items.sort(key=lambda item: (item["support"], -item["minutes"]))
    return score, facts, flags, items[:ITEMS_PER_PERSON]


def level(score, has_data):
    if not has_data:
        return "NO_DATA"
    if score >= 70:
        return "STRONG"
    if score >= 40:
        return "PARTIAL"
    return "WEAK"


def _gather(workspace, user_ids, start, end):
    """Rows of sent reports with their evidence, per person, in a handful of grouped queries."""
    reports = list(
        DayReport.objects.filter(
            workspace=workspace, user_id__in=user_ids, date__gte=start, date__lte=end, status=DayReport.Status.SUBMITTED
        ).values("id", "user_id", "date", "is_late", "edit_count")
    )
    report_by_id = {r["id"]: r for r in reports}
    rows = list(
        DayReportEntry.objects.filter(report_id__in=report_by_id).values(
            "report_id",
            "issue_id",
            "micro_task_id",
            "micro_task__title",
            "micro_task__is_meeting",
            "minutes",
            "finished",
            "note",
        )
    )
    issue_ids = {r["issue_id"] for r in rows if r["issue_id"]}
    issues = {
        i["id"]: i
        for i in Issue.all_objects.filter(pk__in=issue_ids).values(
            "id", "name", "sequence_id", "project__identifier", "state__group"
        )
    }
    # Activity per (person, work item, day), from one day before the period to one day after (time zones).
    activity = defaultdict(int)
    for row in (
        IssueActivity.objects.filter(
            issue_id__in=issue_ids,
            actor_id__in=user_ids,
            created_at__date__gte=start - timedelta(days=1),
            created_at__date__lte=end + timedelta(days=1),
        )
        .values("actor_id", "issue_id", "created_at__date")
        .annotate(n=Count("id"))
    ):
        activity[(row["actor_id"], row["issue_id"], row["created_at__date"])] += row["n"]
    documents = set()
    for row in WorkSession.objects.filter(
        workspace=workspace,
        user_id__in=user_ids,
        issue_id__in=issue_ids,
        finished_at__date__gte=start - timedelta(days=1),
        finished_at__date__lte=end + timedelta(days=1),
    ).values("user_id", "issue_id", "finished_at__date", "document_text"):
        if (row["document_text"] or "").strip():
            documents.add((row["user_id"], row["issue_id"], row["finished_at__date"]))

    per_person = defaultdict(list)
    for row in rows:
        report = report_by_id[row["report_id"]]
        uid, day = report["user_id"], report["date"]
        if row["issue_id"]:
            issue = issues.get(row["issue_id"]) or {}
            per_person[uid].append(
                {
                    "kind": "issue",
                    "date": day,
                    "key": f"{issue.get('project__identifier', '')}-{issue.get('sequence_id', '')}" if issue else "",
                    "name": issue.get("name", "Deleted work item"),
                    "minutes": row["minutes"],
                    "finished": row["finished"],
                    "note": row["note"],
                    "activity": sum(
                        activity.get((uid, row["issue_id"], day + timedelta(days=d)), 0) for d in NEAR_DAYS
                    ),
                    "document": any((uid, row["issue_id"], day + timedelta(days=d)) in documents for d in NEAR_DAYS),
                    "issue_done": issue.get("state__group") in ("completed", "cancelled") if issue else None,
                }
            )
        else:
            per_person[uid].append(
                {
                    "kind": "micro",
                    "date": day,
                    "key": "",
                    "name": row["micro_task__title"] or "Micro task",
                    "minutes": row["minutes"],
                    "finished": row["finished"],
                    "note": row["note"],
                    "is_meeting": bool(row["micro_task__is_meeting"]),
                    "issue_done": None,
                }
            )
    reports_by_person = defaultdict(list)
    for r in reports:
        reports_by_person[r["user_id"]].append(r)
    return per_person, reports_by_person


def build_evidence(workspace, people, start, end):
    """Evidence per person in `people` (`[(user_id, tz)]`) for the sent Day Reports in `[start, end]`."""
    from plane.db.models import User

    user_ids = [uid for uid, _ in people]
    per_person, reports_by_person = _gather(workspace, user_ids, start, end)
    users = {u.id: u for u in User.objects.filter(pk__in=user_ids).only("id", "display_name", "avatar")}
    out = []
    for uid in user_ids:
        user = users.get(uid)
        score, facts, flags, items = score_person(per_person.get(uid, []), reports_by_person.get(uid, []))
        out.append(
            {
                "user": {
                    "id": uid,
                    "display_name": user.display_name if user else "Unknown",
                    "avatar_url": user.avatar_url if user else None,
                },
                "score": score,
                "level": level(score, facts["reported_minutes"] > 0),
                "facts": facts,
                "flags": flags,
                "items": items,
            }
        )
    out.sort(key=lambda p: (p["level"] == "NO_DATA", p["score"]))
    with_data = [p for p in out if p["level"] != "NO_DATA"]
    team = {
        "people": len(out),
        "people_reporting": len(with_data),
        "reported_hours": round(sum(p["facts"]["reported_minutes"] for p in out) / 60, 1),
        "average_score": round(sum(p["score"] for p in with_data) / len(with_data)) if with_data else 0,
        "weak": sum(1 for p in out if p["level"] == "WEAK"),
        "partial": sum(1 for p in out if p["level"] == "PARTIAL"),
        "marked_done_still_open": sum(p["facts"]["marked_done_still_open"] for p in out),
        "hours_without_any_trace": round(sum(p["facts"]["hours_without_any_trace"] for p in out), 1),
    }
    return {"team": team, "people": out, "notice": NOTICE}


def ai_payload(workspace, evidence, start, end):
    """What Plane AI's team analysis receives: names, scores, facts and flags, nothing else."""
    return {
        "workspace_id": str(workspace.id),
        "period": f"{start.isoformat()} to {end.isoformat()}",
        "team_facts": evidence["team"],
        "members": [
            {
                "user_id": str(p["user"]["id"]),
                "name": p["user"]["display_name"],
                "score": p["score"],
                "facts": p["facts"],
                "flags": p["flags"],
            }
            for p in evidence["people"]
        ],
    }
