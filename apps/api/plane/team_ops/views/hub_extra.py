# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Hub sections beyond chat: people and private messages, the Doc Hub, the Files library, Secrets and Flows."""

# Django imports
from django.db.models import Q

# Third party imports
from rest_framework import status
from rest_framework.exceptions import NotFound, ParseError
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectMember, User, Workspace
from plane.team_ops.models import Flow, HubAttachment, HubDoc, HubSecretAccess
from plane.team_ops.services import doc_pages, flows, hub, hub_files
from plane.team_ops.services import secrets as secret_service
from plane.team_ops.services.access import CALENDAR_ROLES, CalendarAccess, calendar_user_ids
from plane.team_ops.services.time_entry import parse_uuid
from plane.team_ops.views.hub import _channel_payload, _forbidden, _ids, person

MAX_TAGS = 10


def _member(request, slug):
    """The workspace and whether the caller is an admin, or `None` for someone who does not work in it."""
    workspace = Workspace.objects.get(slug=slug)
    access = CalendarAccess(request.user, workspace)
    return (workspace, access.is_admin) if access.is_calendar_user else (None, False)


class HubPeopleEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Everyone the caller can write to privately."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        users = User.objects.filter(pk__in=calendar_user_ids(workspace)).exclude(pk=request.user.pk)
        return Response({"results": [person(user) for user in users.order_by("display_name")]})


class HubDirectEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Open (or create) the private conversation with `user`."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        other = User.objects.filter(pk=parse_uuid(request.data.get("user"), "user")).first()
        if other is None:
            raise NotFound("Person not found.")
        channel = hub.dm_channel(workspace, request.user, other)
        return Response(_channel_payload(channel, 0, request.user, is_admin), status=status.HTTP_200_OK)


# ---- Doc Hub ----


def _tags(value):
    if value in (None, ""):
        return []
    if not isinstance(value, list) or len(value) > MAX_TAGS:
        raise ParseError(detail=f"At most {MAX_TAGS} tags.")
    cleaned = []
    for tag in value:
        tag = str(tag).strip().lower()[:30]
        if tag and tag not in cleaned:
            cleaned.append(tag)
    return cleaned


def _doc_payload(doc, full=False, files=None):
    data = {
        "id": doc.id,
        "title": doc.title,
        "tags": doc.tags,
        "project": {"id": doc.project_id, "name": doc.project.name, "identifier": doc.project.identifier}
        if doc.project_id
        else None,
        "author": person(doc.author),
        "updated_at": doc.updated_at,
        "excerpt": doc_pages.text_of(doc)[:200],
        # The Page that holds the text; the document is written there
        "page": doc.page_id,
        "file_count": len(files or []),
    }
    if full:
        data["body"] = doc_pages.text_of(doc)
        data["files"] = [_file_payload(item, "Document") for item in files or []]
    return data


def _files_of(docs):
    """The files of each document, one query for all of them: `{doc id: [attachment, ...]}`."""
    grouped = {}
    attachments = HubAttachment.objects.filter(doc__in=docs).select_related("uploaded_by").order_by("created_at")
    for attachment in attachments:
        grouped.setdefault(attachment.doc_id, []).append(attachment)
    return grouped


def _visible_docs(workspace, user, is_admin):
    return doc_pages.visible_docs(workspace, user, is_admin)


def _project_of(workspace, user, is_admin, raw):
    """The project a document or secret is tied to; only one the person belongs to (admins: any)."""
    if not raw:
        return None
    project = Project.objects.filter(workspace=workspace, pk=parse_uuid(raw, "project")).first()
    belongs = (
        project is not None and ProjectMember.objects.filter(project=project, member=user, is_active=True).exists()
    )
    if project is None or not (belongs or is_admin):
        raise ParseError(detail="Choose a project you are a member of.")
    return project


class HubDocListEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Documents the caller may read. Filters: `q` (title), `tag`, `project`."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        queryset = _visible_docs(workspace, request.user, is_admin)
        params = request.query_params
        if params.get("q"):
            queryset = queryset.filter(title__icontains=params["q"][:100])
        if params.get("project"):
            queryset = queryset.filter(project_id=parse_uuid(params["project"], "project"))
        docs = list(queryset[:200])
        if params.get("tag"):
            wanted = params["tag"].strip().lower()
            docs = [doc for doc in docs if wanted in doc.tags]
        tags = sorted({tag for doc in docs for tag in doc.tags})
        grouped = _files_of(docs)
        return Response({"results": [_doc_payload(doc, files=grouped.get(doc.id)) for doc in docs], "tags": tags})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        data = request.data
        title = str(data.get("title", "")).strip()
        if not title or len(title) > 200:
            raise ParseError(detail="Give the document a title.")
        body = str(data.get("body", ""))
        if len(body) > 100000:
            raise ParseError(detail="The document is too long.")
        doc = HubDoc.objects.create(
            workspace=workspace,
            author=request.user,
            title=title,
            body=body,
            tags=_tags(data.get("tags")),
            project=_project_of(workspace, request.user, is_admin, data.get("project")),
        )
        doc_pages.link_page(doc)
        return Response(_doc_payload(doc, full=True, files=[]), status=status.HTTP_201_CREATED)


class HubDocDetailEndpoint(BaseAPIView):
    def _doc(self, request, slug, pk):
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return None, None, False
        doc = _visible_docs(workspace, request.user, is_admin).filter(pk=pk).first()
        if doc is None:
            raise NotFound("Document not found.")
        return workspace, doc, is_admin

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, pk):
        workspace, doc, _ = self._doc(request, slug, pk)
        if workspace is None:
            return _forbidden()
        return Response(_doc_payload(doc, full=True, files=_files_of([doc]).get(doc.id)))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def patch(self, request, slug, pk):
        workspace, doc, is_admin = self._doc(request, slug, pk)
        if workspace is None:
            return _forbidden()
        if doc.author_id != request.user.id and not is_admin:
            raise ParseError(detail="You can only change your own documents.")
        data = request.data
        if "title" in data:
            title = str(data["title"]).strip()
            if not title or len(title) > 200:
                raise ParseError(detail="Give the document a title.")
            doc.title = title
        if "body" in data and not doc.page_id:
            if len(str(data["body"])) > 100000:
                raise ParseError(detail="The document is too long.")
            doc.body = str(data["body"])
        if "tags" in data:
            doc.tags = _tags(data["tags"])
        if "project" in data:
            doc.project = _project_of(workspace, request.user, is_admin, data["project"])
        doc.save()
        doc_pages.rename_page(doc)
        doc_pages.link_page(doc)
        return Response(_doc_payload(doc, full=True, files=_files_of([doc]).get(doc.id)))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        workspace, doc, is_admin = self._doc(request, slug, pk)
        if workspace is None:
            return _forbidden()
        if doc.author_id != request.user.id and not is_admin:
            raise ParseError(detail="You can only delete your own documents.")
        for attachment in HubAttachment.objects.filter(doc=doc):
            attachment.delete()
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---- Files ----


def _file_payload(attachment, source):
    return {
        "id": attachment.id,
        "name": attachment.name,
        "content_type": attachment.content_type,
        "size": attachment.size,
        "uploaded_by": person(attachment.uploaded_by),
        "created_at": attachment.created_at,
        "source": source,
    }


class HubFileLibraryEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Files shared with the workspace without a document, and files from the channels the caller can read.

        The files of a document are listed with that document.
        """
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        channels = {channel.id: channel for channel in hub.channels_of(workspace, request.user)}
        queryset = (
            HubAttachment.objects.filter(workspace=workspace)
            .filter(
                Q(library=True, doc__isnull=True) | Q(message__channel_id__in=list(channels), message__is_deleted=False)
            )
            .select_related("uploaded_by", "message")
            .order_by("-created_at")[:300]
        )
        results = []
        for attachment in queryset:
            if attachment.library:
                source = "Library"
            else:
                source = hub.channel_name(channels[attachment.message.channel_id], request.user)
            results.append(_file_payload(attachment, source))
        return Response({"results": results})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """Put files on a document (`doc`: its author or an admin), or share them with the whole workspace."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        doc = None
        if request.data.get("doc"):
            doc_id = parse_uuid(request.data["doc"], "doc")
            doc = _visible_docs(workspace, request.user, is_admin).filter(pk=doc_id).first()
            if doc is None:
                raise NotFound("Document not found.")
            if doc.author_id != request.user.id and not is_admin:
                raise ParseError(detail="Only the author of a document can add files to it.")
        files = request.FILES.getlist("files")
        if not files or len(files) > hub_files.MAX_FILES_PER_MESSAGE:
            raise ParseError(detail=f"Send 1 to {hub_files.MAX_FILES_PER_MESSAGE} files.")
        for upload in files:
            hub_files.validate_upload(upload)
        stored = [
            hub_files.store_attachment(
                workspace=workspace, user=request.user, upload=upload, library=doc is None, doc=doc
            )
            for upload in files
        ]
        source = "Document" if doc else "Library"
        return Response({"results": [_file_payload(item, source) for item in stored]}, status=status.HTTP_201_CREATED)


class HubFileLibraryDetailEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        """Remove a shared file or a file of a document: its uploader, the author of the document, or an admin."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        attachment = (
            HubAttachment.objects.filter(pk=pk, workspace=workspace)
            .filter(Q(library=True) | Q(doc__isnull=False))
            .select_related("doc")
            .first()
        )
        if attachment is None:
            raise NotFound("File not found.")
        if (
            attachment.doc_id
            and not _visible_docs(workspace, request.user, is_admin).filter(pk=attachment.doc_id).exists()
        ):
            raise NotFound("File not found.")
        owns = attachment.uploaded_by_id == request.user.id or (
            attachment.doc_id and attachment.doc.author_id == request.user.id
        )
        if not owns and not is_admin:
            raise ParseError(detail="You can only remove your own files.")
        attachment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---- Secrets ----


def _secret_payload(secret, viewer):
    mine = secret.publisher_id == viewer.id
    data = {
        "id": secret.id,
        "name": secret.name,
        "description": secret.description,
        "kind": secret.kind,
        "e2e": secret.e2e,
        "publisher": person(secret.publisher),
        "project": {"id": secret.project_id, "name": secret.project.name} if secret.project_id else None,
        "is_publisher": mine,
        "updated_at": secret.updated_at,
    }
    if mine:
        rows = list(HubSecretAccess.objects.filter(secret=secret).values_list("user_id", "wrapped_key"))
        data["shared_with"] = [str(user_id) for user_id, _ in rows]
        # Readers still waiting for their key (they had no vault when it was shared).
        data["waiting"] = [str(user_id) for user_id, key in rows if secret.e2e and not key]
        # The secret's key, wrapped for the publisher: only their own vault can open it. Needed to share it.
        data["owner_key"] = secret.owner_key
    else:
        data["is_waiting"] = (
            secret.e2e
            and not HubSecretAccess.objects.filter(secret=secret, user=viewer).exclude(wrapped_key="").exists()
        )
    return data


class HubVaultEndpoint(BaseAPIView):
    """The caller's vault: a key pair whose private half is locked by a passphrase only they know."""

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        vault = secret_service.vault_of(workspace, request.user)
        response = Response({"vault": secret_service.vault_payload(vault)})
        response["Cache-Control"] = "no-store"
        return response

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        vault = secret_service.create_vault(workspace, request.user, request.data)
        return Response({"vault": secret_service.vault_payload(vault)}, status=status.HTTP_201_CREATED)

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def put(self, request, slug):
        """A new passphrase for the same keys."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        vault = secret_service.change_passphrase(workspace, request.user, request.data)
        return Response({"vault": secret_service.vault_payload(vault)})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug):
        """Forgotten passphrase: start again. The caller's own secrets are lost."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        return Response(secret_service.reset_vault(workspace, request.user))


class HubVaultKeysEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Public keys of colleagues (`?users=a,b`) who have a vault."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        raw = [value for value in request.query_params.get("users", "").split(",") if value]
        ids = {parse_uuid(value, "users") for value in raw[:200]}
        return Response({"keys": secret_service.public_keys(workspace, ids)})


class HubVaultPendingEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Readers of the caller's secrets who are waiting for their key and now have a vault."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        return Response({"results": secret_service.pending(workspace, request.user)})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        return Response({"done": secret_service.fill_pending(workspace, request.user, request.data.get("items"))})


class HubSecretListEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Secrets the caller published or was given. The values are never in the list."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        rows = secret_service.visible(workspace, request.user)
        return Response({"results": [_secret_payload(secret, request.user) for secret in rows]})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        """A secret sealed in the browser: ciphertext, nonce, and its key wrapped for the publisher and readers."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        data = request.data
        project = _project_of(workspace, request.user, is_admin, data.get("project"))
        keys = secret_service.parse_keys(data)
        secret = secret_service.publish(workspace, request.user, data, project)
        if data.get("users"):
            secret_service.set_access(secret, request.user, _ids(request, "users"), keys)
        return Response(_secret_payload(secret, request.user), status=status.HTTP_201_CREATED)


class HubSecretDetailEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def patch(self, request, slug, pk):
        """Change the name, info or value. Only the publisher."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        secret = secret_service.get_published(workspace, request.user, pk)
        secret_service.update(secret, request.user, request.data)
        return Response(_secret_payload(secret, request.user))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        secret_service.get_published(workspace, request.user, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HubSecretRevealEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug, pk):
        """What the caller's browser needs to open the value (never the value itself). Every reveal is logged."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        secret = secret_service.get_visible(workspace, request.user, pk)
        response = Response(secret_service.reveal(secret, request.user))
        response["Cache-Control"] = "no-store"
        return response


class HubSecretConvertEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug, pk):
        """An old server-key secret, sealed again in the publisher's browser."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        secret = secret_service.get_published(workspace, request.user, pk)
        secret_service.convert(secret, request.user, request.data)
        return Response(_secret_payload(secret, request.user))


class HubSecretAccessEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def put(self, request, slug, pk):
        """Replace the list of people who may read the secret. Only the publisher."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        secret = secret_service.get_published(workspace, request.user, pk)
        keys = secret_service.parse_keys(request.data)
        secret_service.set_access(secret, request.user, _ids(request, "users"), keys)
        return Response(_secret_payload(secret, request.user))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, pk):
        """Who did what with the secret (never the value). Only the publisher."""
        workspace, _ = _member(request, slug)
        if workspace is None:
            return _forbidden()
        secret = secret_service.get_published(workspace, request.user, pk)
        rows = secret.log.select_related("user", "target")[:100]
        return Response(
            {
                "results": [
                    {
                        "action": row.action,
                        "user": person(row.user),
                        "target": person(row.target) if row.target else None,
                        "at": row.created_at,
                    }
                    for row in rows
                ]
            }
        )


# ---- Flows ----


class FlowListEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """Flows of the projects the caller belongs to (admins: all), each with everyone's progress."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        rows = flows.visible_flows(workspace, request.user, is_admin)
        return Response({"results": [flows.describe(flow) for flow in rows], "can_manage": True})

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        project = flows.project_for(workspace, request.data.get("project"))
        if not flows.can_edit(request.user, project, is_admin):
            return _forbidden()
        flow = flows.save_flow(
            workspace, project, request.data.get("name"), request.data.get("stages"), actor=request.user
        )
        return Response(flows.describe(flow), status=status.HTTP_201_CREATED)


class FlowDetailEndpoint(BaseAPIView):
    def _flow(self, workspace, pk):
        flow = Flow.objects.filter(workspace=workspace, pk=pk).select_related("project").first()
        if flow is None:
            raise NotFound("Flow not found.")
        return flow

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def put(self, request, slug, pk):
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        flow = self._flow(workspace, pk)
        if not flows.can_edit(request.user, flow.project, is_admin):
            return _forbidden()
        flows.save_flow(
            workspace,
            flow.project,
            request.data.get("name"),
            request.data.get("stages"),
            flow=flow,
            actor=request.user,
        )
        return Response(flows.describe(flow))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        flow = self._flow(workspace, pk)
        if not flows.can_edit(request.user, flow.project, is_admin):
            return _forbidden()
        flow.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class FlowSuggestionsEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug, pk):
        """Work the caller can pick up (pull) or join (merge) when nothing of theirs is left in the project."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        flow = Flow.objects.filter(workspace=workspace, pk=pk).select_related("project").first()
        if flow is None or not flows.can_edit(request.user, flow.project, False):
            raise NotFound("Flow not found.")
        return Response(flows.suggestions(flow, request.user))

    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def post(self, request, slug, pk):
        """Take the work item `issue`."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        flow = Flow.objects.filter(workspace=workspace, pk=pk).select_related("project").first()
        if flow is None or not flows.can_edit(request.user, flow.project, False):
            raise NotFound("Flow not found.")
        result = flows.pull(flow, request.user, parse_uuid(request.data.get("issue"), "issue"))
        return Response(result, status=status.HTTP_201_CREATED)


class FlowProjectModulesEndpoint(BaseAPIView):
    @allow_permission(CALENDAR_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        """The modules of a project, with the people on them, for drawing its flow: `?project=<id>`."""
        workspace, is_admin = _member(request, slug)
        if workspace is None:
            return _forbidden()
        project = flows.project_for(workspace, request.query_params.get("project"))
        if not flows.can_edit(request.user, project, is_admin):
            return _forbidden()
        return Response({"results": flows.modules_of_project(project)})
