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

from baton import notify
from baton.acl import Viewer, access_label, can_view_acl
from baton.auth import Ctx, _roles, resolve_ctx, workspace_ctx
from baton.db.models import Chunk, Claim, Handover, HandoverVersion, Member, Source, Workspace
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii, scrub
from baton.ledger import evidence_rows, ref_for
from baton.projection import claim_sources, visible, withheld_reason
from baton.routers.claims import TYPE_LABELS, evidence_payload

router = APIRouter(prefix="/api", tags=["Handovers"])

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


def scope_keywords(scope: str | None) -> list[str]:
    return [k.strip().lower() for k in (scope or "").replace("\n", ",").split(",") if k.strip()]


def in_scope(c: Claim, rows: list, keywords: list[str]) -> bool:
    """Scoped handover (e.g. 'payments, src/billing/'): a claim is in scope if any keyword appears in its topic, its
    text, or the file/source its evidence comes from. No keywords = the whole project."""
    if not keywords:
        return True
    hay = [c.subject_key.lower(), c.text.lower()]
    for _ev, ch, src in rows:
        hay.append(str((ch.location or {}).get("file") or "").lower())
        hay.append(src.name.lower())
    return any(k in h for k in keywords for h in hay)


def eligible_for_successor(c: Claim) -> bool:
    """Rejected and superseded claims never ship; Inferred claims are not shown as fact (trust rule 4)."""
    if c.status == "rejected" or c.superseded_by:
        return False
    if c.status == "inferred":
        return False
    if ((c.meta or {}).get("flags") or {}).get("answered"):
        return False  # a Missing item the leaver answered: the testimony claim ships instead
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


def _handover_row(db: Session, h: Handover, names: dict) -> dict:
    latest = db.scalar(select(HandoverVersion).where(HandoverVersion.handover_id == h.id).order_by(HandoverVersion.version.desc()))
    return {"id": str(h.id), "name": h.name or f"{names.get(h.leaver_member_id)} → {names.get(h.successor_member_id)}",
            "leaver": names.get(h.leaver_member_id), "successor": names.get(h.successor_member_id),
            "leaver_id": str(h.leaver_member_id), "successor_id": str(h.successor_member_id), "scope": h.scope or "",
            "show_restricted_stubs": h.show_restricted_stubs, "latest_version": latest.version if latest else None}


@router.get("/workspaces/{workspace_id}/handovers")
def list_handovers(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == ctx.workspace.id))}
    hs = list(db.scalars(select(Handover).where(Handover.workspace_id == ctx.workspace.id).order_by(Handover.created_at)))
    if not ctx.is_reviewer:  # people only see handovers they are part of
        hs = [h for h in hs if ctx.member.id in (h.successor_member_id, h.leaver_member_id)]
    return {"handovers": [_handover_row(db, h, names) for h in hs]}


class HandoverIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    leaver_member_id: uuid.UUID
    successor_member_id: uuid.UUID
    scope: str | None = Field(default=None, max_length=300)


