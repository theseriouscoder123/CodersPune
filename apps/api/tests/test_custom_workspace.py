"""S1 custom workspace creation: validation, server-side ACLs from the access picker, scrubbing, rate limit."""

import json

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.config import get_settings
from baton.db.models import Chunk, Run, Source, Workspace
from baton.db.session import SessionLocal
from baton.main import app

MEMBERS = [
    {"name": "Asha", "handle": "asha", "roles": ["reviewer"]},
    {"name": "Ben", "handle": "ben", "roles": ["leaver"]},
    {"name": "Cy", "handle": "cy", "roles": ["successor"]},
]
NOTE = b"# Sync 2026-05-01\n\nWe decided to use Postgres. DB_PASSWORD=supersecretvalue123\n"
CHAT = json.dumps([
    {"channel": "ops", "ts": "1714550000.0", "user": "U1", "user_profile": {"name": "asha"}, "text": "budget is 10k, keep quiet"},
]).encode()


def client(visitor):
    # A unique fake network per test; clean-up deletes by that IP (the cookie id may be replaced by a new visitor).
    c = TestClient(app, headers={"x-forwarded-for": f"198.51.100.{abs(hash(visitor)) % 250 + 1}"})
    c.cookies.set("baton_visitor", visitor)
    return c


def post(c, **over):
    data = {"name": "My project", "members": json.dumps(MEMBERS), "confirm_authorised": "true",
            "notes_access": "all", "chat_access": json.dumps(["ben"]), **over.pop("data", {})}
    files = over.pop("files", [("notes", ("sync.md", NOTE, "text/markdown")), ("chat", ("ops.json", CHAT, "application/json"))])
    return c.post("/api/workspaces", data=data, files=files)


def cleanup(visitor):
    from baton.db.models import Visitor

    ip = f"198.51.100.{abs(hash(visitor)) % 250 + 1}"
    with SessionLocal.begin() as db:
        ids = select(Visitor.id).where(Visitor.ip == ip)
        db.execute(delete(Workspace).where((Workspace.visitor_id == visitor) | Workspace.visitor_id.in_(ids)))


def test_create_with_notes_and_restricted_chat():
    v = "pytest-custom-1"
    cleanup(v)
    c = client(v)
    r = post(c)
    assert r.status_code == 200, r.text
    ws_id = r.json()["workspace_id"]
    with SessionLocal() as db:
        srcs = {s.name: s for s in db.scalars(select(Source).where(Source.workspace_id == ws_id))}
        assert set(srcs) == {"Uploaded notes", "#ops"}
        assert srcs["#ops"].acl["roles"] == ["reviewer"] and len(srcs["#ops"].acl["members"]) == 1
        assert srcs["Uploaded notes"].scrub_report == {"generic_secret": 1}
        assert all("supersecretvalue123" not in ch.text for ch in db.scalars(select(Chunk).where(Chunk.workspace_id == ws_id)))
        assert db.scalar(select(Run).where(Run.workspace_id == ws_id)).status == "queued"
    # Server-side ACL from the picker: the successor can't see the restricted channel; the leaver can.
    people = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws_id}").json()["members"]}
    names = lambda pid: {s["name"] for s in c.get(f"/api/workspaces/{ws_id}/sources", headers={"X-Baton-Persona": pid}).json()["sources"]}
    assert names(people["cy"]) == {"Uploaded notes"}
    assert names(people["ben"]) == {"Uploaded notes", "#ops"}
    assert names(people["asha"]) == {"Uploaded notes", "#ops"}
    cleanup(v)


def test_validation_errors_are_clear():
    c = client("pytest-custom-2")
    assert "authorised" in post(c, data={"confirm_authorised": "false"}).json()["detail"]
    bad = [dict(MEMBERS[0]), dict(MEMBERS[1]), {"name": "Cy", "handle": "cy", "roles": ["member"]}]
    assert "successor" in post(c, data={"members": json.dumps(bad)}).json()["detail"]
    assert "GitHub" in post(c, data={"repo_url": "not a repo"}, files=[]).json()["detail"]
    assert "at least one source" in post(c, files=[]).json()["detail"]
    r = post(c, files=[("notes", ("evil.exe", b"x", "application/octet-stream"))])
    assert r.status_code == 422 and ".md" in r.json()["detail"]
    cleanup("pytest-custom-2")


