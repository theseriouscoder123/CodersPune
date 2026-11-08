"""Google Gemini transport (REST generateContent with responseJsonSchema). No SDK dependency."""

from __future__ import annotations

import httpx

from baton.llm.base import LLMError, TransientError

BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiTransport:
    provider = "gemini"

    def __init__(self, api_key: str, timeout: float = 90.0):
        self.api_key = api_key
        self.timeout = timeout

    def generate_json(self, *, system: str, user: str, json_schema: dict, model: str, temperature: float):
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
                "responseJsonSchema": json_schema,
            },
        }
        try:
            r = httpx.post(f"{BASE}/{model}:generateContent", json=body, timeout=self.timeout,
                           headers={"x-goog-api-key": self.api_key})
        except httpx.TimeoutException as exc:
            raise TransientError("gemini timeout") from exc
        except httpx.HTTPError as exc:
            raise TransientError(f"gemini network error {type(exc).__name__}") from exc

        if r.status_code in (429, 500, 502, 503, 504):
            retry = r.headers.get("retry-after")
            raise TransientError(f"gemini {r.status_code}", float(retry) if retry and retry.isdigit() else None)
        if r.status_code >= 400:
            msg = ""
            try:
                msg = r.json().get("error", {}).get("message", "")[:160]
            except ValueError:
                pass
            if r.status_code in (401, 403):
                raise LLMError(f"gemini auth {r.status_code}", "The LLM key was rejected by the provider.")
            raise LLMError(f"gemini {r.status_code}: {msg}", f"The AI provider rejected the request ({r.status_code}).")

        data = r.json()
        cands = data.get("candidates") or []
        if not cands or not cands[0].get("content", {}).get("parts"):
            reason = (cands[0].get("finishReason") if cands else None) or data.get("promptFeedback", {}).get("blockReason")
            raise TransientError(f"gemini empty response ({reason})")
        text = "".join(p.get("text", "") for p in cands[0]["content"]["parts"] if not p.get("thought"))
        um = data.get("usageMetadata", {})
        return text, {"tokens_in": um.get("promptTokenCount"), "tokens_out": um.get("candidatesTokenCount")}
