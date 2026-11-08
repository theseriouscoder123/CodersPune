"""Uploaded notes/documents (.md, .txt, .pdf) -> chunks."""

from __future__ import annotations

import io
import re
from datetime import UTC, datetime

from baton.ingest.chunker import split_markdown
from baton.ingest.types import ChunkDraft

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
ALLOWED_EXT = (".md", ".markdown", ".txt", ".pdf")

_DATE = re.compile(r"(20\d{2})-(\d{2})-(\d{2})")


class UploadRejected(ValueError):
    pass


def guess_date(filename: str, text: str) -> datetime | None:
    """Date from the first heading (e.g. '# Meeting — 2026-04-02'), front matter, or the filename."""
    head = "\n".join(text.splitlines()[:8])
    for candidate in (head, filename):
        m = _DATE.search(candidate)
        if m:
            try:
                return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, tzinfo=UTC)
            except ValueError:
                continue
    return None


def parse_upload(filename: str, data: bytes) -> list[ChunkDraft]:
    name = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    lower = name.lower()
    if not lower.endswith(ALLOWED_EXT):
        raise UploadRejected(f"{name}: only .md, .txt and .pdf files are supported")
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadRejected(f"{name}: file is larger than 2 MB")

    if lower.endswith(".pdf"):
        return _parse_pdf(name, data)

    text = data.decode("utf-8", errors="replace")
    when = guess_date(name, text)
    return [
        ChunkDraft("note_para", piece, {"file": name, **extra}, None, when)
        for piece, extra in split_markdown(text)
    ]


def _parse_pdf(name: str, data: bytes) -> list[ChunkDraft]:
    from pypdf import PdfReader  # imported lazily: only needed for PDFs

    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise UploadRejected(f"{name}: could not read PDF ({type(exc).__name__})") from exc
    drafts: list[ChunkDraft] = []
    first_page = ""
    for page_no, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if page_no == 1:
            first_page = text
        for piece, extra in split_markdown(text):
            drafts.append(ChunkDraft("note_para", piece, {"file": name, "page": page_no, **extra}))
    when = guess_date(name, first_page)
    for d in drafts:
        d.occurred_at = when
    if not drafts:
        raise UploadRejected(f"{name}: no extractable text (scanned PDFs aren't supported)")
    return drafts
