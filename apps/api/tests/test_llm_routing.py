"""Key-pool rotation and cross-provider fallback (DECISIONS D26). Fake transports, no network, no real keys."""

import json

import pytest
from pydantic import BaseModel

from baton.llm import base
from baton.llm.base import LLM, KeyRejected, LLMError, TransientError, parse_chain


class Out(BaseModel):
    answer: str


class Fake:
    def __init__(self, provider, name, script):
        self.provider, self.name, self.script, self.calls = provider, name, list(script), []

    def generate_json(self, *, system, user, json_schema, model, temperature):
        self.calls.append(model)
        step = self.script.pop(0) if self.script else "ok"
        if step == "ok":
            return json.dumps({"answer": f"{self.name}:{model}"}), {"tokens_in": 1, "tokens_out": 1}
        if step == "bad":
            return "not json", {}
        if step == "rpm":
            raise TransientError("429", retry_after=5)
        if step == "daily":
            raise TransientError("429 daily", daily_quota=True)
        if step == "big":
            raise TransientError("too large", skip_target=True)
        if step == "auth":
            raise KeyRejected("401")
        raise AssertionError(step)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    base._EXHAUSTED.clear()
    base._RR.clear()
    sleeps = []
    monkeypatch.setattr(base.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(base, "_log", lambda **kw: None)
    yield sleeps


def call(llm, chain="gemini:m1"):
    return llm.structured(system="s", user="u", schema=Out, model=chain, purpose="test").answer


def test_parse_chain_prefixes_and_defaults():
    assert [t.label for t in parse_chain("m1, groq:llama-x ,gemini:m2,openrouter/x:free", "gemini")] == [
        "gemini:m1", "groq:llama-x", "gemini:m2", "gemini:openrouter/x:free"]


def test_rate_limited_key_hands_over_without_sleeping(_clean):
    a, b = Fake("gemini", "a", ["rpm"]), Fake("gemini", "b", [])
    assert call(LLM({"gemini": [a, b]})) == "b:m1"
    assert _clean == []  # no waiting while another key is free


def test_round_robin_spreads_calls_across_keys():
    a, b, c = (Fake("gemini", n, []) for n in "abc")
    llm = LLM({"gemini": [a, b, c]})
    assert [call(llm) for _ in range(3)] == ["a:m1", "b:m1", "c:m1"]


def test_daily_quota_key_is_skipped_afterwards():
    a, b = Fake("gemini", "a", ["daily"]), Fake("gemini", "b", [])
    llm = LLM({"gemini": [a, b]})
    assert call(llm) == "b:m1"
    assert call(llm) == "b:m1" and call(llm) == "b:m1"
    assert len(a.calls) == 1  # never asked again while marked out


def test_falls_back_to_next_provider_when_all_keys_are_out():
    g1, g2 = Fake("gemini", "g1", ["daily"]), Fake("gemini", "g2", ["daily"])
    q = Fake("groq", "q", [])
    assert call(LLM({"gemini": [g1, g2], "groq": [q]}), "gemini:m1,groq:llama") == "q:llama"


def test_rejected_key_is_dropped_for_every_model():
    a, b = Fake("gemini", "a", ["auth"]), Fake("gemini", "b", [])
    llm = LLM({"gemini": [a, b]})
    assert call(llm, "gemini:m1") == "b:m1"
    assert call(llm, "gemini:m2") == "b:m2"
    assert a.calls == ["m1"]


def test_too_large_request_moves_to_next_chain_entry():
    q, g = Fake("groq", "q", ["big"]), Fake("gemini", "g", [])
    assert call(LLM({"groq": [q], "gemini": [g]}), "groq:small,gemini:m1") == "g:m1"


def test_malformed_output_retried_once_then_fails():
    a = Fake("gemini", "a", ["bad"])
    assert call(LLM({"gemini": [a]})) == "a:m1"
    b = Fake("gemini", "b", ["bad", "bad"])
    with pytest.raises(LLMError) as e:
        call(LLM({"gemini": [b]}))
    assert "malformed" in e.value.user_message


def test_sleeps_only_when_every_key_is_rate_limited(_clean):
    a, b = Fake("gemini", "a", ["rpm"]), Fake("gemini", "b", ["rpm"])
    assert call(LLM({"gemini": [a, b]})) in ("a:m1", "b:m1")
    assert _clean == [5]


def test_missing_provider_pool_is_skipped():
    g = Fake("gemini", "g", [])
    assert call(LLM({"gemini": [g]}), "groq:llama,gemini:m1") == "g:m1"


def test_all_out_raises_quota_message():
    a = Fake("gemini", "a", ["daily"])
    with pytest.raises(LLMError) as e:
        call(LLM({"gemini": [a]}))
    assert "quota" in e.value.user_message


def test_key_pool_merges_single_key_and_never_duplicates():
    from baton.config import Settings

    s = Settings(llm_provider="gemini", llm_api_key="k0", gemini_api_keys="k1, k2,k0", groq_api_keys="g1,g2")
    assert s.key_pool("gemini") == ["k1", "k2", "k0"]
    assert s.key_pool("groq") == ["g1", "g2"]
    assert Settings(groq_api_keys="g1", llm_model_extract="", llm_model_verify="").llm_configured is False  # models required
