# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Doc Hub documents that belong to a project live as Plane Pages, so they are written in Plane's own editor."""

# Django imports
from django.utils.html import escape

# Module imports
from plane.db.models import Page, ProjectPage


def _html(text):
    paragraphs = [line for line in str(text).split("\n")]
    return "".join(f"<p>{escape(line)}</p>" for line in paragraphs) or "<p></p>"


def link_page(doc):
    """Make the Page of a document that has a project and none yet. The text moves into the Page."""
    if doc.page_id or not doc.project_id:
        return doc
    page = Page.objects.create(
        workspace_id=doc.workspace_id,
        owned_by=doc.author,
        name=doc.title,
        description_html=_html(doc.body),
        access=Page.PUBLIC_ACCESS,
    )
    ProjectPage.objects.create(workspace_id=doc.workspace_id, project_id=doc.project_id, page=page)
    doc.page = page
    doc.body = ""
    doc.save(update_fields=["page", "body", "updated_at"])
    return doc


def rename_page(doc):
    if doc.page_id and doc.page.name != doc.title:
        doc.page.name = doc.title
        doc.page.save(update_fields=["name", "updated_at"])


def text_of(doc):
    """What a document says: its Page's text when it has one."""
    if doc.page_id:
        return (doc.page.description_stripped or "").strip()
    return doc.body
