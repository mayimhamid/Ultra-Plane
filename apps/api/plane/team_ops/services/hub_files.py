# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Files in the Hub. They live in Plane's private object storage and are only reached through the API.

Nothing is public: an upload is checked (size, type, name) and stored under an unguessable key, and a
download is a short-lived signed link handed out only to someone who may read the message.
"""

# Python imports
import mimetypes
import os
import re
import uuid
from types import SimpleNamespace
from urllib.parse import urlparse

# Third party imports
from rest_framework.exceptions import ParseError

# Module imports
from plane.team_ops.models import HubAttachment
from plane.utils.host import request_origin

MAX_UPLOAD_BYTES = int(os.environ.get("TEAM_OPS_MAX_UPLOAD_BYTES", 20 * 1024 * 1024))
MAX_FILES_PER_MESSAGE = 10
DOWNLOAD_LINK_SECONDS = 300

# Any file type may be shared except the ones that run code when opened, or that a browser would run when shown.
BLOCKED_EXTENSIONS = {
    "exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys", "drv", "ocx",
    "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "mjs", "cjs", "wsf", "wsh", "hta", "lnk", "reg", "inf",
    "jar", "app", "apk", "dmg", "pkg", "deb", "rpm", "sh", "bash", "zsh", "csh", "command", "run", "bin",
    "html", "htm", "xhtml", "shtml", "mht", "mhtml", "svg", "svgz", "xml", "xsl", "xslt", "php", "phtml",
    "asp", "aspx", "jsp", "cgi", "pl", "py", "rb", "swf",
}  # fmt: skip

# What the browser says a file is cannot be trusted (Windows sends nothing at all for .md, for example).
# The type that is stored, and sent on download, comes from the extension instead.
GENERIC_TYPES = {"", "application/octet-stream", "binary/octet-stream", "application/unknown"}

# Extension -> its known content types; the first one is stored. Other extensions are stored by their
# usual type (from `mimetypes`) or as a plain download.
ALLOWED_TYPES = {
    "png": {"image/png"},
    "jpg": {"image/jpeg"},
    "jpeg": {"image/jpeg"},
    "gif": {"image/gif"},
    "webp": {"image/webp"},
    "pdf": {"application/pdf"},
    "txt": {"text/plain"},
    "md": {"text/markdown", "text/plain", "text/x-markdown"},
    "csv": {"text/csv", "application/vnd.ms-excel", "text/plain"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    "pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
}

CANONICAL_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "pdf": "application/pdf",
    "txt": "text/plain",
    "md": "text/markdown",
    "csv": "text/csv",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

# The first bytes of the formats that have a fixed signature, so a renamed file is not accepted.
SIGNATURES = {
    "png": b"\x89PNG\r\n\x1a\n",
    "jpg": b"\xff\xd8\xff",
    "jpeg": b"\xff\xd8\xff",
    "gif": b"GIF8",
    "pdf": b"%PDF-",
    "docx": b"PK\x03\x04",
    "xlsx": b"PK\x03\x04",
    "pptx": b"PK\x03\x04",
}


def get_storage(request=None):
    """The object storage client. Separate so tests can replace it.

    With a `request` (MinIO only) links are signed for the address the person is using, and the proxy in front of
    Plane sends them on to the storage. Without one they are signed for the storage's own internal address, which
    is fine for the server itself and useless in a browser.
    """
    from plane.settings.storage import S3Storage

    return S3Storage(request=request)


def public_request(request):
    """What `S3Storage` needs to sign a link for the address the person is on: its scheme and host.

    When that address is one of the site's configured origins its own scheme is used, so a proxy that hands the
    request over as plain http cannot turn the link into an http one.
    """
    origin = request_origin(request)
    if origin:
        parsed = urlparse(origin)
        return SimpleNamespace(scheme=parsed.scheme, get_host=lambda: parsed.netloc)
    return request


def clean_name(name):
    """A file name safe to show and to put in a header: no path, no control characters, bounded length."""
    base = os.path.basename((name or "").replace("\\", "/"))
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip().strip(".")
    return base[:200]


# Python's own table only, not the machine's (Windows reads the registry), so every server answers the same.
_BUILT_IN_TYPES = mimetypes.MimeTypes()


def content_type_of(extension):
    """The type a file is stored and served with, from its extension. Never one a browser would run."""
    known = CANONICAL_TYPES.get(extension)
    if known:
        return known
    guessed = (_BUILT_IN_TYPES.guess_type(f"file.{extension}")[0] or "").lower()
    if not guessed or "html" in guessed or "xml" in guessed or "javascript" in guessed or guessed == "image/svg+xml":
        return "application/octet-stream"
    return guessed


def validate_upload(upload):
    """Check a Django `UploadedFile`; return `(name, extension)` or raise a 400.

    Every type is allowed except `BLOCKED_EXTENSIONS`. Formats with a fixed signature (images, PDF, Office)
    must really be what their name says, so a renamed file is refused.
    """
    name = clean_name(upload.name)
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if not name or not extension:
        raise ParseError(detail="The file needs a name with an extension, e.g. notes.md.")
    if extension in BLOCKED_EXTENSIONS:
        raise ParseError(detail=f"For safety, .{extension} files cannot be shared. Put them in a .zip first.")
    if upload.size > MAX_UPLOAD_BYTES:
        raise ParseError(detail=f"A file can be at most {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    if upload.size == 0:
        raise ParseError(detail="The file is empty.")
    declared = (upload.content_type or "").split(";")[0].strip().lower()
    if declared.startswith("image/") and extension not in CANONICAL_TYPES:
        # an image type on an unknown extension (e.g. .svg renamed) is never shown inline
        declared = ""
    if extension in ALLOWED_TYPES and declared not in GENERIC_TYPES and declared not in ALLOWED_TYPES[extension]:
        # a known extension with a clearly different type: e.g. an .exe renamed to .pdf
        if not (declared.startswith("text/") and extension in {"txt", "md", "csv"}):
            raise ParseError(detail="The file type does not match its name.")
    signature = SIGNATURES.get(extension)
    if signature:
        head = upload.read(len(signature))
        upload.seek(0)
        if not head.startswith(signature):
            raise ParseError(detail="The file content does not match its type.")
    return name, extension


def store_attachment(*, workspace, user, upload, message=None, session=None, library=False):
    """Validate and upload one file, and record it."""
    name, extension = validate_upload(upload)
    key = f"team-ops/{workspace.id}/{uuid.uuid4().hex}/{uuid.uuid4().hex}.{extension}"
    content_type = content_type_of(extension)
    if not get_storage().upload_file(upload, key, content_type):
        raise ParseError(detail="The file could not be stored. Try again.")
    return HubAttachment.objects.create(
        workspace=workspace,
        uploaded_by=user,
        message=message,
        session=session,
        library=library,
        storage_key=key,
        name=name,
        content_type=content_type,
        size=upload.size,
    )


def download_url(attachment, request=None):
    """A signed link that works for a few minutes. Images may show inline; everything else downloads.

    Pass the `request` so the link points at the address the person opened the site on.
    """
    storage = get_storage(public_request(request)) if request is not None else get_storage()
    return storage.generate_presigned_url(
        attachment.storage_key,
        expiration=DOWNLOAD_LINK_SECONDS,
        disposition="inline" if attachment.content_type.startswith("image/") else "attachment",
        filename=attachment.name,
        content_type=attachment.content_type,
    )
