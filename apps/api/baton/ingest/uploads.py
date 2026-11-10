"""Uploaded notes/documents (.md, .txt, .pdf, .docx) -> chunks."""

from __future__ import annotations

import io
import re
import zipfile
from datetime import UTC, datetime
from xml.etree import ElementTree

from baton.ingest.chunker import split_markdown
from baton.ingest.types import ChunkDraft

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
ALLOWED_EXT = (".md", ".markdown", ".txt", ".pdf", ".docx")
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024
MAX_PDF_PAGES = 300  # uncompressed document.xml cap (zip-bomb guard)
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

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
        raise UploadRejected(f"{name}: only .md, .txt, .pdf and .docx files are supported")
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadRejected(f"{name}: file is larger than 2 MB")

    if lower.endswith(".pdf"):
        return _parse_pdf(name, data)
    if lower.endswith(".docx"):
        text = docx_to_markdown(name, data)
        when = guess_date(name, text)
        drafts = [ChunkDraft("note_para", piece, {"file": name, **extra}, None, when) for piece, extra in split_markdown(text)]
        if not drafts:
            raise UploadRejected(f"{name}: the document has no text")
        return drafts

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
    if len(reader.pages) > MAX_PDF_PAGES:
        raise UploadRejected(f"{name}: more than {MAX_PDF_PAGES} pages; split it or upload the relevant part")
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


def docx_to_markdown(name: str, data: bytes) -> str:
    """Word (.docx) -> Markdown-ish text using only the standard library: headings become '#' lines (so citations
    can say which section a quote came from), list items become '-', table rows become ' | '-joined lines."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise UploadRejected(f"{name}: document is too large once unpacked")
            xml = z.read(info)
    except UploadRejected:
        raise
    except (KeyError, zipfile.BadZipFile) as exc:
        raise UploadRejected(f"{name}: not a valid Word .docx file") from exc
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        raise UploadRejected(f"{name}: could not read the document ({type(exc).__name__})") from exc
    body = root.find(f"{_W}body")
    if body is None:
        return ""
    lines: list[str] = []
    for el in body:
        if el.tag == f"{_W}p":
            line = _para(el)
            if line:
                lines.append(line)
        elif el.tag == f"{_W}tbl":
            for row in el.iter(f"{_W}tr"):
                cells = [" ".join(t.text or "" for t in c.iter(f"{_W}t")).strip() for c in row.iter(f"{_W}tc")]
                if any(cells):
                    lines.append(" | ".join(cells))
            lines.append("")
    return "\n".join(lines)


def _para(p) -> str:
    text = "".join((t.text or "") for t in p.iter(f"{_W}t")).strip()
    if not text:
        return ""
    style = p.find(f"{_W}pPr/{_W}pStyle")
    sid = (style.get(f"{_W}val") if style is not None else "") or ""
    m = re.match(r"(?i)heading\s*(\d)", sid)
    level = 1 if re.fullmatch(r"(?i)title", sid) else (int(m.group(1)) if m else 0)
    if level:
        return "\n" + "#" * min(level, 4) + " " + text
    if p.find(f"{_W}pPr/{_W}numPr") is not None:
        return "- " + text
    return text + "\n"
