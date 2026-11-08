"""Text splitting. PURE: strings in, (text, location-extras) out."""

from __future__ import annotations

import re

MAX_NOTE_CHARS = 1200
CODE_WINDOW_LINES = 60

_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")


def split_markdown(text: str, max_chars: int = MAX_NOTE_CHARS) -> list[tuple[str, dict]]:
    """Split by heading, then by paragraph, never exceeding max_chars (except for a single huge paragraph,
    which is hard-wrapped). Each piece carries its heading path and starting line number."""
    lines = text.splitlines()
    sections: list[tuple[list[str], int, list[str]]] = []  # (heading_path, start_line, body_lines)
    path: list[str] = []
    current: list[str] = []
    start = 1
    for i, line in enumerate(lines, start=1):
        m = _HEADING.match(line)
        if m:
            if any(s.strip() for s in current):
                sections.append((list(path), start, current))
            level = len(m.group(1))
            path = path[: level - 1] + [m.group(2)]
            current, start = [line], i
        else:
            current.append(line)
    if any(s.strip() for s in current):
        sections.append((list(path), start, current))

    out: list[tuple[str, dict]] = []
    for heading_path, start_line, body in sections:
        out.extend(_pack_paragraphs(body, start_line, heading_path, max_chars))
    return out


def _pack_paragraphs(body: list[str], start_line: int, heading_path: list[str], max_chars: int):
    paras: list[tuple[int, str]] = []
    buf: list[str] = []
    buf_start = start_line
    for offset, line in enumerate(body):
        if line.strip() == "" and buf:
            paras.append((buf_start, "\n".join(buf)))
            buf = []
        elif line.strip():
            if not buf:
                buf_start = start_line + offset
            buf.append(line)
    if buf:
        paras.append((buf_start, "\n".join(buf)))

    pieces: list[tuple[str, dict]] = []
    cur, cur_start = "", None
    for line_no, para in paras:
        for part in _hard_wrap(para, max_chars):
            if cur and len(cur) + 2 + len(part) > max_chars:
                pieces.append((cur, {"heading_path": heading_path, "line_start": cur_start}))
                cur, cur_start = "", None
            cur = f"{cur}\n\n{part}" if cur else part
            cur_start = cur_start or line_no
    if cur:
        pieces.append((cur, {"heading_path": heading_path, "line_start": cur_start}))
    return pieces


def _hard_wrap(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    out, rest = [], text
    while len(rest) > max_chars:
        cut = rest.rfind(" ", 0, max_chars)
        cut = cut if cut > max_chars // 2 else max_chars
        out.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        out.append(rest)
    return out


def split_code(text: str, window: int = CODE_WINDOW_LINES) -> list[tuple[str, dict]]:
    """Fixed line windows; location gets line_start/line_end so a quote can be pinned to its exact line."""
    lines = text.splitlines()
    out = []
    for i in range(0, max(len(lines), 1), window):
        part = lines[i : i + window]
        if any(p.strip() for p in part):
            out.append(("\n".join(part), {"line_start": i + 1, "line_end": i + len(part)}))
    return out


def line_of_offset(chunk_text: str, offset: int, line_start: int = 1) -> int:
    """Source line number for a character offset inside a chunk (used to show `upload.ts:41`)."""
    return line_start + chunk_text.count("\n", 0, max(offset, 0))
