"""Round 3 improvement #3 (part 2): re-render a withheld claim from sources the successor CAN see.

A claim is withheld from the successor when any source it cites is restricted for them (trust rule 5). Sometimes
the same fact is also stated in a source they can read. Re-rendering looks for that, and nothing else:

* Retrieval runs locally (Postgres full-text search) and keeps ONLY chunks whose source the successor may read.
* The model sees a topic label (the claim's type and subject key) and those passages. It never sees the withheld
  claim's text or any restricted chunk, so restricted wording cannot leak through the model.
  `assert_only_visible` enforces this, and a test pins it.
* The model must copy a quote from one of the passages; the quote check (>= 90) and the separate verifier run as for
  every other claim, and status.py decides the status. A re-rendered claim is linked to the original
  (`claims.derived_from`) and still needs the reviewer's approval before the successor sees it (trust rule 8).
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.acl import Viewer, can_view_acl
from baton.db.models import Chunk, Source

MAX_PASSAGES = 6
PASSAGE_CHARS = 900
STOP = frozenset("""about after again also and are because been before being between both but can could does doing
from have having here into just more most must need needs only other over same should some such than that their them
then there these they this those through under until very were what when where which while will with would your
project team the for not was has had its""".split())


class Rerendered(BaseModel):
    possible: bool = Field(description="false if the passages don't state anything useful about the topic")
    claim: str | None = Field(default=None, description="one plain sentence, only facts stated in the passages")
    passage: str | None = Field(default=None, description="the label of the passage the quote comes from, e.g. P2")
    quote: str | None = Field(default=None, description="an exact span copied from that passage that states the claim")
    reason: str = Field(description="at most 20 words")


RERENDER_SYSTEM = """You write one short handover statement for a new team member, using ONLY the passages given.
Rules:
- Use only facts stated in the passages. Never add numbers, names, dates or conditions that are not in them.
- The topic tells you what kind of statement is wanted. If the passages say nothing useful about it, set possible=false.
- quote must be copied character for character from the passage you name. Keep it short (one sentence or less).
- Write the claim as one plain sentence."""


def search_terms(text: str, limit: int = 8) -> list[str]:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    out: list[str] = []
    for w in words:
        if len(w) > 3 and w not in STOP and w not in out:
            out.append(w)
    return out[:limit]


def candidate_chunks(db: Session, workspace_id, viewer: Viewer, terms: list[str], exclude_source_ids: set) -> list[Chunk]:
    """Chunks matching any term, ranked, restricted to sources the viewer may read (checked in code, per row)."""
    if not terms:
        return []
    tsq = func.to_tsquery("english", " | ".join(terms))
    rows = db.execute(select(Chunk, Source.acl, Source.id).join(Source, Source.id == Chunk.source_id)
                      .where(Chunk.workspace_id == workspace_id, Chunk.tsv.op("@@")(tsq))
                      .order_by(func.ts_rank(Chunk.tsv, tsq).desc()).limit(40))
    out = []
    for ch, acl, sid in rows:
        if sid in exclude_source_ids or not can_view_acl(viewer, acl):
            continue
        out.append(ch)
        if len(out) >= MAX_PASSAGES:
            break
    return out


def assert_only_visible(chunks: list[Chunk], allowed_ids: set) -> None:
    bad = [str(c.id) for c in chunks if c.id not in allowed_ids]
    if bad:
        raise PermissionError(f"refusing to send {len(bad)} chunk(s) the successor can't read")


def build_prompt(topic: str, kind: str, chunks: list[Chunk]) -> tuple[str, dict[str, Chunk]]:
    labels = {f"P{i}": ch for i, ch in enumerate(chunks, start=1)}
    passages = "\n\n".join(f"[{k}]\n{ch.text[:PASSAGE_CHARS]}" for k, ch in labels.items())
    return f"Topic: {topic}\nKind of statement: {kind.replace('_', ' ')}\n\nPassages:\n{passages}", labels


_DEADLINE = re.compile(r"\b(by|before|until|due|deadline|no later than)\b[^.]{0,40}?\b(\d{1,2}\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|"
                       r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?\d{1,2}|\d{4}-\d{2}-\d{2})", re.IGNORECASE)


def looks_like_theirs(text: str, name: str | None) -> str | None:
    """Why a withheld item probably matters to this person: it names them, or it carries a deadline."""
    if name and re.search(rf"\b{re.escape(name)}\b", text or "", re.IGNORECASE):
        return f"It names {name}"
    if _DEADLINE.search(text or ""):
        return "It has a deadline"
    return None