@router.post("/workspaces/{workspace_id}/handovers")
def create_handover(body: HandoverIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can create handovers")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    ids = {m.id for m in db.scalars(select(Member).where(Member.workspace_id == ctx.workspace.id))}
    if body.leaver_member_id not in ids or body.successor_member_id not in ids:
        raise HTTPException(422, "Leaver and successor must be members of this workspace")
    if body.leaver_member_id == body.successor_member_id:
        raise HTTPException(422, "The successor must be someone other than the leaver")
    h = Handover(workspace_id=ctx.workspace.id, leaver_member_id=body.leaver_member_id,
                 successor_member_id=body.successor_member_id, name=(body.name or "").strip() or None,
                 scope=(body.scope or "").strip() or None)
    db.add(h)
    db.commit()
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == ctx.workspace.id))}
    return {"handover": _handover_row(db, h, names)}


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
    ev = evidence_rows(db, [c.id for c in claims])
    kws = scope_keywords(h.scope)
    claims = [c for c in claims if in_scope(c, ev.get(c.id, []), kws)]
    cited = claim_sources(db, [c.id for c in claims])
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
        "source_changed": sum(1 for c in all_live if (c.meta or {}).get("source_changed")),
    }
    return {"member": {"id": str(target.id), "name": target.display_name}, "scope": kws, "visible": shown, "withheld": withheld,
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
    # Serialise approvals of the same handover (double-click, two tabs): the row lock makes version numbers N, N+1.
    db.execute(select(Handover.id).where(Handover.id == h.id).with_for_update())
    if body.show_restricted_stubs is not None:
        h.show_restricted_stubs = body.show_restricted_stubs
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == h.workspace_id)))
    by_id = {c.id: c for c in claims}
    ev = evidence_rows(db, [c.id for c in claims])
    items = []
    kws = scope_keywords(h.scope)
    for c in claims:
        superseded_history = c.superseded_by is not None and c.type == "decision" and c.status != "rejected"
        if not (eligible_for_successor(c) or superseded_history):
            continue
        if not in_scope(c, ev.get(c.id, []), kws):
            continue
        items.append({
            "claim_id": str(c.id), "type": c.type, "text": c.text, "status": c.status, "status_reason": c.status_reason,
            "flags": (c.meta or {}).get("flags", {}), "occurred_at": c.occurred_at.isoformat() if c.occurred_at else None,
            "superseded_by": str(c.superseded_by) if c.superseded_by and c.superseded_by in by_id else None,
            "evidence": [{"evidence_id": str(e.id), "chunk_id": str(ch.id), "ref": ref_for(e, ch, s)} for e, ch, s in ev.get(c.id, [])],
        })
    n = (db.scalar(select(func.max(HandoverVersion.version)).where(HandoverVersion.handover_id == h.id)) or 0) + 1
    v = HandoverVersion(handover_id=h.id, version=n, approved_by=ctx.member.id, approved_at=datetime.now(UTC),
                        note=scrub(body.note)[0] if body.note else None, snapshot={"items": items})
    db.add(v)
    db.commit()
    notified = _notify_approved(db, h, n, ctx.member.display_name)
    return {"version": n, "items": len(items), "notified": notified}


def _notify_approved(db: Session, h: Handover, version: int, approver: str) -> list[dict]:
    """Optional, best-effort: tell the successor and leaver (email) and the team (Slack). Messages carry names and a
    link only, never claim text, so the normal permission projection still decides what each person sees."""
    try:
        ws = db.get(Workspace, h.workspace_id)
        succ = db.get(Member, h.successor_member_id) if h.successor_member_id else None
        leaver = db.get(Member, h.leaver_member_id) if h.leaver_member_id else None
        title = h.name or f"{leaver.display_name if leaver else 'Handover'} → {succ.display_name if succ else 'successor'}"
        link = f"/w/{ws.id}/handover?h={h.id}"
        out = []
        if succ:
            out.append({"to": succ.display_name, **notify.send_email(
                db, ws, event="handover_approved", to=succ.email, subject=f"Your handover is ready · {title}",
                heading=f"{approver} approved version {version} of your handover",
                lines=[f"“{title}” in {ws.name} is ready for you.",
                       "Start with “Start here”, and check “Unresolved” before relying on anything there.",
                       "Every item links to the exact evidence it came from."],
                link=link, link_label="Open my handover").as_dict()})
        if leaver:
            out.append({"to": leaver.display_name, **notify.send_email(
                db, ws, event="handover_approved", to=leaver.email, subject=f"Your handover was approved · {title}",
                heading=f"{approver} approved version {version} of the handover you're leaving",
                lines=[f"“{title}” in {ws.name} is now visible to {succ.display_name if succ else 'your successor'}.",
                       "If you can, answer the open questions so the unresolved list gets shorter."],
                link=link, link_label="See the handover").as_dict()})
        out.append({"to": "Slack", **notify.send_slack(
            db, ws, event="handover_approved", title=f"Handover approved: {title} (v{version})",
            lines=[f"Approved by {approver}", f"Workspace: {ws.name}"], link=link).as_dict()})
        db.commit()
        return [o for o in out if o["status"] != "skipped" or o["channel"] == "email"]
    except Exception:  # noqa: BLE001 - approval already committed; a notification problem must not surface as an error
        db.rollback()
        return []


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
        if mask and it.get("status") == "conflicting":  # the reviewer's "pick one" advice isn't for the successor
            it = {**it, "status_reason": "Two sources disagree on this and the reviewer kept it as an open risk. "
                                         "Check which is current before relying on it."}
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
        "approved_by": approver.display_name if approver else None,
        "note": (mask_pii(v.note) if mask and v.note else v.note),  # reviewer notes follow the same PII rule as claims
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
    meta = {"leaver": names.get(h.leaver_member_id), "successor": names.get(h.successor_member_id),
            "name": h.name, "scope": scope_keywords(h.scope)}
    if v is None:
        return {**meta, "approved": False,
                "message": f"Your handover is being prepared by {next((names[m] for m in names if 'reviewer' in _roles(db, m, h.workspace_id)), 'the reviewer')}."}
    return {**meta, "approved": True, **_project(db, h, v, ctx.viewer, mask=not ctx.is_reviewer)}


