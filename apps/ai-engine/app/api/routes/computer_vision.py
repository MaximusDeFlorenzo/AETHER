"""`POST /detect-cv` — the Computer Vision Engine's entry point. Dispatches
across the four `computer_vision/*.py` detectors (fire, smoke, flood,
infra_damage — the `cv_detection_type` enum, docs/DATABASE_SCHEMA.md §22),
each a classical color/texture heuristic (see their module docstrings for
why: no labeled disaster-imagery training set exists yet, same v0-baseline
posture as `hazard_prediction/`). `categories` in the request narrows which
detectors run; omitted, all four run.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import get_settings
from app.core.security import verify_internal_token
from app.ml.computer_vision import fire, flood, infra_damage, smoke
from app.ml.computer_vision.common import InvalidImageError, decode_image
from app.schemas.common import CvDetectionType
from app.schemas.computer_vision import DetectCvRequest, DetectCvResponse

router = APIRouter(tags=["computer-vision"], dependencies=[Depends(verify_internal_token)])

_DETECTORS = {
    "fire": fire.detect,
    "smoke": smoke.detect,
    "flood": flood.detect,
    "infra_damage": infra_damage.detect,
}


@router.post("/detect-cv", response_model=DetectCvResponse)
async def detect_cv_endpoint(payload: DetectCvRequest) -> DetectCvResponse:
    try:
        image = decode_image(payload.image_base64)
    except InvalidImageError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error

    categories: list[CvDetectionType] = payload.categories or list(_DETECTORS.keys())

    detections = []
    for category in categories:
        detections.extend(_DETECTORS[category](image))

    return DetectCvResponse(
        detections=detections,
        model_version=get_settings().model_version,
    )
