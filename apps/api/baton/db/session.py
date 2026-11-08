"""Database engine and session.

NullPool on purpose: on Vercel each function instance is short-lived, and Neon's pooled endpoint (PgBouncer) does
the pooling. Locally the cost of a fresh connection per request is negligible.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine
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


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