@router.get("/handovers/{handover_id}/changes")
def changes(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db), version: int | None = None) -> dict:
    """What changed between an approved version and the one before it, computed AFTER the permission projection for
    this viewer on both sides, so the changelog can't reveal an item (or its removal) that the viewer may not see."""
    h, ctx = _handover(db, request, handover_id)
    if not (ctx.is_reviewer or ctx.member.id in (h.successor_member_id, h.leaver_member_id)):
        raise HTTPException(403, "This handover is shared with the successor, the leaver and the reviewer only")
    cur = _latest(db, h, version)
    if cur is None or cur.version <= 1:
        return {"version": cur.version if cur else None, "previous": None, "added": [], "removed": [], "changed": []}
    prev = _latest(db, h, cur.version - 1)
    mask = not ctx.is_reviewer

    def items(v: HandoverVersion) -> dict:
        p = _project(db, h, v, ctx.viewer, mask=mask)
        return {it["claim_id"]: {**it, "section": sec["title"]} for sec in p["sections"] for it in sec["items"]
                if not it.get("restricted") and it.get("claim_id")}

    a, b = items(prev), items(cur)
    pick = ("claim_id", "text", "status", "type_label", "section")
    added = [{k: b[c].get(k) for k in pick} for c in b if c not in a]
    removed = [{k: a[c].get(k) for k in pick} for c in a if c not in b]
    changed = []
    for c in b:
        if c in a and (a[c]["text"] != b[c]["text"] or a[c]["status"] != b[c]["status"]):
            changed.append({**{k: b[c].get(k) for k in pick}, "was_text": a[c]["text"] if a[c]["text"] != b[c]["text"] else None,
                            "was_status": a[c]["status"] if a[c]["status"] != b[c]["status"] else None})
    return {"version": cur.version, "previous": prev.version if prev else None,
            "added": added, "removed": removed, "changed": changed}


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
    if not ctx.is_reviewer:
        # Trust rule 8: the successor/leaver only ever see evidence that is part of an APPROVED version of this
        # handover, never evidence behind draft, rejected or unapproved claims (even from a source they can open).
        approved = {e["evidence_id"] for (snap,) in db.execute(select(HandoverVersion.snapshot).where(HandoverVersion.handover_id == h.id))
                    for it in (snap or {}).get("items", []) for e in it.get("evidence", [])}
        if str(evidence_id) not in approved:
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
