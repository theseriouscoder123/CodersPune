"""OpenAI-compatible chat-completions transport, used for Groq and for any OpenAI-compatible endpoint (OpenAI,
Azure OpenAI's v1 endpoint, vLLM, LM Studio, a local Ollama) via OPENAI_BASE_URL. No SDK dependency.

Structured output: we ask for `response_format: json_schema` (best effort, strict off). Models that don't support it
answer 400; we then fall back to JSON mode with the schema in the system prompt and remember that per model. Either
way the result is validated against the Pydantic schema by the caller, so a loose model can't slip bad data through.
"""

from __future__ import annotations

import json
import re

import httpx

from baton.llm.base import KeyRejected, LLMError, TransientError

URL = "https://api.groq.com/openai/v1/chat/completions"

_NO_SCHEMA_MODELS: set[str] = set()  # models that rejected json_schema: use json_object mode for them
_RETRY_IN = re.compile(r"try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", re.IGNORECASE)


class GroqTransport:
    provider = "groq"

    def __init__(self, api_key: str, timeout: float = 35.0, url: str = URL, provider: str = "groq"):
        self.api_key = api_key
        self.timeout = timeout
        self.url = url
        self.provider = provider

    def generate_json(self, *, system: str, user: str, json_schema: dict, model: str, temperature: float):
        if model not in _NO_SCHEMA_MODELS:
            r = self._post(self._body(system, user, model, temperature, json_schema, use_schema=True))
            if r.status_code == 400 and _schema_unsupported(r):
                _NO_SCHEMA_MODELS.add(model)
            else:
                return self._parse(r)
        return self._parse(self._post(self._body(system, user, model, temperature, json_schema, use_schema=False)))

    @staticmethod
    def _body(system: str, user: str, model: str, temperature: float, schema: dict, *, use_schema: bool) -> dict:
        if use_schema:
            fmt = {"type": "json_schema", "json_schema": {"name": "result", "schema": schema, "strict": False}}
            sys = system
        else:
            fmt = {"type": "json_object"}
            sys = (f"{system}\n\nReply with a single JSON object only, matching this JSON schema exactly:\n"
                   f"{json.dumps(schema, separators=(',', ':'))}")
        return {"model": model, "temperature": temperature, "response_format": fmt,
                "messages": [{"role": "system", "content": sys}, {"role": "user", "content": user}]}

    def _post(self, body: dict) -> httpx.Response:
        try:
            headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
            return httpx.post(self.url, json=body, timeout=self.timeout, headers=headers)
        except httpx.TimeoutException as exc:
            raise TransientError(f"{self.provider} timeout", server_error=True) from exc
        except httpx.HTTPError as exc:
            raise TransientError(f"{self.provider} network error {type(exc).__name__}", server_error=True) from exc

    @staticmethod
    def _parse(r: httpx.Response) -> tuple[str, dict]:
        msg = _error_message(r)
        if r.status_code == 413 or (r.status_code == 429 and "request too large" in msg.lower()):
            # bigger than this model's per-minute token limit: no amount of waiting helps, use the next chain entry
            raise TransientError(f"groq request too large for model ({r.status_code})", skip_target=True)
        if r.status_code in (429, 500, 502, 503, 504):
            daily = "per day" in msg.lower() or "(rpd)" in msg.lower() or "(tpd)" in msg.lower()
            raise TransientError(f"groq {r.status_code}", _retry_delay(r, msg), daily_quota=daily, server_error=r.status_code >= 500)
        if r.status_code in (401, 403):
            raise KeyRejected(f"groq auth {r.status_code}", "The LLM key was rejected by the provider.")
        if r.status_code >= 400:
            if r.status_code == 400 and "json_validate_failed" in r.text:
                return "", {}  # the model produced invalid JSON; "" fails json.loads, so the caller retries it as malformed
            raise LLMError(f"groq {r.status_code}: {msg[:160]}", f"The AI provider rejected the request ({r.status_code}).")
        data = r.json()
        choices = data.get("choices") or []
        text = (choices[0].get("message", {}).get("content") if choices else None) or ""
        if not text.strip():
            raise TransientError("groq empty response")
        u = data.get("usage") or {}
        return text, {"tokens_in": u.get("prompt_tokens"), "tokens_out": u.get("completion_tokens")}


def openai_compatible(base_url: str, api_key: str, timeout: float = 60.0) -> GroqTransport:
    """A transport for any OpenAI-compatible server. base_url is the API root, e.g. https://api.openai.com/v1 or
    http://localhost:11434/v1 (Ollama); an empty key is allowed for local servers."""
    return GroqTransport(api_key, timeout=timeout, url=base_url.rstrip("/") + "/chat/completions", provider="openai")


def _error_message(r: httpx.Response) -> str:
    if r.status_code < 400:
        return ""
    try:
        return str(r.json().get("error", {}).get("message", ""))
    except ValueError:
        return r.text[:300]


def _schema_unsupported(r: httpx.Response) -> bool:
    m = _error_message(r).lower()
    return "json_schema" in m or "response_format" in m or "response format" in m


def _retry_delay(r: httpx.Response, msg: str) -> float | None:
    h = r.headers.get("retry-after")
    if h:
        try:
            return min(float(h), 60)
        except ValueError:
            pass
    m = _RETRY_IN.search(msg)
    if m and any(m.groups()):
        h_, m_, s_ = (float(x) if x else 0.0 for x in m.groups())
        return min(h_ * 3600 + m_ * 60 + s_ + 0.5, 60)
    return None
