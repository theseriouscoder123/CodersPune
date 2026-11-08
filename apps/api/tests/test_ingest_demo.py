"""Ingest the real demo dataset into a throwaway workspace and check the trust-relevant properties."""

import json
from pathlib import Path

import pytest
from sqlalchemy import delete, select

from baton.acl import acl_key
from baton.db.models import Chunk, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace

GOLDEN = json.loads((Path(__file__).resolve().parents[3] / "demo" / "golden_ledger.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def demo():
    db = SessionLocal()
    ws = build_demo_workspace(db, template=False, name="pytest demo")
    db.commit()
    sources = {s.name: s for s in db.scalars(select(Source).where(Source.workspace_id == ws.id))}
    chunks = list(db.scalars(select(Chunk).where(Chunk.workspace_id == ws.id)))
    yield sources, chunks
    db.execute(delete(Workspace).where(Workspace.id == ws.id))
    db.commit()
    db.close()


def test_four_sources_with_expected_access(demo):
    sources, _ = demo
    assert set(sources) == {"devclub/campus-events-app", "Meeting notes", "#dev", "#core-team"}
    assert sources["#core-team"].acl_key != sources["#dev"].acl_key
    assert "all_members" not in sources["#core-team"].acl.get("roles", [])


def test_g9_secrets_never_stored(demo):
    sources, chunks = demo
    assert sum(sum(s.scrub_report.values()) for s in sources.values()) == 2
    for secret in GOLDEN["secrets"]:
        assert all(secret not in c.text for c in chunks), secret
        assert all(secret not in json.dumps(c.location) for c in chunks)


def test_chunks_inherit_source_acl(demo):
    sources, chunks = demo
    by_id = {s.id: s for s in sources.values()}
    assert all(c.acl_key == by_id[c.source_id].acl_key == acl_key(by_id[c.source_id].acl) for c in chunks)


def test_planted_evidence_is_present(demo):
    sources, chunks = demo
    texts = {s.name: [c.text for c in chunks if c.source_id == s.id] for s in sources.values()}
    repo, notes, dev, core = (texts[n] for n in ("devclub/campus-events-app", "Meeting notes", "#dev", "#core-team"))
    assert any("export const MAX_BYTES = 2 * 1024 * 1024;" in t for t in repo)                  # G3 code
    assert any("raise the poster upload limit to 5 MB" in t for t in notes)                     # G3 notes
    assert any("deploy.yml: 33 commits; rohan 31, neha 2" in t for t in repo)                   # G2
    assert any("OneSignal free plan caps us at the device limit before fest" in t for t in repo)  # G1
    assert any("waiting on Dr. Rao's review before merge" in t for t in repo)                    # G4
    assert any("parking this for now, maybe after fest" in t for t in repo)                      # G6
    assert any("let's just go with Supabase auth" in t for t in dev)                             # G7
    assert any("TechNova pays ₹40,000" in t for t in core)                                       # G8 (restricted)
    assert all("TechNova" not in t for t in dev + repo + notes)                                  # ...and only there
    assert any("transfer Vercel project ownership to Neha" in t for t in notes)                  # G12


def test_upload_ts_line_41_is_locatable(demo):
    _, chunks = demo
    from baton.ingest.chunker import line_of_offset

    c = next(c for c in chunks if c.location.get("file") == "src/lib/upload.ts" and c.kind == "file")
    offset = c.text.index("export const MAX_BYTES")
    line = line_of_offset(c.text, offset, c.location["line_start"]) - c.location.get("prefix_lines", 0)
    assert line == 41


def test_repo_signals_for_checklist(demo):
    sources, _ = demo
    sig = sources["devclub/campus-events-app"].meta["signals"]
    assert {p["number"] for p in sig["open_prs"] if p["author"] == "rohan"} == {142}
    assert 131 in {i["number"] for i in sig["open_issues"] if "rohan" in i["assignees"]}
    assert set(sig["env_prefixes"]["FIREBASE"]) >= {"FIREBASE_PROJECT_ID", "FIREBASE_SERVER_KEY", "FIREBASE_BILLING_ALERT_EMAIL"}
    assert sig["workflows"] == [".github/workflows/deploy.yml"]
    assert sig["path_stats"][".github/workflows/deploy.yml"] == {"rohan": 31, "neha": 2}
