"""Claim extraction: batch chunks BY ACCESS GROUP (trust rule 6), call the LLM, keep only well-formed proposals."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from rapidfuzz import fuzz

from baton.llm.prompts import COMMON_SUBJECT_KEYS, EXTRACT_SYSTEM, ExtractionResult

MAX_BATCH_CHARS = 7_000
MAX_EXTRACT_CHARS = 60_000  # per run: keeps a custom repo inside the free LLM quota and the ~5 minute target

# What a successor most needs first. Old commit logs are the least informative per character.
_KIND_PRIORITY = {"file": 0, "note_para": 0, "chat_thread": 1, "pr": 1, "issue": 1, "pr_comment": 2,
                  "issue_comment": 2, "commit_stats": 3, "commit": 4}


def select_for_budget(chunks: list[ChunkRef], budget: int = MAX_EXTRACT_CHARS) -> tuple[list[ChunkRef], int]:
    """Pick chunks by priority (then most recent first) until the character budget is spent. Returns (kept, dropped)."""
    if sum(len(c.text) for c in chunks) <= budget:
        return chunks, 0
    order = sorted(chunks, key=lambda c: (_KIND_PRIORITY.get(c.kind, 5), -(c.occurred_at.timestamp() if c.occurred_at else 0)))
    kept, used = [], 0
    for c in order:
        if used + len(c.text) <= budget:
            kept.append(c)
            used += len(c.text)
    return kept, len(chunks) - len(kept)  # smaller batches -> better recall per call (spec allows <= ~12k)


@dataclass
class ChunkRef:
    id: str
    acl_key: str
    kind: str
    text: str
    occurred_at: datetime | None
    label: str  # e.g. "pr_comment · PR #88 · 2026-03-12 · author: rohan"


@dataclass
class Batch:
    acl_key: str
    chunk_ids: list[str] = field(default_factory=list)


def make_batches(chunks: list[ChunkRef], max_chars: int = MAX_BATCH_CHARS) -> list[Batch]:
    """Group by identical acl_key, sort by time, pack without splitting chunks. Broad access groups come first so
    their subject keys can be shared with narrower groups (never the other way round)."""
    groups: dict[str, list[ChunkRef]] = {}
    for c in chunks:
        groups.setdefault(c.acl_key, []).append(c)
    order = sorted(groups, key=lambda k: (0 if "r:all_members" in k.split("|") else 1, k))
    batches: list[Batch] = []
    for key in order:
        cs = sorted(groups[key], key=lambda c: (c.occurred_at is None, c.occurred_at or datetime.min))
        cur, size = Batch(key), 0
        for c in cs:
            if cur.chunk_ids and size + len(c.text) > max_chars:
                batches.append(cur)
                cur, size = Batch(key), 0
            cur.chunk_ids.append(c.id)
            size += len(c.text) + 80
        if cur.chunk_ids:
            batches.append(cur)
    return batches


def render_batch(chunks: list[ChunkRef], context_header: str) -> tuple[str, dict[str, str]]:
    local: dict[str, str] = {}
    parts = [context_header, ""]
    for i, c in enumerate(chunks, start=1):
        cid = f"C{i}"
        local[cid] = c.id
        parts.append(f"[{cid}] ({c.label})\n{c.text}\n")
    return "\n".join(parts), local


def extract_batch(llm, model: str, chunks: list[ChunkRef], *, leaver_name: str, context_header: str,
                  known_keys: list[str], workspace_id=None, run_id=None) -> list[dict]:
    user, local = render_batch(chunks, context_header + (
        f"\nSubject keys already used in this project: {', '.join(sorted(set(known_keys))[:60])}" if known_keys else ""))
    system = EXTRACT_SYSTEM.format(leaver_name=leaver_name, subject_keys=", ".join(COMMON_SUBJECT_KEYS))
    result: ExtractionResult = llm.structured(system=system, user=user, schema=ExtractionResult, model=model,
                                              purpose="extract", workspace_id=workspace_id, run_id=run_id)
    by_id = {c.id: c for c in chunks}
    out = []
    for pc in result.claims:
        ev = [{"chunk_id": local[e.chunk.strip()], "quote": e.quote.strip()}
              for e in pc.evidence if e.chunk.strip() in local and e.quote.strip()]
        if not ev or not pc.text.strip():
            continue  # drop evidence pointing outside the batch; drop claims left with none
        times = [by_id[e["chunk_id"]].occurred_at for e in ev if by_id[e["chunk_id"]].occurred_at]
        out.append({
            "type": pc.type, "text": pc.text.strip()[:400], "subject_key": pc.subject_key.strip().lower()[:80],
            "value": (pc.value or None), "stated": pc.stated, "supersedes_hint": pc.supersedes_hint,
            "occurred_at": max(times) if times else None, "evidence": ev,
        })
    return out


def dedupe(claims: list[dict]) -> list[dict]:
    """Merge near-duplicates within a run, keeping the most informative text and all evidence (docs/03 section 2):
    same subject_key and text similarity >= 90, or same subject_key + type + normalised value and similarity >= 60."""
    from baton.reconstruct.values import normalise_value

    kept: list[dict] = []
    for c in claims:
        cv = normalise_value(c.get("value"))
        twin = None
        for k in kept:
            if k["subject_key"] != c["subject_key"]:
                continue
            sim = fuzz.token_set_ratio(k["text"], c["text"])
            same_value = cv is not None and cv == normalise_value(k.get("value")) and k.get("type") == c.get("type")
            if sim >= 90 or (same_value and sim >= 60):
                twin = k
                break
        if twin is None:
            kept.append(c)
            continue
        if len(c["text"]) > len(twin["text"]):
            twin["text"], twin["id_text_from"] = c["text"], c.get("id")
        seen = {(e["chunk_id"], e["quote"]) for e in twin["evidence"]}
        twin["evidence"] += [e for e in c["evidence"] if (e["chunk_id"], e["quote"]) not in seen]
    return kept
