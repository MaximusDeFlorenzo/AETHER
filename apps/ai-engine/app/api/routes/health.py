from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """No auth (see docs/API_SPEC.md "Auth guard posture") — used for
    container/orchestration liveness checks, same as AI-ORION's `/health`."""
    settings = get_settings()
    return {"status": "ok", "modelVersion": settings.model_version}
