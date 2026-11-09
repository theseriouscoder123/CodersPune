"""Ask the handover: answer a successor's question ONLY from the approved, permission-projected claims they can see.

Trust properties:
  * the model only ever sees claims already projected through the asker's access (restricted text can't leak);
  * every answer must cite the claims it uses, and citations are validated server-side;
  * an answer with no valid citation is downgraded to "not covered"; it is never shown as fact.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from rapidfuzz import fuzz
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.config import get_settings
from baton.db.models import LlmCall, Member, Membership
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii
from baton.llm.base import LLMError, get_llm
from baton.routers.handovers import _handover, _latest, _project

router = APIRouter(prefix="/api")

MAX_CONTEXT_ITEMS = 18
ASKS_PER_HOUR = 40

ASK_SYSTEM = """You help a successor understand a project handover. Answer ONLY from the numbered handover items given.
Rules:
- Use only facts stated in the items. Never add outside knowledge or guesses.
- Cite every item you rely on by its id (I1, I2, ...). An answer without citations is not allowed.
- Items marked MISSING or open questions are unknowns: say clearly that it is unresolved, and suggest asking the person
  named in the instructions.
- If the items answer only part of the question, give that part (with citations), say what is not covered, and set
  answered=false. If they don't help at all, set answered=false with no citations.
- Keep the answer short (at most 4 sentences or 5 bullet points), plain English. No personal contact details."""


_INLINE_REF = re.compile(r"[\[(]?\b(I\d{1,2})\b(?:\s*[,;]\s*\b(I\d{1,2})\b)*[\])]?")
_REF_ID = re.compile(r"\bI\d{1,2}\b")


def _renumber(answer: str, local_ids: list[str]) -> str:
    """Replace the model's internal item ids (I7, [I1, I3]) with [1], [2] matching the order of the citation list.
    Ids that aren't valid citations are dropped so no meaningless marker reaches the user."""
    order = {lid: n for n, lid in enumerate(local_ids, start=1)}

    def sub(m: re.Match[str]) -> str:
        nums = sorted({order[i] for i in _REF_ID.findall(m.group(0)) if i in order})
        return "".join(f"[{n}]" for n in nums)

    out = _INLINE_REF.sub(sub, answer)
    out = re.sub(r"[ \t]{2,}", " ", out)
    return re.sub(r"[ \t]+([.,;:])", r"\1", out).strip()


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    version: int | None = None


class AskResult(BaseModel):
    answered: bool
    answer: str | None = None
    cited: list[str] = Field(default_factory=list)

    @field_validator("answer")
    @classmethod
    def _cap_answer(cls, v: str | None) -> str | None:  # untrusted model output: bound what we store and show
        return v[:2500] if v else v

    @field_validator("cited")
    @classmethod
    def _cap_cited(cls, v: list[str]) -> list[str]:
        return v[:20]


PINNED_START = 6  # the first "Start here" items (next actions first) are always in context
PINNED_UNRESOLVED = 4


def _rank(question: str, items: list[dict]) -> list[dict]:
    """Pick the items the model sees: the top next actions and unresolved items are always included (so "what should I
    do first?" or "what's unknown?" can't miss them), then the rest by similarity to the question."""
    q = question.lower()

    def score(it: dict) -> float:
        t = f"{it['type_label']} {it['text']}".lower()
        return max(fuzz.token_set_ratio(q, t), fuzz.partial_ratio(q, t) * 0.9)

    start = [it for it in items if it.get("_section") == "start_here"][:PINNED_START]
    unresolved = [it for it in items if it.get("_section") == "unresolved"][:PINNED_UNRESOLVED]
    pinned_ids = {id(it) for it in start + unresolved}
    rest = sorted((it for it in items if id(it) not in pinned_ids), key=score, reverse=True)
    return (start + unresolved + rest)[:MAX_CONTEXT_ITEMS]


