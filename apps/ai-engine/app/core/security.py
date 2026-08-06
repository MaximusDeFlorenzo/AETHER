from fastapi import Header, HTTPException, status

from app.core.config import get_settings


async def verify_internal_token(x_internal_token: str = Header(...)) -> None:
    """Reused verbatim from `AI-ORION/app/core/security.py`. Secures every
    `api -> ai-engine` hop with a static shared secret (`X-Internal-Token`),
    deliberately separate from end-user JWTs — see docs/ARCHITECTURE.md §1
    "Invariants"."""
    settings = get_settings()
    if x_internal_token != settings.internal_service_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal service token",
        )
