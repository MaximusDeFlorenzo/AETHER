from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent.parent
_MONOREPO_ROOT = _AI_ENGINE_DIR.parent.parent


class Settings(BaseSettings):
    """Reuses AI-ORION's `pydantic-settings` + `.env` pattern verbatim
    (`AI-ORION/app/core/config.py`). AETHER's ai-engine has no root .env of its
    own — it reads the monorepo root `.env` (see `../../.env.example`), where
    `INTERNAL_SERVICE_TOKEN` is shared with `apps/api` so the internal-token
    handshake matches on both sides. `env_file` is resolved to an absolute
    path (not the CWD-relative `".env"` pydantic-settings defaults to) so
    this still finds the root `.env` when run via the documented `cd
    apps/ai-engine && uvicorn ...` local-dev workflow, where CWD is
    apps/ai-engine, not the monorepo root. A local apps/ai-engine/.env, if
    present, is read second so it can override individual keys (e.g.
    MODEL_VERSION/PORT/LOG_LEVEL) per-environment without touching the
    shared root file."""

    model_config = SettingsConfigDict(
        env_file=(
            str(_MONOREPO_ROOT / ".env"),
            str(_AI_ENGINE_DIR / ".env"),
        ),
        extra="ignore",
    )

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