@router.post("/handovers/{handover_id}/ask")
def ask(handover_id: uuid.UUID, body: AskIn, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if not (ctx.is_reviewer or ctx.member.id in (h.successor_member_id, h.leaver_member_id)):
        raise HTTPException(403, "This handover is shared with the successor, the leaver and the reviewer only")
    if not get_settings().llm_configured:
        raise HTTPException(503, "Asking needs the AI pipeline, which isn't configured on this server.")
    v = _latest(db, h, body.version)
    if v is None:
        raise HTTPException(409, "Nothing has been approved yet, so there's nothing to ask about.")
    recent = db.scalar(select(func.count()).select_from(LlmCall).where(
        LlmCall.workspace_id == h.workspace_id, LlmCall.purpose == "ask", LlmCall.created_at > datetime.now(UTC) - timedelta(hours=1)))
    if recent >= ASKS_PER_HOUR:
        raise HTTPException(429, "Lots of questions this hour. Please try again in a little while.")

    projected = _project(db, h, v, ctx.viewer, mask=not ctx.is_reviewer)  # permission projection FIRST
    items = [{**it, "_section": s["key"]} for s in projected["sections"] for it in s["items"] if not it.get("restricted")]
    if not items:
        return {"answered": False, "answer": None, "citations": [], "fallback": "The approved handover has no items you can see."}
    context = _rank(body.question, items)
    local = {f"I{i}": it for i, it in enumerate(context, start=1)}
    reviewer = db.scalar(select(Member.display_name).join(Membership, Membership.member_id == Member.id)
                         .where(Membership.workspace_id == h.workspace_id, Membership.role == "reviewer").limit(1)) or "the reviewer"
    lines = []
    for lid, it in local.items():
        tag = "MISSING (unknown)" if it["status"] == "missing" else ("SUPERSEDED (history)" if it.get("history") else it["status"].upper())
        lines.append(f"[{lid}] ({it['type_label']} · {tag}) {it['text']}")
    user = (f"Unknowns should be asked of {projected.get('leaver') or 'the leaver'} or {reviewer} (reviewer).\n\n"
            f"Handover items:\n" + "\n".join(lines) + f"\n\nQuestion: {body.question.strip()}")

    s = get_settings()
    try:
        res: AskResult = get_llm().structured(system=ASK_SYSTEM, user=user, schema=AskResult, model=s.llm_model_verify,
                                              purpose="ask", workspace_id=h.workspace_id)
    except LLMError as exc:
        raise HTTPException(503, exc.user_message) from exc

    norm = {c.strip().strip("[]").upper() for c in res.cited}
    # Keep citations in the order the answer mentions them, then any cited-but-unmentioned ones.
    mentioned = [i for i in dict.fromkeys(_REF_ID.findall(res.answer or "")) if i in norm and i in local]
    cited_ids = mentioned + [lid for lid in local if lid in norm and lid not in mentioned]
    cited = [local[lid] for lid in cited_ids]
    fallback = f"The approved handover doesn't cover this. Ask {reviewer} (reviewer) or the leaver."
    if not res.answer or not cited:  # uncited answers are never shown as fact
        return {"answered": False, "partial": False, "answer": None, "citations": [], "fallback": fallback}
    answer = _renumber(res.answer.strip(), cited_ids)
    if not ctx.is_reviewer:
        answer = mask_pii(answer)
    partial = not res.answered  # cited, but the handover only covers part of the question
    return {
        "answered": res.answered, "partial": partial, "answer": answer,
        "fallback": (f"The handover only partly answers this. For the rest, ask {reviewer} (reviewer) or the leaver."
                     if partial else None),
        "citations": [{"claim_id": it["claim_id"], "text": it["text"], "status": it["status"], "type_label": it["type_label"],
                       "evidence": it["evidence"], "status_reason": it["status_reason"],
                       "flags": it.get("flags", {})} for it in cited],
    }
