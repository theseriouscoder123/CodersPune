"""Every response carries a request id and security headers; an unexpected error never leaks a stack trace."""

from fastapi.testclient import TestClient

from baton.main import app


def test_headers_and_request_id():
    c = TestClient(app)
    r = c.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert len(r.headers["x-request-id"]) >= 8
    assert c.get("/api/health", headers={"X-Request-Id": "trace-me"}).headers["x-request-id"] == "trace-me"


def test_unexpected_error_returns_reference_not_traceback():
    @app.get("/api/__boom")
    def boom():  # pragma: no cover - only for this test
        raise RuntimeError("secret-ish internals: postgresql://user:pw@host")

    r = TestClient(app, raise_server_exceptions=False).get("/api/__boom")
    assert r.status_code == 500
    body = r.json()
    assert body["request_id"] and body["request_id"] in body["detail"]
    assert "postgresql" not in r.text and "Traceback" not in r.text
    app.router.routes = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/api/__boom"]


def test_per_persona_data_is_not_cached():
    r = TestClient(app).get("/api/workspaces/00000000-0000-0000-0000-000000000000")
    assert r.headers.get("cache-control") == "no-store"
