from fastapi import APIRouter, Depends

from app.core.security import verify_internal_token
from app.ml.decision_intelligence.priority_scorer import calculate_priority
from app.schemas.priority import CalculatePriorityRequest, CalculatePriorityResponse

router = APIRouter(tags=["priority"], dependencies=[Depends(verify_internal_token)])


@router.post("/calculate-priority", response_model=CalculatePriorityResponse)
async def calculate_priority_endpoint(
    payload: CalculatePriorityRequest,
) -> CalculatePriorityResponse:
    priority_level, priority_score, confidence_score = calculate_priority(
        hazard_type=payload.hazard_type,
        prediction=payload.prediction,
        district=payload.district,
    )
    return CalculatePriorityResponse(
        priority_level=priority_level,
        priority_score=priority_score,
        confidence_score=confidence_score,
    )
