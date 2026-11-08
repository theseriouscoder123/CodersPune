"""Environment settings. Reads real env vars first, then the repo-root .env (local dev only)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(_REPO_ROOT_ENV, ".env"), extra="ignore")

    database_url: str = "postgresql+psycopg://baton:baton@localhost:5433/baton"
    github_token: str = ""

    llm_provider: str = "anthropic"
    llm_api_key: str = ""
    llm_model_extract: str = ""
    llm_model_verify: str = ""
    verifier: str = "llm"
    embeddings: str = "off"

    session_secret: str = "change-me"
    custom_workspace_daily_limit: int = 3
    pipeline_slice_seconds: int = 45
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key and self.llm_model_extract and self.llm_model_verify)


@lru_cache
def get_settings() -> Settings:
    return Settings()
