# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The work items of a module and the relations between them, for the relation graph of the module page."""

# Django imports
from django.db.models import Q

# Module imports
from plane.db.models import Issue, IssueRelation, ModuleIssue

# A relation row `issue` -> `related_issue` of this stored type reads as this edge.
# `blocked_by`: `issue` is blocked by `related_issue`, so the edge runs from `related_issue` to `issue`.
EDGES = {"blocked_by": "blocking", "duplicate": "duplicate", "relates_to": "relates_to"}


def module_relations(module):
    """`{issues: [...], relations: [{id, from, to, type}]}`; only relations between work items of the module."""
    ids = list(ModuleIssue.objects.filter(module=module, deleted_at__isnull=True).values_list("issue_id", flat=True))
    issues = Issue.issue_objects.filter(pk__in=ids).select_related("project", "state").order_by("sequence_id")
    rows = IssueRelation.objects.filter(Q(issue_id__in=ids) & Q(related_issue_id__in=ids), relation_type__in=EDGES)
    relations = []
    for row in rows:
        kind = EDGES[row.relation_type]
        first, second = (
            (row.related_issue_id, row.issue_id) if kind == "blocking" else (row.issue_id, row.related_issue_id)
        )
        relations.append({"id": row.id, "from": first, "to": second, "type": kind})
    return {
        "issues": [
            {
                "id": issue.id,
                "key": f"{issue.project.identifier}-{issue.sequence_id}",
                "name": issue.name,
                "state_group": issue.state.group if issue.state_id else None,
                # the work item it is a sub work item of, when that one is in the module too
                "parent": issue.parent_id if issue.parent_id in set(ids) else None,
            }
            for issue in issues
        ],
        "relations": relations,
    }
