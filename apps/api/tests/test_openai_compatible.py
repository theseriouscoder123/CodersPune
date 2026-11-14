"""Self-hosting: any OpenAI-compatible server (OpenAI, Azure OpenAI v1, vLLM, a local Ollama) via OPENAI_BASE_URL."""

import httpx
from pydantic import BaseModel

from baton.config import Settings
from baton.llm import base
from baton.llm.base import LLM, parse_chain
from baton.llm.groq import openai_compatible


class Out(BaseModel):
    answer: str


def test_chain_parsing_keeps_colons_in_model_names():
    assert [(t.provider, t.model) for t in parse_chain("openai:llama3.1:8b,gemini:gemini-3.5-flash", "gemini")] == [
        ("openai", "llama3.1:8b"), ("gemini", "gemini-3.5-flash")]
    assert [(t.provider, t.model) for t in parse_chain("qwen2.5:7b", "openai")] == [("openai", "qwen2.5:7b")]


def test_settings_local_server_counts_as_configured():
    s = Settings(_env_file=None, openai_base_url="http://localhost:11434/v1", llm_provider="openai",
                 llm_model_extract="llama3.1:8b", llm_model_verify="llama3.1:8b")
    assert s.llm_configured and s.key_pool("openai") == []


def test_transport_posts_to_base_url_with_or_without_key(monkeypatch):
    seen = []

    def fake_post(url, json, timeout, headers):
        seen.append((url, headers, json["model"]))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"answer": "ok"}'}}], "usage": {}},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr("baton.llm.groq.httpx.post", fake_post)
    monkeypatch.setattr(base, "_log", lambda **kw: None)
    local = LLM({"openai": [openai_compatible("http://localhost:11434/v1/", "")]}, default_provider="openai")
    assert local.structured(system="s", user="u", schema=Out, model="llama3.1:8b", purpose="test").answer == "ok"
    hosted = LLM({"openai": [openai_compatible("https://api.example.com/v1", "sk-test")]}, default_provider="openai")
    hosted.structured(system="s", user="u", schema=Out, model="openai:gpt-4o-mini", purpose="test")
    assert seen[0] == ("http://localhost:11434/v1/chat/completions", {}, "llama3.1:8b")  # no auth header for local
    assert seen[1] == ("https://api.example.com/v1/chat/completions", {"Authorization": "Bearer sk-test"}, "gpt-4o-mini")
