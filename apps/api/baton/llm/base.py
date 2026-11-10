"""Provider-agnostic structured-output LLM adapter (docs/02 §5).

Contract: `structured()` returns a validated instance of `schema` or raises LLMError. Invalid JSON / schema mismatch
is retried once; 429/5xx are retried with backoff. Every call is logged to `llm_calls` with METADATA ONLY (never
prompt or response text, never keys).

Routing (DECISIONS D26):
  * `model` is a comma-separated fallback chain. Each entry is `provider:model` or a bare model for LLM_PROVIDER,
    e.g. `gemini:gemini-3.5-flash,groq:llama-3.3-70b-versatile`.
  * Each provider has a key pool (GEMINI_API_KEYS, GROQ_API_KEYS). Calls start at a rotating key to spread load.
  * A per-minute 429 moves straight to the next key; we only sleep when every live key is rate-limited.
  * A key whose daily quota for a model is used up, or that the provider rejects, is skipped for a while.
  * When every key for a chain entry is out, the next chain entry is tried.
"""

from __future__ import annotations

import itertools
import json
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from baton.config import get_settings

T = TypeVar("T", bound=BaseModel)

PROVIDERS = ("gemini", "groq")
EXHAUSTED_TTL_S = 3600
CALL_BUDGET_S = 40.0  # one structured() call, all retries included: fits inside a ~45 s pipeline slice  # retry a "daily quota" key/model after an hour (cheap: one call), serverless resets anyway


class LLMError(RuntimeError):
    """A call failed after retries. `user_message` is safe to show in the UI."""

    def __init__(self, message: str, user_message: str | None = None):
        super().__init__(message)
        self.user_message = user_message or message


class LLMNotConfigured(LLMError):
    def __init__(self):
        super().__init__("LLM not configured", "AI pipeline unavailable: no LLM key is configured on the server.")


class KeyRejected(LLMError):
    """The provider rejected this key (401/403). Other keys may still work."""


class Transport(Protocol):
    provider: str

    def generate_json(self, *, system: str, user: str, json_schema: dict, model: str, temperature: float) -> tuple[str, dict]:
        """Return (raw JSON text, usage dict with tokens_in/tokens_out). Raise TransientError / LLMError."""


class TransientError(Exception):
    def __init__(self, message: str, retry_after: float | None = None, daily_quota: bool = False,
                 skip_target: bool = False, server_error: bool = False):
        super().__init__(message)
        self.server_error = server_error  # 5xx / timeout from the provider: the model, not our key, is the problem
        self.retry_after = retry_after
        self.daily_quota = daily_quota  # this key+model is done for the day: switch keys instead of waiting
        self.skip_target = skip_target  # this request can't run on this model at all (e.g. too large): next chain entry


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


@dataclass(frozen=True)
class Target:
    provider: str
    model: str

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"


def parse_chain(chain: str, default_provider: str) -> list[Target]:
    out: list[Target] = []
    for raw in chain.split(","):
        entry = raw.strip()
        if not entry:
            continue
        head, sep, rest = entry.partition(":")
        if sep and head.lower() in PROVIDERS and rest:
            out.append(Target(head.lower(), rest.strip()))
        else:
            out.append(Target(default_provider.lower(), entry))
    return out


def _log(*, purpose: str, provider: str, model: str, ok: bool, latency_ms: int, usage: dict, error: str | None,
         workspace_id=None, run_id=None) -> None:
    try:
        from baton.db.models import LlmCall
        from baton.db.session import SessionLocal
        from baton.security import redact

        error = redact(error)

        with SessionLocal.begin() as db:
            db.add(LlmCall(workspace_id=workspace_id, run_id=run_id, purpose=purpose, provider=provider, model=model,
                           tokens_in=usage.get("tokens_in"), tokens_out=usage.get("tokens_out"),
                           latency_ms=latency_ms, ok=ok, error=(error or "")[:300] or None))
    except Exception:  # noqa: BLE001 - logging must never break a run
        pass


class _TargetDone(Exception):
    """Every key for this chain entry is out (or the request can't run on it): try the next entry."""

    def __init__(self, error: LLMError):
        super().__init__(str(error))
        self.error = error


_QUOTA_MSG = "The AI provider's daily free quota is used up. Try again tomorrow."

# Per-process memo: (provider, key slot, model or "*") -> monotonic time it was marked out.
_EXHAUSTED: dict[tuple[str, int, str], float] = {}
_RR: dict[str, itertools.count] = defaultdict(itertools.count)  # round-robin start key per provider


def _is_out(provider: str, slot: int, model: str) -> bool:
    now = time.monotonic()
    for key in ((provider, slot, model), (provider, slot, "*")):
        t = _EXHAUSTED.get(key)
        if t is not None:
            if now - t < EXHAUSTED_TTL_S:
                return True
            _EXHAUSTED.pop(key, None)
    return False