def test_daily_limit_per_visitor():
    v = "pytest-custom-3"
    cleanup(v)
    c = client(v)
    limit = get_settings().custom_workspace_daily_limit
    for _ in range(limit):
        assert post(c).status_code == 200
    r = post(c)
    assert r.status_code == 429 and "Limit" in r.json()["detail"]
    cleanup(v)


def test_private_repo_token_is_used_once_and_never_stored(monkeypatch):
    from baton.ingest import github
    from baton.ingest.github_normalise import RepoData

    seen = {}

    def fake_fetch(url, token=None, *, user_token=None):
        seen["user_token"] = user_token
        return RepoData(repo={"full_name": "acme/secret-app", "html_url": "https://github.com/acme/secret-app",
                              "private": True, "default_branch": "main"},
                        files={"README.md": "# Secret app\n\nDeploys with fly.io."})

    monkeypatch.setattr(github, "fetch_repo", fake_fetch)
    v = "pytest-custom-private"
    cleanup(v)
    c = client(v)
    token = "github_pat_" + "x" * 40
    r = post(c, data={"repo_url": "https://github.com/acme/secret-app", "github_token": token}, files=[])
    assert r.status_code == 200, r.text
    assert seen["user_token"] == token
    from sqlalchemy import text as sql_text

    with SessionLocal() as db:
        dump = db.execute(sql_text("SELECT string_agg(meta::text || name || coalesce(uri,''), ' ') FROM sources WHERE workspace_id = :w"),
                          {"w": r.json()["workspace_id"]}).scalar()
        chunks = db.execute(sql_text("SELECT string_agg(text, ' ') FROM chunks WHERE workspace_id = :w"), {"w": r.json()["workspace_id"]}).scalar()
        assert token not in (dump or "") and token not in (chunks or "")
        assert '"private": true' in dump and "Deploys with fly.io" in chunks
    cleanup(v)


def test_bad_inputs_are_refused_before_anything_is_created(monkeypatch):
    """Reliability sweep (D75): each of these used to create a workspace (or crash) instead of a clear message."""
    from baton.ingest import github as gh
    from baton.ingest.github import GitHubError
    from baton.routers import custom

    c = TestClient(app, headers={"x-forwarded-for": "198.51.100.200"})

    def missing(url):
        raise GitHubError("GitHub has no public repository nobody/nothing. Check the URL; for a private repository, add a read-only token.")

    monkeypatch.setattr(custom, "check_repo", missing)
    assert "no public repository" in post(c, data={"repo_url": "https://github.com/nobody/nothing"}, files=[]).json()["detail"]
    for fname, body, expect in [("empty.md", b"", "empty"), ("blank.md", b"  \n\n ", "empty"),
                                ("bin.md", bytes(range(256)) * 40, "text file"), ("x.pdf", b"not a pdf", "couldn't be opened")]:
        r = post(c, data={}, files=[("notes", (fname, body, "text/markdown"))])
        assert r.status_code == 422 and expect in r.json()["detail"], (fname, r.text)
    assert gh.check_repo  # the real check exists (network-free tests stub it)


def test_ai_quota_exhausted_mid_run_fails_clearly_and_ships_nothing(monkeypatch):
    """AI-quota safety net (D75): when every key is out of quota, the run stops with the plain quota message at
    the extraction step instead of finishing with an empty or half-graded ledger."""
    from baton import pipeline
    from baton.db.models import Claim, Run
    from baton.llm.base import _QUOTA_MSG, LLMError

    class OutOfQuota:
        def structured(self, **kw):
            raise LLMError("all keys out", _QUOTA_MSG)

    monkeypatch.setattr(pipeline, "get_llm", lambda: OutOfQuota())
    c = TestClient(app, headers={"x-forwarded-for": "198.51.100.201"})
    c.cookies.set("baton_visitor", "quota-visitor")
    r = post(c, data={}, files=[("notes", ("sync.md", NOTE, "text/markdown"))])
    assert r.status_code == 200, r.text
    run_id, ws = r.json()["run_id"], r.json()["workspace_id"]
    try:
        for _ in range(20):
            pipeline.advance(run_id, budget_s=20)
            with SessionLocal() as db:
                if db.get(Run, run_id).status not in ("queued", "running"):
                    break
        with SessionLocal() as db:
            run = db.get(Run, run_id)
            assert run.status == "failed" and "quota" in (run.error or "").lower(), run.error
            assert "Extract" in run.error
            assert not db.scalars(select(Claim).where(Claim.workspace_id == ws, Claim.origin != "checklist")).first()
    finally:
        cleanup("quota-visitor")
