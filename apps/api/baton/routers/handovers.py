"""Visibility preview, approval (versioned snapshot) and the successor's projected handover (spec §5, §8 S5–S7).

Nothing reaches the successor until a reviewer approves (trust rule 8). The snapshot freezes claim content at approval;
the permission projection is applied at READ time from current source ACLs, so tightening access later is honoured.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.acl import Viewer, access_label, can_view_acl
from baton.auth import Ctx, _roles, resolve_ctx, workspace_ctx
from baton.db.models import Chunk, Claim, Handover, HandoverVersion, Member, Source
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii
from baton.ledger import evidence_rows, ref_for
from baton.projection import claim_sources, visible, withheld_reason
from baton.routers.claims import TYPE_LABELS, evidence_payload

router = APIRouter(prefix="/api")

SECTIONS = [
    ("start_here", "Start here", "Next actions and unfinished work, in the order to pick them up."),
    ("owners", "Who owns what", "Who maintains each part of the project."),
    ("decisions", "Key decisions", "What was decided and why. Reversed decisions are kept as history."),
    ("risks", "Risks and conflicts", "Known risks, recurring problems and places where sources disagree."),
    ("dependencies", "Dependencies and contacts", "External services, accounts and people the project relies on."),
    ("unresolved", "Unresolved", "Nobody has answered these yet. Ask before relying on them."),
]


def _section(item: dict) -> str:
    if item["status"] == "missing" or item["type"] == "open_question":
        return "unresolved"
    if item["status"] == "conflicting" or item["type"] in ("risk", "recurring_issue"):
        return "risks"
    return {"next_action": "start_here", "open_work": "start_here", "ownership": "owners", "decision": "decisions",
            "dependency": "dependencies", "contact": "dependencies"}.get(item["type"], "decisions")


def eligible_for_successor(c: Claim) -> bool:
    """Rejected and superseded claims never ship; Inferred claims are not shown as fact (trust rule 4)."""
    if c.status == "rejected" or c.superseded_by:
        return False
    if c.status == "inferred":
        return False
    return True


def _handover(db: Session, request: Request, handover_id: uuid.UUID) -> tuple[Handover, Ctx]:
    h = db.get(Handover, handover_id)
    if h is None:
        raise HTTPException(404, "Handover not found")
    return h, resolve_ctx(db, request, h.workspace_id)


def _viewer_for(db: Session, member_id, workspace_id) -> Viewer:
    return Viewer(str(member_id), _roles(db, member_id, workspace_id))


@router.get("/workspaces/{workspace_id}/handover")
def workspace_handover(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    h = db.scalar(select(Handover).where(Handover.workspace_id == ctx.workspace.id))
    if h is None:
        return {"handover": None}
    latest = db.scalar(select(HandoverVersion).where(HandoverVersion.handover_id == h.id).order_by(HandoverVersion.version.desc()))
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == ctx.workspace.id))}
    return {"handover": {"id": str(h.id), "leaver": names.get(h.leaver_member_id), "successor": names.get(h.successor_member_id),
                         "successor_id": str(h.successor_member_id), "show_restricted_stubs": h.show_restricted_stubs,
                         "latest_version": latest.version if latest else None}}


@router.get("/handovers/{handover_id}/preview")
def preview(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db), as_: str | None = None) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can preview the successor's view")
    target_id = uuid.UUID(request.query_params.get("as") or as_ or str(h.successor_member_id))
    target = db.get(Member, target_id)
    if target is None or target.workspace_id != h.workspace_id:
        raise HTTPException(404, "Member not found")
    tv = _viewer_for(db, target.id, h.workspace_id)
    claims = [c for c in db.scalars(select(Claim).where(Claim.workspace_id == h.workspace_id)) if eligible_for_successor(c)]
    cited = claim_sources(db, [c.id for c in claims])
    ev = evidence_rows(db, [c.id for c in claims])
    shown, withheld = [], []
    for c in claims:
        item = {"id": str(c.id), "type": c.type, "type_label": TYPE_LABELS.get(c.type, c.type), "text": c.text,
                "status": c.status, "section": None, "source_refs": list(dict.fromkeys(ref_for(*r) for r in ev.get(c.id, [])))}
        item["section"] = _section(item)
        if visible(tv, cited.get(c.id, [])):
            shown.append(item)
        else:
            withheld.append({**item, "reason": withheld_reason(db, h.workspace_id, tv, cited.get(c.id, []))})
    hidden_inferred = sum(1 for c in db.scalars(select(Claim).where(Claim.workspace_id == h.workspace_id))
                          if c.status == "inferred" and not c.superseded_by)
    all_live = [c for c in db.scalars(select(Claim).where(Claim.workspace_id == h.workspace_id))
                if c.status != "rejected" and not c.superseded_by]
    warnings = {
        "unresolved_conflicts": sum(1 for c in all_live if c.status == "conflicting"),
        "unreviewed": sum(1 for c in all_live if c.review_state == "none"),
        "missing": sum(1 for c in all_live if c.status == "missing"),
    }
    return {"member": {"id": str(target.id), "name": target.display_name}, "visible": shown, "withheld": withheld,
            "hidden_inferred": hidden_inferred, "show_restricted_stubs": h.show_restricted_stubs, "warnings": warnings}


class ApproveIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    show_restricted_stubs: bool | None = None


@router.post("/handovers/{handover_id}/approve")
def approve(handover_id: uuid.UUID, body: ApproveIn, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can approve a handover")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if body.show_restricted_stubs is not None:
        h.show_restricted_stubs = body.show_restricted_stubs
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == h.workspace_id)))
    by_id = {c.id: c for c in claims}
    ev = evidence_rows(db, [c.id for c in claims])
    items = []
    for c in claims:
        superseded_history = c.superseded_by is not None and c.type == "decision" and c.status != "rejected"
        if not (eligible_for_successor(c) or superseded_history):
            continue
        items.append({
            "claim_id": str(c.id), "type": c.type, "text": c.text, "status": c.status, "status_reason": c.status_reason,
            "flags": (c.meta or {}).get("flags", {}), "occurred_at": c.occurred_at.isoformat() if c.occurred_at else None,
            "superseded_by": str(c.superseded_by) if c.superseded_by and c.superseded_by in by_id else None,
            "evidence": [{"evidence_id": str(e.id), "chunk_id": str(ch.id), "ref": ref_for(e, ch, s)} for e, ch, s in ev.get(c.id, [])],
        })
    n = (db.scalar(select(func.max(HandoverVersion.version)).where(HandoverVersion.handover_id == h.id)) or 0) + 1
    v = HandoverVersion(handover_id=h.id, version=n, approved_by=ctx.member.id, approved_at=datetime.now(UTC),
                        note=body.note, snapshot={"items": items})
    db.add(v)
    db.commit()
    return {"version": n, "items": len(items)}


def _ts(iso: str | None) -> float:
    return datetime.fromisoformat(iso).timestamp() if iso else 0.0


def _latest(db: Session, h: Handover, version: int | None) -> HandoverVersion | None:
    q = select(HandoverVersion).where(HandoverVersion.handover_id == h.id)
    q = q.where(HandoverVersion.version == version) if version else q.order_by(HandoverVersion.version.desc())
    return db.scalars(q).first()


def _project(db: Session, h: Handover, v: HandoverVersion, viewer: Viewer, mask: bool) -> dict:
    items = v.snapshot.get("items", [])
    chunk_ids = [uuid.UUID(e["chunk_id"]) for it in items for e in it["evidence"]]
    acls = {cid: acl for cid, acl in db.execute(select(Chunk.id, Source.acl).join(Source, Source.id == Chunk.source_id)
                                                .where(Chunk.id.in_(chunk_ids)))} if chunk_ids else {}
    texts = {it["claim_id"]: it["text"] for it in items}
    sections = {key: [] for key, _, _ in SECTIONS}
    stubs = 0
    for it in items:
        ok = all(can_view_acl(viewer, acls.get(uuid.UUID(e["chunk_id"]))) for e in it["evidence"])
        if not ok:
            stubs += 1
            if h.show_restricted_stubs:
                sections["unresolved"].append({"restricted": True, "text": "Restricted item. Ask the reviewer."})
            continue  # withheld: no text, type, quote or source name
        out = {**it, "text": mask_pii(it["text"]) if mask else it["text"],
               "type_label": TYPE_LABELS.get(it["type"], it["type"]),
               "superseded_by_text": texts.get(it["superseded_by"]) if it.get("superseded_by") else None}
        if it.get("superseded_by"):
            out["history"] = True
            sections["decisions"].append(out)
        else:
            sections[_section(it)].append(out)
    # Start with concrete next actions, newest first; then unfinished work. Other sections newest first.
    sections["start_here"].sort(key=lambda it: (it["type"] != "next_action", -_ts(it.get("occurred_at"))))
    for key in ("owners", "decisions", "risks", "dependencies"):
        sections[key].sort(key=lambda it: (bool(it.get("history")), -_ts(it.get("occurred_at"))))
    approver = db.get(Member, v.approved_by) if v.approved_by else None
    return {
        "handover_id": str(h.id), "version": v.version, "approved_at": v.approved_at.isoformat(),
        "approved_by": approver.display_name if approver else None, "note": v.note,
        "sections": [{"key": k, "title": t, "help": hp, "items": sections[k]} for k, t, hp in SECTIONS],
        "withheld_count": stubs if h.show_restricted_stubs else None,
    }


@router.get("/handovers/{handover_id}")
def get_handover(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db), version: int | None = None) -> dict:
    h, ctx = _handover(db, request, handover_id)
    allowed = ctx.is_reviewer or ctx.member.id in (h.successor_member_id, h.leaver_member_id)
    if not allowed:
        raise HTTPException(403, "This handover is shared with the successor, the leaver and the reviewer only")
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == h.workspace_id))}
    v = _latest(db, h, version)
    meta = {"leaver": names.get(h.leaver_member_id), "successor": names.get(h.successor_member_id)}
    if v is None:
        return {**meta, "approved": False,
                "message": f"Your handover is being prepared by {next((names[m] for m in names if 'reviewer' in _roles(db, m, h.workspace_id)), 'the reviewer')}."}
    return {**meta, "approved": True, **_project(db, h, v, ctx.viewer, mask=not ctx.is_reviewer)}


@router.get("/handovers/{handover_id}/versions")
def versions(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can see version history")
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == h.workspace_id))}
    vs = list(db.scalars(select(HandoverVersion).where(HandoverVersion.handover_id == h.id).order_by(HandoverVersion.version)))
    out, prev = [], set()
    for v in vs:
        ids = {it["claim_id"] for it in v.snapshot.get("items", [])}
        out.append({"version": v.version, "approved_by": names.get(v.approved_by), "approved_at": v.approved_at.isoformat(),
                    "note": v.note, "items": len(ids), "added": len(ids - prev), "removed": len(prev - ids)})
        prev = ids
    return {"versions": list(reversed(out))}


@router.get("/handovers/{handover_id}/evidence/{evidence_id}")
def handover_evidence(handover_id: uuid.UUID, evidence_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    """Evidence drawer for the successor: permission-checked against the source, PII masked for non-reviewers."""
    from baton.db.models import Evidence

    h, ctx = _handover(db, request, handover_id)
    if not (ctx.is_reviewer or ctx.member.id in (h.successor_member_id, h.leaver_member_id)):
        raise HTTPException(404, "Not found")
    row = db.execute(select(Evidence, Chunk, Source).join(Chunk, Chunk.id == Evidence.chunk_id)
                     .join(Source, Source.id == Chunk.source_id).where(Evidence.id == evidence_id)).first()
    if row is None or row[2].workspace_id != h.workspace_id or not can_view_acl(ctx.viewer, row[2].acl):
        raise HTTPException(404, "Not found")
    names = {str(m.id): m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == h.workspace_id))}
    return evidence_payload(*row, names, mask=not ctx.is_reviewer)


@router.get("/handovers/{handover_id}/export.md", response_class=PlainTextResponse)
def export_md(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> str:
    data = get_handover(handover_id, request, db)
    if not data.get("approved"):
        raise HTTPException(409, "No approved version yet")
    lines = [f"# Handover: {data['leaver']} → {data['successor']}",
             f"Version {data['version']} · approved by {data['approved_by']} · {data['approved_at'][:10]}", ""]
    for s in data["sections"]:
        if not s["items"]:
            continue
        lines += [f"## {s['title']}", ""]
        for it in s["items"]:
            if it.get("restricted"):
                lines.append(f"- _{it['text']}_")
                continue
            refs = ", ".join(e["ref"] for e in it["evidence"]) or "no source"
            tag = "Reviewer-confirmed (no source evidence)" if it.get("flags", {}).get("reviewer_confirmed_without_evidence") else it["status"].upper()
            prefix = "~~" if it.get("history") else ""
            lines.append(f"- {prefix}{it['text']}{prefix} [{tag}] ({refs})")
        lines.append("")
    return "\n".join(lines)


def access_of(src: Source, names: dict) -> str:
    return access_label(src.acl, names)
