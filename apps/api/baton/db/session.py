"""Database engine and session.

NullPool on purpose: on Vercel each function instance is short-lived, and Neon's pooled endpoint (PgBouncer) does
the pooling. Locally the cost of a fresh connection per request is negligible.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from baton.config import get_settings


def _normalise_url(url: str) -> str:
    # Accept plain postgres:// URLs (Neon's dashboard format) and force the psycopg 3 driver.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


engine = create_engine(
    _normalise_url(get_settings().database_url),
    poolclass=NullPool,
    # PgBouncer in transaction mode cannot use server-side prepared statements.
    connect_args={"prepare_threshold": None, "connect_timeout": 10},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

# Bound every transaction so one stuck query or lock wait can't hang a request (or a serverless instance) for a
# minute. SET LOCAL is transaction-scoped, so it is safe with PgBouncer's transaction pooling (Neon's pooled URL).
STATEMENT_TIMEOUT = "25s"
LOCK_TIMEOUT = "10s"


@event.listens_for(Session, "after_begin")
def _bound_transaction(session, transaction, connection) -> None:  # noqa: ARG001
    if connection.dialect.name == "postgresql":
        connection.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'; SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
