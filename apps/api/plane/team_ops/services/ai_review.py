# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What managers' AI tools read: the rows of one day (Daily review) and data sections for Ask and Answer.

Everything here is Plane's own data, limited to the people and projects the caller may see. Plane AI only reads
it: the Daily review judges whether the time on each row fits the work described, Ask and Answer answers
questions from these sections and nothing else.
"""

# Python imports
import hashlib

# Module imports
from plane.team_ops.services.insights import build_insights
from plane.team_ops.services.work_evidence import _gather, build_evidence

MAX_NOTE_LINES = 400


def people_key(people):
    """A short fingerprint of a set of people, so a saved review is only shown for exactly the same people."""
    ids = ",".join(sorted(str(uid) for uid, _ in people))
    return hashlib.sha256(ids.encode()).hexdigest()[:16]


def daily_rows(workspace, people, day):
    """Every row of the sent Day Reports of `day`, with what Plane recorded, per person."""
    from plane.db.models import User

    user_ids = [uid for uid, _ in people]
    per_person, _ = _gather(workspace, user_ids, day, day)
    names = dict(User.objects.filter(pk__in=user_ids).values_list("id", "display_name"))
    out = []
    for uid in user_ids:
        rows = []
        for n, entry in enumerate(per_person.get(uid, []), start=1):
            has_note = len((entry.get("note") or "").strip()) >= 20
            rows.append(
                {
                    "id": f"{uid}-{n}",
                    "key": entry.get("key") or "",
                    "task": entry.get("name") or "",
                    "description": entry.get("description") or "",
                    "project": entry.get("project") or "",
                    "minutes": entry["minutes"],
                    "note": entry.get("note") or "",
                    "finished": bool(entry.get("finished")),
                    "kind": entry["kind"],
                    "is_meeting": bool(entry.get("is_meeting")),
                    "evidence": {
                        "activity": entry.get("activity", 0) > 0,
                        "document": bool(entry.get("document")),
                        "note": has_note,
                    },
                    "done_but_open": bool(entry.get("finished"))
                    and entry["kind"] == "issue"
                    and entry.get("issue_done") is False,
                }
            )
        out.append({"user_id": str(uid), "name": names.get(uid, "Unknown"), "rows": rows})
    return out


def _hours(minutes):
    return f"{round(minutes / 60, 1)} h"


def ask_sections(workspace, access, user, people, narrowed, start, end, today):
    """Data sections for Ask and Answer, each one an "expert" Plane AI may route the question to."""
    evidence = build_evidence(workspace, people, start, end)
    people_lines, evidence_lines = [], []
    for person in evidence["people"]:
        name, facts = person["user"]["display_name"], person["facts"]
        people_lines.append(
            f"{name}: {facts['reported_hours']} h reported, {facts['reports_sent']} reports, "
            f"{facts['reported_tasks']} tasks, {facts['marked_done']} marked done, "
            f"{facts['late_reports']} late reports, {facts['days_over_12h']} days over 12 h"
        )
        flags = "; ".join(person["flags"]) or "no flags"
        evidence_lines.append(f"{name}: evidence {person['score']}/100 ({person['level'].lower()}); {flags}")

    per_person, _ = _gather(workspace, [uid for uid, _ in people], start, end)
    names = {p["user"]["id"]: p["user"]["display_name"] for p in evidence["people"]}
    note_lines = []
    for uid, entries in per_person.items():
        for entry in sorted(entries, key=lambda e: e["date"]):
            what = f"{entry['key']} {entry['name']}".strip() if entry.get("key") else entry.get("name", "")
            note = (entry.get("note") or "").strip().replace("\n", " ")[:200] or "(no note)"
            done = ", marked done" if entry.get("finished") else ""
            note_lines.append(
                f"{entry['date']} {names.get(uid, 'Unknown')}: {what} - {entry['minutes']} min{done} - {note}"
            )
    note_lines = note_lines[-MAX_NOTE_LINES:]

    insights = build_insights(workspace, access.settings, user, access.is_admin, people, narrowed, start, end, today)
    risk_lines = [
        f"{task['key']} {task['name']}: {task['level'].lower()} risk {task['score']} - "
        + "; ".join(f["detail"] for f in task["factors"])
        for task in insights["risks"]["tasks"][:25]
    ]
    workload_lines = [
        f"{names.get(row['user'], 'Unknown')}: {row['open_tasks']} open tasks, {row['overdue_tasks']} overdue, "
        f"{_hours(row['remaining_seconds'] // 60)} planned left of {_hours(row['capacity_seconds'] // 60)} "
        f"capacity ({row['status'].lower()})"
        for row in insights["workload"]["people"]
    ]
    team = evidence["team"]
    team_line = f"Team: {team['people_reporting']} of {team['people']} people reported {team['reported_hours']} h."
    return {
        "people": {"title": "Hours and reports per person", "text": "\n".join([team_line, *people_lines])},
        "daily_notes": {"title": "Day Report rows (date, person, task, minutes, note)", "text": "\n".join(note_lines)},
        "evidence": {"title": "Evidence of work per person", "text": "\n".join(evidence_lines)},
        "risks": {
            "title": "Open tasks at risk",
            "text": f"{insights['risks']['open_tasks']} open tasks.\n" + "\n".join(risk_lines),
        },
        "workload": {
            "title": "Workload per person",
            "text": f"{insights['workload']['unassigned_tasks']} unassigned tasks.\n" + "\n".join(workload_lines),
        },
    }
