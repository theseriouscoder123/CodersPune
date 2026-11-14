"""Environment settings. Reads real env vars first, then the repo-root .env (local dev only)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(_REPO_ROOT_ENV, ".env"), extra="ignore")

    database_url: str = "postgresql+psycopg://baton:baton@localhost:5433/baton"
    github_token: str = ""

    llm_provider: str = "gemini"  # provider for bare model names in the chains below
    llm_api_key: str = ""  # single key for llm_provider (kept for compatibility; joins that provider's pool)
    gemini_api_keys: str = ""  # comma-separated key pool
    groq_api_keys: str = ""  # comma-separated key pool
    # Any OpenAI-compatible server (self-hosting): OpenAI, Azure OpenAI's v1 endpoint, vLLM, LM Studio or a local
    # Ollama (http://localhost:11434/v1, no key). Use it with chain entries like "openai:llama3.1:8b".
    openai_base_url: str = ""
    openai_api_keys: str = ""  # comma-separated key pool; may be empty for a local server
    llm_model_extract: str = ""
    llm_model_verify: str = ""
    verifier: str = "llm"
    embeddings: str = "off"

    # Optional notifications. Everything works without these; features just report "not configured".
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465  # 465 = implicit TLS (Gmail); 587 = STARTTLS
    smtp_user: str = ""  # e.g. your Gmail address
    smtp_password: str = ""  # a Gmail *app password* (needs 2-step verification), never the account password
    mail_from: str = ""  # defaults to "Baton <smtp_user>"
    app_url: str = "https://baton-lac.vercel.app"  # used to build links in messages
    slack_webhook_url: str = ""  # optional operator feed (custom workspaces created, runs failed)

    session_secret: str = "change-me"
    custom_workspace_daily_limit: int = 3
    pipeline_slice_seconds: int = 45
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def key_pool(self, provider: str) -> list[str]:
        raw = {"gemini": self.gemini_api_keys, "groq": self.groq_api_keys, "openai": self.openai_api_keys}.get(provider, "")
        keys = [k.strip() for k in raw.split(",") if k.strip()]
        if provider == self.llm_provider.lower() and self.llm_api_key.strip() and self.llm_api_key.strip() not in keys:
            keys.insert(0, self.llm_api_key.strip())
        return keys

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_user.strip() and self.smtp_password.strip())

    @property
    def llm_configured(self) -> bool:
        has_key = bool(self.llm_api_key or self.gemini_api_keys or self.groq_api_keys or self.openai_base_url.strip())
        return bool(has_key and self.llm_model_extract and self.llm_model_verify)


@lru_cache
def get_settings() -> Settings:
    return Settings()
