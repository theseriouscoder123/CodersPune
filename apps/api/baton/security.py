"""HTTP hardening shared by every route: a request id on every response, security headers, and a last-resort error
handler that never leaks a stack trace (or a secret inside one) to the browser."""

from __future__ import annotations

import logging
import secrets
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("baton")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    # JSON only: nothing in an API response should ever run as a page
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}
NO_STORE_PREFIXES = ("/api/workspaces", "/api/claims", "/api/handovers", "/api/join", "/api/runs")


class HardeningMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id", "")[:64] or secrets.token_hex(8)
        request.state.request_id = rid
        t0 = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error rid=%s %s %s", rid, request.method, request.url.path)
            response = _server_error(rid)
        response.headers["X-Request-Id"] = rid
        is_docs = request.url.path.startswith("/api/docs")  # Swagger UI needs its own scripts
        for k, v in SECURITY_HEADERS.items():
            if not (is_docs and k == "Content-Security-Policy"):
                response.headers.setdefault(k, v)
        if request.url.path.startswith(NO_STORE_PREFIXES):
            response.headers.setdefault("Cache-Control", "no-store")  # per-persona data must never be cached
        ms = int((time.monotonic() - t0) * 1000)
        if ms > 10_000:
            log.warning("slow request rid=%s %s %s %dms", rid, request.method, request.url.path, ms)
        return response


def _server_error(rid: str) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": f"Something went wrong on our side. If it keeps happening, quote reference {rid}.",
                 "request_id": rid},
    )


def install(app: FastAPI) -> None:
    app.add_middleware(HardeningMiddleware)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", None) or secrets.token_hex(8)
        log.exception("unhandled error rid=%s %s %s", rid, request.method, request.url.path, exc_info=exc)
        return _server_error(rid)
