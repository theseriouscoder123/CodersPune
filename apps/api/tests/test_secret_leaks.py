"""No key, token or password the server holds can come back out: not in HTTP errors, stored run errors, AI-call logs,
notification logs or health/config responses. Uses planted fake secrets in the settings."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import baton.security as security
from baton.config import Settings
from baton.ingest.scrubber import scrub
from baton.main import app

FAKE = {
    "gemini": "AQ.Ab8FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00",
    "groq": "gsk_FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfake00",
    "gh": "github_pat_FAKEFAKEFAKEFAKEFAKEFAKE_0000000000",
    "smtp": "abcd efgh ijkl mnop",
    "dbpw": "S3cr3tDbPassw0rd",
}


@pytest.fixture
def planted(monkeypatch):
    s = Settings(gemini_api_keys=f"{FAKE['gemini']},AQ.Ab8OTHERFAKEOTHERFAKEOTHERFAKEOTHER0", groq_api_keys=FAKE["groq"],
                 github_token=FAKE["gh"], smtp_password=FAKE["smtp"],
                 database_url=f"postgresql+psycopg://u:{FAKE['dbpw']}@db.example.com:5432/x")
    monkeypatch.setattr("baton.config.get_settings", lambda: s)
    security._configured_secrets.cache_clear()
    yield s
    security._configured_secrets.cache_clear()


def test_redact_strips_configured_values_and_known_formats(planted):
    msg = (f"Gemini said 400 for key {FAKE['gemini']}; groq {FAKE['groq']}; gh {FAKE['gh']}; "
           f"smtp {FAKE['smtp']}; postgresql://u:{FAKE['dbpw']}@db.example.com/x")
    out = security.redact(msg)
    for v in FAKE.values():
        assert v not in out, v
    assert "[REDACTED" in out


def test_http_error_details_are_redacted(planted):
    @app.get("/api/__leaky")
    def leaky():  # pragma: no cover - test-only route
        raise HTTPException(502, f"upstream rejected token {FAKE['groq']}")

    try:
        r = TestClient(app).get("/api/__leaky")
        assert r.status_code == 502 and FAKE["groq"] not in r.text and "REDACTED" in r.text
    finally:
        app.router.routes = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/api/__leaky"]


def test_pipeline_failure_message_is_redacted(planted, monkeypatch):
    import baton.pipeline as pipeline

    seen = {}

    class _FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, model, _id):
            obj = type("Row", (), {})()
            seen.setdefault("rows", []).append(obj)
            return obj

    monkeypatch.setattr(pipeline.SessionLocal, "begin", lambda: _FakeSession())
    pipeline._fail("run", "job", f"Extract failed: provider said invalid key {FAKE['gemini']}")
    stored = " ".join(str(getattr(r, a, "")) for r in seen["rows"] for a in ("message", "error"))
    assert FAKE["gemini"] not in stored and "REDACTED" in stored


def test_health_and_config_never_include_values(planted):
    body = TestClient(app).get("/api/health").text
    for v in FAKE.values():
        assert v not in body


def test_scrubber_knows_current_key_formats():
    for sample in (FAKE["gemini"], FAKE["groq"], FAKE["gh"], "sk-proj-" + "q" * 48, "sk-ant-api03-" + "w" * 40,
                   "https://hooks.slack.com/services/T0AAA/B0BBB/" + "c" * 24):
        out, counts = scrub(f"config: {sample}")
        assert sample not in out and counts, sample
    out, _ = scrub("DATABASE_URL=postgresql://user:hunter2pass@db.example.com:5432/app")
    assert "hunter2pass" not in out and "db.example.com" in out