class LLM:
    def __init__(self, pools: dict[str, list[Transport]], default_provider: str = "gemini"):
        self.pools = {p: list(ts) for p, ts in pools.items() if ts}
        self.default_provider = default_provider

    def structured(self, *, system: str, user: str, schema: type[T], model: str, purpose: str,
                   temperature: float = 0.0, workspace_id=None, run_id=None, max_transient_retries: int = 6,
                   budget_s: float = CALL_BUDGET_S) -> T:
        """`budget_s` bounds the whole call (all keys, models and waits) so one call can never stall a pipeline slice
        or a request: a model that is overloaded (5xx) or would make us wait too long hands over to the next one."""
        targets = parse_chain(model, self.default_provider)
        deadline = time.monotonic() + budget_s
        last: LLMError | None = None
        for t in targets:
            pool = self.pools.get(t.provider)
            if not pool:
                last = last or LLMError(f"no key for {t.provider}", "No API key is configured for the AI provider.")
                continue
            if time.monotonic() >= deadline:
                break
            try:
                return self._structured_target(t, pool, system=system, user=user, schema=schema, purpose=purpose,
                                               temperature=temperature, workspace_id=workspace_id, run_id=run_id,
                                               max_transient_retries=max_transient_retries, deadline=deadline)
            except _TargetDone as done:
                last = done.error
        raise last or LLMError("all models exhausted", _QUOTA_MSG)

    def _structured_target(self, t: Target, pool: list[Transport], *, system: str, user: str, schema: type[T],
                           purpose: str, temperature: float, workspace_id, run_id, max_transient_retries: int,
                           deadline: float) -> T:
        json_schema = inline_refs(schema.model_json_schema())
        n = len(pool)
        start = next(_RR[t.provider]) % n
        order = [(start + i) % n for i in range(n)]
        invalid = 0
        rounds = 0
        server_errors = 0
        last_err = "unknown"
        busy = LLMError("busy", "The AI provider is busy or out of quota. Try again in a few minutes.")
        while True:
            if time.monotonic() >= deadline:
                raise _TargetDone(busy)
            live = [i for i in order if not _is_out(t.provider, i, t.model)]
            if not live:
                raise _TargetDone(LLMError(f"{t.label}: all keys out", _QUOTA_MSG))
            waits: list[float] = []
            for slot in live:
                tr = pool[slot]
                log = {"purpose": purpose, "provider": f"{t.provider}#{slot + 1}", "model": t.model,
                       "workspace_id": workspace_id, "run_id": run_id}
                t0 = time.monotonic()
                usage: dict = {}
                try:
                    raw, usage = tr.generate_json(system=system, user=user, json_schema=json_schema, model=t.model,
                                                  temperature=temperature)
                    result = schema.model_validate(json.loads(raw))
                    _log(**log, ok=True, usage=usage, latency_ms=int((time.monotonic() - t0) * 1000), error=None)
                    return result
                except (json.JSONDecodeError, ValidationError) as exc:
                    last_err = f"invalid output: {type(exc).__name__}"
                    _log(**log, ok=False, usage=usage, latency_ms=int((time.monotonic() - t0) * 1000), error=last_err)
                    invalid += 1
                    if invalid > 1:  # retry once (on the next key), then give up on this batch (CLAUDE.md §6)
                        raise LLMError(last_err, "The AI returned malformed output twice for this batch.") from exc
                    waits.append(0)
                except KeyRejected as exc:
                    _log(**log, ok=False, usage=usage, latency_ms=int((time.monotonic() - t0) * 1000), error="key rejected")
                    _EXHAUSTED[(t.provider, slot, "*")] = time.monotonic()
                    last_err = str(exc)
                except TransientError as exc:
                    last_err = str(exc)
                    if exc.skip_target:
                        _log(**log, ok=False, usage=usage, latency_ms=int((time.monotonic() - t0) * 1000), error=last_err)
                        raise _TargetDone(LLMError(last_err, "The request was too large for the AI model.")) from exc
                    if exc.daily_quota:
                        _log(**log, ok=False, usage=usage, latency_ms=int((time.monotonic() - t0) * 1000),
                             error="daily quota exhausted")
                        _EXHAUSTED[(t.provider, slot, t.model)] = time.monotonic()
                        continue  # this key is done for this model: next key
                    _log(**log, ok=False, usage=usage, latency_ms=int((time.monotonic() - t0) * 1000), error=last_err)
                    if exc.server_error:
                        server_errors += 1
                        if server_errors >= 2:  # the model itself is overloaded/down (not our key): use the next model
                            raise _TargetDone(LLMError(last_err, busy.user_message)) from exc
                    waits.append(exc.retry_after if exc.retry_after is not None else 2 ** (rounds + 1))
                    # rate-limited on this key: fall through to the next key right away
                if time.monotonic() >= deadline:
                    raise _TargetDone(busy)
            if not waits:
                continue  # keys were marked out this round; the next loop re-checks (and may finish the target)
            if min(waits) == 0:
                continue  # a malformed-output retry is pending: no need to sleep
            rounds += 1
            wait = min(min(waits), 60)
            if rounds > max_transient_retries or time.monotonic() + wait >= deadline:
                raise _TargetDone(LLMError(last_err, busy.user_message))  # don't wait it out: try the next model
            time.sleep(wait)


def key_pools(s=None) -> dict[str, list[str]]:
    s = s or get_settings()
    return {p: s.key_pool(p) for p in PROVIDERS}


def get_llm() -> LLM:
    s = get_settings()
    if not s.llm_configured:
        raise LLMNotConfigured()
    pools: dict[str, list[Transport]] = {}
    keys = key_pools(s)
    if keys["gemini"]:
        from baton.llm.gemini import GeminiTransport

        pools["gemini"] = [GeminiTransport(k) for k in keys["gemini"]]
    if keys["groq"]:
        from baton.llm.groq import GroqTransport

        pools["groq"] = [GroqTransport(k) for k in keys["groq"]]
    return LLM(pools, default_provider=s.llm_provider)
