"""Word (.docx) uploads: headings become citation sections; bad or oversized files are rejected cleanly."""

import io
import zipfile

import pytest

from baton.ingest.uploads import UploadRejected, docx_to_markdown, parse_upload

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _docx(body_xml: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document {W}><w:body>{body_xml}</w:body></w:document>')
    return buf.getvalue()


def _p(text: str, style: str | None = None, bullet: bool = False) -> str:
    ppr = ""
    if style or bullet:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "") + ("<w:numPr/>" if bullet else "") + "</w:pPr>"
    return f"<w:p>{ppr}<w:r><w:t>{text}</w:t></w:r></w:p>"


DOC = _docx(
    _p("Fest sync 2026-04-02", "Title")
    + _p("Uploads", "Heading1")
    + _p("Posters are limited to 5 MB because campus Wi-Fi times out.")
    + _p("Kabir checks Cloudinary usage after the fest", bullet=True)
    + "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rohan</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
)


def test_docx_headings_lists_and_tables():
    md = docx_to_markdown("sync.docx", DOC)
    assert "# Fest sync 2026-04-02" in md and "# Uploads" in md
    assert "- Kabir checks Cloudinary usage after the fest" in md and "Owner | Rohan" in md


def test_docx_becomes_cited_chunks_with_date():
    drafts = parse_upload("sync.docx", DOC)
    assert drafts and all(d.location["file"] == "sync.docx" for d in drafts)
    assert any("5 MB" in d.text for d in drafts)
    assert drafts[0].occurred_at is not None and drafts[0].occurred_at.month == 4


def test_bad_docx_is_rejected_not_crashing():
    with pytest.raises(UploadRejected, match="not a valid Word"):
        parse_upload("broken.docx", b"PK\x03\x04 not really a zip")
    with pytest.raises(UploadRejected, match="only .md, .txt, .pdf and .docx"):
        parse_upload("macro.docm", b"x")
