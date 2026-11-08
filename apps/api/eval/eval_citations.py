"""Evaluate the demo ledger against demo/golden_ledger.json (docs/03 §9).

    python -m eval.eval_citations [--workspace <uuid>]      # default: the demo template

Metrics
  claim recall        golden claims matched by a produced claim (same type and same subject_key, or text similarity >= 70)
  status accuracy     matched golden claims whose produced status is one of the expected statuses
  citation precision  produced Supported/Verified claims matched to golden whose passing evidence contains a golden quote
  permission leaks    restricted golden claims visible to Neha (must be 0)
  secret leaks        planted secrets found in ANY stored chunk text (must be 0)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from rapidfuzz import fuzz
from sqlalchemy import select

from baton.acl import Viewer
from baton.auth import _roles
from baton.db.models import Chunk, Claim, Member, Workspace
from baton.db.session import SessionLocal
from baton.ledger import evidence_rows
from baton.projection import claim_sources, visible

GOLDEN = json.loads((Path(__file__).resolve().parents[3] / "demo" / "golden_ledger.json").read_text(encoding="utf-8"))
TYPE_ALIASES = {"risk": {"risk", "recurring_issue"}, "open_question": {"open_question", "open_work", "decision"},
                "dependency": {"dependency", "contact", "risk"}, "next_action": {"next_action", "open_work"},
                "open_work": {"open_work", "next_action"}, "decision": {"decision"}, "ownership": {"ownership"},
                "contact": {"contact", "ownership"}, "recurring_issue": {"recurring_issue", "risk"}}


def score(g: dict, c: Claim) -> float:
    if c.type not in TYPE_ALIASES.get(g["type"], {g["type"]}):
        return 0
    if c.subject_key == g["subject_key"]:
        return 100
    return fuzz.token_set_ratio(g["gist"].lower(), c.text.lower())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace")
    args = ap.parse_args()
    db = SessionLocal()
    ws = db.get(Workspace, args.workspace) if args.workspace else db.scalar(
        select(Workspace).where(Workspace.is_demo_template.is_(True)).order_by(Workspace.created_at.desc()))
    claims = [c for c in db.scalars(select(Claim).where(Claim.workspace_id == ws.id)) if c.status != "rejected"]
    ev = evidence_rows(db, [c.id for c in claims])
    cited = claim_sources(db, [c.id for c in claims])
    neha = db.scalar(select(Member).where(Member.workspace_id == ws.id, Member.handle == "neha"))
    neha_v = Viewer(str(neha.id), _roles(db, neha.id, ws.id))

    rows, matched, status_ok, cit_total, cit_ok, leaks = [], 0, 0, 0, 0, 0
    for g in GOLDEN["claims"]:
        cands = sorted(((score(g, c), c) for c in claims), key=lambda t: -t[0])
        cands = [(s, c) for s, c in cands if s >= 70]
        if g["id"] == "G7":  # the superseded pair: the live (non-superseded) one carries the status
            cands = [t for t in cands if not t[1].superseded_by] or cands
        best = next((c for s, c in cands if c.status in g["expected_status"]), cands[0][1] if cands else None)
        ok = bool(best and best.status in g["expected_status"])
        cit = None
        if best and best.status in ("supported", "verified") and g["evidence"]:
            cit_total += 1
            passing = [ch.text for e, ch, _ in ev.get(best.id, []) if e.quote_found and e.verdict == "supports"]
            cit = any(x["contains"].lower() in t.lower() for x in g["evidence"] for t in passing)
            cit_ok += int(cit)
        if g.get("restricted"):
            leaks += sum(1 for _, c in cands if visible(neha_v, cited.get(c.id, [])))
        extra = ""
        if g["id"] == "G7":
            sup = [c for c in claims if c.superseded_by and c.subject_key == g["subject_key"]]
            extra = f"superseded={len(sup)}"
        matched += int(best is not None)
        status_ok += int(ok)
        rows.append((g["id"], g["type"], best.status if best else "-", "yes" if ok else "NO",
                     {None: "-", True: "ok", False: "WRONG"}[cit], (best.text[:70] if best else "(not produced)"), extra))

    secrets = sum(1 for (t,) in db.execute(select(Chunk.text)) for s in GOLDEN["secrets"] if s in t)
    n = len(GOLDEN["claims"])
    print(f"workspace {ws.id}  claims={len(claims)}")
    print(f"{'id':<4} {'type':<15} {'status':<12} {'ok':<4} {'cite':<6} claim")
    for r in rows:
        print(f"{r[0]:<4} {r[1]:<15} {r[2]:<12} {r[3]:<4} {r[4]:<6} {r[5]} {r[6]}")
    print(f"\nclaim recall       {matched}/{n} = {matched / n:.0%}")
    print(f"status accuracy    {status_ok}/{n} = {status_ok / n:.0%}")
    print(f"citation precision {cit_ok}/{cit_total} = {cit_ok / max(cit_total, 1):.0%}")
    print(f"permission leaks   {leaks} (must be 0)")
    print(f"secret leaks       {secrets} (must be 0)")


if __name__ == "__main__":
    main()
