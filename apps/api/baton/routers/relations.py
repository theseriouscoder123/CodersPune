"""Round 3 improvement #2: the conflict and supersession timeline.

GET lists how claims relate (reversal / historical / contradiction / unrelated), with the signal that decided each
relation, plus stale open work, filtered by permissions like every other read (a relation is shown only when the
viewer may see BOTH claims). The reviewer can override a relation; that changes the ledger (supersession, conflict
group) and is audited. The rules then never overwrite the reviewer's choice.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.auth import Ctx, resolve_ctx, workspace_ctx
from baton.db.models import AuditEvent, Claim, ClaimRelation, ConflictGroup, Member
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii, scrub
from baton.ledger import evidence_rows, rebuild_relations, recompute_statuses, ref_for
from baton.projection import claim_sources, visible

router = APIRouter(prefix="/api", tags=["Decision timeline"])

LABEL = {"reversal": "Reversed", "historical": "Earlier state", "contradiction": "Contradicts", "unrelated": "Unrelated"}


def _ledger_access(ctx: Ctx) -> None:
    if not (ctx.is_reviewer or ctx.is_admin or "leaver" in ctx.roles):
        raise HTTPException(403, "The decision timeline is part of the draft ledger, which the reviewer and the leaver can see")


def _node(c: Claim, refs: list[str], pii) -> dict:
    return {"id": str(c.id), "text": pii(c.text), "type": c.type, "status": c.status, "subject_key": c.subject_key,
            "occurred_at": c.occurred_at.isoformat() if c.occurred_at else None, "refs": refs,
            "superseded": bool(c.superseded_by), "stale_reason": pii(c.stale_reason) if c.stale_reason else None}


@router.get("/workspaces/{workspace_id}/relations")
def list_relations(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _ledger_access(ctx)
    ws_id = ctx.workspace.id
    pii = (lambda s: s) if ctx.is_reviewer else (lambda s: mask_pii(s) if s else s)
    rels = list(db.scalars(select(ClaimRelation).where(ClaimRelation.workspace_id == ws_id).order_by(ClaimRelation.created_at)))
    ids = {r.from_claim_id for r in rels} | {r.to_claim_id for r in rels}
    stale = list(db.scalars(select(Claim).where(Claim.workspace_id == ws_id, Claim.stale_reason.is_not(None))))
    ids |= {c.id for c in stale}
    claims = {c.id: c for c in db.scalars(select(Claim).where(Claim.id.in_(ids)))} if ids else {}
    cited = claim_sources(db, list(claims))
    ok = {cid for cid in claims if visible(ctx.viewer, cited.get(cid, []))}
    ev = evidence_rows(db, list(ok))
    refs = {cid: list(dict.fromkeys(ref_for(*r) for r in ev.get(cid, [])))[:3] for cid in ok}
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == ws_id))}
    out = []
    for r in rels:
        if r.from_claim_id not in ok or r.to_claim_id not in ok:
            continue
        out.append({"id": str(r.id), "relation": r.relation, "label": LABEL[r.relation], "decided_by": r.decided_by,
                    "decided_by_name": names.get(r.decided_by_member_id) if r.decided_by == "reviewer" else None,
                    "signal": pii(r.signal), "note": pii(r.note),
                    "earlier": _node(claims[r.from_claim_id], refs[r.from_claim_id], pii),
                    "later": _node(claims[r.to_claim_id], refs[r.to_claim_id], pii)})
    stale_out = [_node(c, refs.get(c.id, []), pii) for c in stale if c.id in ok]
    return {"relations": out, "stale": stale_out,
            "counts": {k: sum(1 for x in out if x["relation"] == k) for k in LABEL} | {"stale": len(stale_out)}}


class RelationIn(BaseModel):
    relation: Literal["reversal", "contradiction", "unrelated"]
    note: str | None = Field(default=None, max_length=300)


def _writer(ctx: Ctx) -> None:
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can change how claims relate")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")


@router.patch("/claim-relations/{relation_id}")
def override_relation(relation_id: uuid.UUID, body: RelationIn, request: Request, db: Session = Depends(get_db)) -> dict:
    r = db.get(ClaimRelation, relation_id)
    if r is None:
        raise HTTPException(404, "Relation not found")
    ctx = resolve_ctx(db, request, r.workspace_id)
    _writer(ctx)
    db.execute(select(ClaimRelation.id).where(ClaimRelation.id == r.id).with_for_update())
    earlier, later = db.get(Claim, r.from_claim_id), db.get(Claim, r.to_claim_id)
    before = {"relation": r.relation, "decided_by": r.decided_by}
    shared = earlier.conflict_group_id if earlier.conflict_group_id and earlier.conflict_group_id == later.conflict_group_id else None

    if body.relation == "reversal":
        earlier.superseded_by = later.id  # the earlier claim becomes history; the later one is current
        later.superseded_by = None if later.superseded_by == earlier.id else later.superseded_by
        if shared:
            g = db.get(ConflictGroup, shared)
            g.resolved, g.resolution, g.resolved_by = True, f"winner:{later.id}", ctx.member.id
    elif body.relation == "contradiction":
        for a, b in ((earlier, later), (later, earlier)):
            if a.superseded_by == b.id:
                a.superseded_by = None
        if not shared:
            g = ConflictGroup(workspace_id=r.workspace_id, subject_key=earlier.subject_key)
            db.add(g)
            db.flush()
            earlier.conflict_group_id = later.conflict_group_id = g.id
        else:
            g = db.get(ConflictGroup, shared)
            g.resolved, g.resolution = False, None  # a person says these really disagree: decide again
    else:  # unrelated
        for a, b in ((earlier, later), (later, earlier)):
            if a.superseded_by == b.id:
                a.superseded_by = None
        if shared:
            later.conflict_group_id = None
            rest = list(db.scalars(select(Claim).where(Claim.conflict_group_id == shared, Claim.id != later.id)))
            if len(rest) < 2:
                for c in rest:
                    c.conflict_group_id = None
                db.delete(db.get(ConflictGroup, shared))
    note = scrub(body.note.strip())[0] if body.note and body.note.strip() else None
    r.relation, r.decided_by, r.decided_by_member_id, r.note = body.relation, "reviewer", ctx.member.id, note
    db.add(AuditEvent(workspace_id=r.workspace_id, actor_member_id=ctx.member.id, actor_role="reviewer", action="relation_override",
                      target=str(r.id), before=before, after={"relation": body.relation}, note=note))
    db.flush()
    recompute_statuses(db, r.workspace_id)
    rebuild_relations(db, r.workspace_id)
    db.commit()
    return {"id": str(r.id), "relation": r.relation, "decided_by": "reviewer"}


class StaleIn(BaseModel):
    still_open: bool


@router.post("/claims/{claim_id}/stale")
def set_stale(claim_id: uuid.UUID, body: StaleIn, request: Request, db: Session = Depends(get_db)) -> dict:
    c = db.get(Claim, claim_id)
    if c is None:
        raise HTTPException(404, "Claim not found")
    ctx = resolve_ctx(db, request, c.workspace_id)
    _writer(ctx)
    meta = dict(c.meta or {})
    if body.still_open:
        meta["stale_override"] = "still_open"
    else:
        meta.pop("stale_override", None)
    c.meta = meta
    db.add(AuditEvent(workspace_id=c.workspace_id, actor_member_id=ctx.member.id, actor_role="reviewer",
                      action="stale_override", target=str(c.id), after={"still_open": body.still_open}))
    db.flush()
    rebuild_relations(db, c.workspace_id)
    db.commit()
    return {"id": str(c.id), "stale_reason": c.stale_reason, "still_open": body.still_open}
