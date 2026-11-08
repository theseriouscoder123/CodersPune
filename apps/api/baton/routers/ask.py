"""Ask the handover: answer a successor's question ONLY from the approved, permission-projected claims they can see.

Trust properties:
  * the model only ever sees claims already projected through the asker's access (restricted text can't leak);
  * every answer must cite the claims it uses, and citations are validated server-side;
  * an answer with no valid citation is downgraded to "not covered"; it is never shown as fact.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
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
- If the items don't answer the question, set answered=false.
- Keep the answer short (at most 4 sentences or 5 bullet points), plain English. No personal contact details."""


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    version: int | None = None


class AskResult(BaseModel):
    answered: bool
    answer: str | None = None
    cited: list[str] = Field(default_factory=list)


def _rank(question: str, items: list[dict]) -> list[dict]:
    q = question.lower()

    def score(it: dict) -> float:
        t = f"{it['type_label']} {it['text']}".lower()
        return max(fuzz.token_set_ratio(q, t), fuzz.partial_ratio(q, t) * 0.9)

    # Always keep the top next actions/unresolved items for "what should I do / what's unknown" style questions.
    ranked = sorted(items, key=score, reverse=True)
    return ranked[:MAX_CONTEXT_ITEMS]


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
    items = [it for s in projected["sections"] for it in s["items"] if not it.get("restricted")]
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

    cited = [local[c.strip()] for c in res.cited if c.strip() in local]
    fallback = f"The approved handover doesn't cover this. Ask {reviewer} (reviewer) or the leaver."
    if not res.answered or not res.answer or not cited:  # uncited answers are never shown as fact
        return {"answered": False, "answer": None, "citations": [], "fallback": fallback}
    answer = res.answer.strip()
    if not ctx.is_reviewer:
        answer = mask_pii(answer)
    return {
        "answered": True, "answer": answer, "fallback": None,
        "citations": [{"claim_id": it["claim_id"], "text": it["text"], "status": it["status"], "type_label": it["type_label"],
                       "evidence": it["evidence"], "status_reason": it["status_reason"],
                       "flags": it.get("flags", {})} for it in cited],
    }
