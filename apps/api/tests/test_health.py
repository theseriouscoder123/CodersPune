from fastapi.testclient import TestClient
from sqlalchemy import text

from baton.db.session import engine
from baton.main import app

client = TestClient(app)


def test_health_reports_db_and_never_leaks_secrets():
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["db"]["ok"] is True, body
    assert body["db"]["pgvector"] is True
    assert isinstance(body["llm"]["configured"], bool)
    # Only booleans/labels, never key material.
    assert "api_key" not in r.text.lower()


def test_chunk_fulltext_column_is_generated():
    with engine.begin() as conn:
        ws = conn.execute(text("INSERT INTO workspaces (name) VALUES ('t') RETURNING id")).scalar()
        src = conn.execute(
            text("INSERT INTO sources (workspace_id, type, name) VALUES (:w, 'upload', 'n') RETURNING id"),
            {"w": ws},
        ).scalar()
        conn.execute(
            text("INSERT INTO chunks (source_id, workspace_id, kind, text) VALUES (:s, :w, 'note_para', :t)"),
            {"s": src, "w": ws, "t": "We agreed to raise the poster upload limit to 5 MB before the fest."},
        )
        hit = conn.execute(
            text("SELECT count(*) FROM chunks WHERE workspace_id = :w AND tsv @@ plainto_tsquery('english', 'upload limit')"),
            {"w": ws},
        ).scalar()
        conn.execute(text("DELETE FROM workspaces WHERE id = :w"), {"w": ws})  # cascades
    assert hit == 1
