from fastapi import APIRouter, Depends

from app.core.security import verify_internal_token
from app.ml.decision_intelligence.explainability import generate_recommendation
from app.schemas.recommendation import (
    GenerateRecommendationRequest,
    GenerateRecommendationResponse,
)

router = APIRouter(tags=["recommendation"], dependencies=[Depends(verify_internal_token)])


@router.post("/generate-recommendation", response_model=GenerateRecommendationResponse)
async def generate_recommendation_endpoint(
    payload: GenerateRecommendationRequest,
) -> GenerateRecommendationResponse:
    summary_text, reasons = generate_recommendation(
        hazard_event=payload.hazard_event,
        district=payload.district,
        prediction=payload.prediction,
        priority=payload.priority,
        historical_disasters=payload.historical_disasters,
        related_events=payload.related_events,
    )
    return GenerateRecommendationResponse(
        summary_text=summary_text,
        reasons=reasons,
        confidence_score=payload.priority.confidence_score,
        action_recommendation=None,
    )
