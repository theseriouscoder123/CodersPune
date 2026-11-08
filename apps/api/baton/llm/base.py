"""Provider-agnostic structured-output LLM adapter (docs/02 §5).

Contract: `structured()` returns a validated instance of `schema` or raises LLMError. Invalid JSON / schema mismatch
is retried once; 429/5xx are retried with exponential backoff. Every call is logged to `llm_calls` with METADATA
ONLY (never prompt or response text).
"""

from __future__ import annotations

import json
import time
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from baton.config import get_settings

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    """A call failed after retries. `user_message` is safe to show in the UI."""

    def __init__(self, message: str, user_message: str | None = None):
        super().__init__(message)
        self.user_message = user_message or message


class LLMNotConfigured(LLMError):
    def __init__(self):
        super().__init__("LLM not configured", "AI pipeline unavailable: no LLM key is configured on the server.")


class Transport(Protocol):
    provider: str

    def generate_json(self, *, system: str, user: str, json_schema: dict, model: str, temperature: float) -> tuple[str, dict]:
        """Return (raw JSON text, usage dict with tokens_in/tokens_out). Raise TransientError / LLMError."""


class TransientError(Exception):
    def __init__(self, message: str, retry_after: float | None = None, daily_quota: bool = False):
        super().__init__(message)
        self.retry_after = retry_after
        self.daily_quota = daily_quota  # this model is done for the day: switch models instead of waiting


def inline_refs(schema: dict) -> dict:
    """Pydantic emits $defs/$ref; some providers want a fully inlined schema. Also drops titles (noise)."""
    defs = schema.get("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].split("/")[-1]])
            return {k: walk(v) for k, v in node.items() if k not in ("$defs", "title")}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def _log(*, purpose: str, provider: str, model: str, ok: bool, latency_ms: int, usage: dict, error: str | None,
         workspace_id=None, run_id=None) -> None:
    try:
        from baton.db.models import LlmCall
        from baton.db.session import SessionLocal

        with SessionLocal.begin() as db:
            db.add(LlmCall(workspace_id=workspace_id, run_id=run_id, purpose=purpose, provider=provider, model=model,
                           tokens_in=usage.get("tokens_in"), tokens_out=usage.get("tokens_out"),
                           latency_ms=latency_ms, ok=ok, error=(error or "")[:300] or None))
    except Exception:  # noqa: BLE001 - logging must never break a run
        pass


class LLM:
    def __init__(self, transport: Transport):
        self.transport = transport

    def structured(self, *, system: str, user: str, schema: type[T], model: str, purpose: str,
                   temperature: float = 0.0, workspace_id=None, run_id=None, max_transient_retries: int = 6) -> T:
        """`model` may be a comma-separated fallback chain; a model whose daily quota is exhausted is skipped."""
        chain = [m.strip() for m in model.split(",") if m.strip()]
        last: LLMError | None = None
        for m in chain:
            if m in _EXHAUSTED:
                continue
            try:
                return self._structured_one(system=system, user=user, schema=schema, model=m, purpose=purpose,
                                            temperature=temperature, workspace_id=workspace_id, run_id=run_id,
                                            max_transient_retries=max_transient_retries)
            except _DailyQuota:
                _EXHAUSTED.add(m)
                last = LLMError(f"{m} daily quota exhausted", "The AI provider's daily free quota is used up. Try again tomorrow.")
        raise last or LLMError("all models exhausted", "The AI provider's daily free quota is used up. Try again tomorrow.")

    def _structured_one(self, *, system: str, user: str, schema: type[T], model: str, purpose: str,
                        temperature: float, workspace_id, run_id, max_transient_retries: int) -> T:
        json_schema = inline_refs(schema.model_json_schema())
        schema_attempts = 0
        transient = 0
        last_err = "unknown"
        while True:
            t0 = time.monotonic()
            usage: dict = {}
            try:
                raw, usage = self.transport.generate_json(system=system, user=user, json_schema=json_schema,
                                                          model=model, temperature=temperature)
                result = schema.model_validate(json.loads(raw))
                _log(purpose=purpose, provider=self.transport.provider, model=model, ok=True, usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000), error=None, workspace_id=workspace_id, run_id=run_id)
                return result
            except (json.JSONDecodeError, ValidationError) as exc:
                last_err = f"invalid output: {type(exc).__name__}"
                _log(purpose=purpose, provider=self.transport.provider, model=model, ok=False, usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000), error=last_err, workspace_id=workspace_id, run_id=run_id)
                schema_attempts += 1
                if schema_attempts > 1:  # retry once, then give up (CLAUDE.md §6)
                    raise LLMError(last_err, "The AI returned malformed output twice for this batch.") from exc
            except TransientError as exc:
                last_err = str(exc)
                if exc.daily_quota:
                    _log(purpose=purpose, provider=self.transport.provider, model=model, ok=False, usage=usage,
                         latency_ms=int((time.monotonic() - t0) * 1000), error="daily quota exhausted",
                         workspace_id=workspace_id, run_id=run_id)
                    raise _DailyQuota() from exc
                _log(purpose=purpose, provider=self.transport.provider, model=model, ok=False, usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000), error=last_err, workspace_id=workspace_id, run_id=run_id)
                transient += 1
                if transient > max_transient_retries:
                    raise LLMError(last_err, "The AI provider is busy or out of quota. Try again in a few minutes.") from exc
                time.sleep(min(exc.retry_after or (2 ** transient), 60))


class _DailyQuota(Exception):
    pass


_EXHAUSTED: set[str] = set()  # per-process memo of models out of daily quota


def get_llm() -> LLM:
    s = get_settings()
    if not s.llm_configured:
        raise LLMNotConfigured()
    provider = s.llm_provider.lower()
    if provider == "gemini":
        from baton.llm.gemini import GeminiTransport

        return LLM(GeminiTransport(s.llm_api_key))
    raise LLMError(f"provider {provider} not implemented", f"LLM provider '{provider}' isn't implemented in this build.")
