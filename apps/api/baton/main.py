"""FastAPI application. All routes live under /api so the Next.js rewrite (/api/* -> API) maps 1:1."""

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from baton import __version__
from baton.config import get_settings
from baton.db.session import engine
from baton.routers import acks, activity, ask, claims, custom, handovers, interviews, lifecycle, relations, runs, search, sources, team, workspaces
from baton.routers import health as pipeline_health_routes
from baton.security import install as install_hardening

settings = get_settings()

app = FastAPI(
    title="Baton API",
    version=__version__,
    description=(
        "Evidence-graded knowledge handovers. Every route enforces access on the server: a claim is returned only if "
        "every source it cites is visible to the acting member. Requests act as the visitor's member, chosen with the "
        "`X-Baton-Persona` header in persona-switching workspaces or fixed by a private invite link in locked ones."
    ),
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_hardening(app)

api = APIRouter(prefix="/api", tags=["Service"])


@api.get("/health")
def health() -> dict:
    """DB reachability + config presence. Never returns secret values."""
    db_ok, db_error, has_vector = False, None, False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            has_vector = bool(
                conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).scalar()
            )
        db_ok = True
    except Exception as exc:  # noqa: BLE001 - health must never raise
        db_error = type(exc).__name__
    return {
        "status": "ok" if db_ok else "degraded",
        "version": __version__,
        "db": {"ok": db_ok, "error": db_error, "pgvector": has_vector},
        "llm": {
            "provider": settings.llm_provider,
            "configured": settings.llm_configured,
            "verifier": settings.verifier,
        },
        "github_token": bool(settings.github_token),
    }


app.include_router(api)
for r in (workspaces.router, custom.router, runs.router, claims.router, handovers.router, pipeline_health_routes.router, team.router, ask.router, activity.router, search.router, lifecycle.router, sources.router, interviews.router, relations.router, acks.router):
    app.include_router(r)
