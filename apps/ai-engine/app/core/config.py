from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Reuses AI-ORION's `pydantic-settings` + `.env` pattern verbatim
    (`AI-ORION/app/core/config.py`). AETHER's ai-engine has no root .env of its
    own — it reads the monorepo root `.env` (see `../../.env.example`), where
    `INTERNAL_SERVICE_TOKEN` is shared with `apps/api` so the internal-token
    handshake matches on both sides."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AETHER AI Engine"
    # v0 baseline: documented weighted heuristics, not trained models (see
    # app/ml/hazard_prediction/*.py docstrings). Bumped when the heuristics
    # change materially, swapped for a real model version once one exists.
    model_version: str = "hazard-heuristic-v0.1-dev"
    internal_service_token: str = "dev-internal-token"
    port: int = 8000
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
