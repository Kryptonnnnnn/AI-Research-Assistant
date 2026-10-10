"""Upload validation: extension, MIME type, magic bytes, size, filename hygiene."""

from __future__ import annotations

import io
import re
import unicodedata
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath

from app.core.errors import PayloadTooLarge, ValidationFailed

ALLOWED: dict[str, set[str]] = {
    ".pdf": {"application/pdf"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/x-markdown", "text/plain"},
    ".markdown": {"text/markdown", "text/x-markdown", "text/plain"},
}
GENERIC_MIME = {"application/octet-stream", "", "binary/octet-stream"}
CANONICAL_MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
}


@dataclass(frozen=True)
class ValidatedUpload:
    display_name: str
    ext: str
    mime: str
    internal_name: str


def sanitize_filename(raw: str) -> str:
    """Return a safe display name: basename only, no control chars, bounded length."""
    name = PureWindowsPath(PurePosixPath(raw or "").name).name  # strips both / and \ components
    name = unicodedata.normalize("NFKC", name)
    name = re.sub(r"[\x00-\x1f\x7f<>:\"|?*]", "", name).strip(" .")
    if len(name) > 200:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: 200 - len(ext) - 1] + dot + ext) if dot else name[:200]
    return name or "document"


def validate_metadata(filename: str, content_type: str | None) -> ValidatedUpload:
    display = sanitize_filename(filename)
    ext = PurePosixPath(display).suffix.lower()
    if ext not in ALLOWED:
        raise ValidationFailed(
            f"Unsupported file type '{ext or 'unknown'}'. Allowed: PDF, DOCX, TXT, Markdown (.md).",
            code="unsupported_type",
        )
    mime = (content_type or "").split(";")[0].strip().lower()
    if mime not in GENERIC_MIME and mime not in ALLOWED[ext]:
        raise ValidationFailed(f"The declared content type '{mime}' does not match a '{ext}' file.", code="mime_mismatch")
    return ValidatedUpload(display, ext, CANONICAL_MIME[ext], f"{uuid.uuid4().hex}{ext}")


def validate_content(data: bytes, ext: str, max_bytes: int) -> None:
    if len(data) == 0:
        raise ValidationFailed("The file is empty.", code="empty_file")
    if len(data) > max_bytes:
        raise PayloadTooLarge(f"File exceeds the {max_bytes // (1024 * 1024)} MB limit.", code="file_too_large")
    if ext == ".pdf":
        if not data.lstrip()[:5] == b"%PDF-":
            raise ValidationFailed("File content is not a valid PDF (bad signature).", code="bad_signature")
    elif ext == ".docx":
        if data[:4] != b"PK\x03\x04":
            raise ValidationFailed("File content is not a valid DOCX (bad signature).", code="bad_signature")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                if "word/document.xml" not in z.namelist():
                    raise ValidationFailed("File is not a Word document.", code="bad_signature")
                total = sum(i.file_size for i in z.infolist())
                if total > 200 * 1024 * 1024:  # zip-bomb guard
                    raise ValidationFailed("DOCX expands to an unreasonable size.", code="bad_signature")
        except zipfile.BadZipFile as exc:
            raise ValidationFailed("DOCX file is corrupted.", code="corrupted") from exc
    else:
        if b"\x00" in data[:8192]:
            raise ValidationFailed("File looks binary, not text.", code="bad_signature")
