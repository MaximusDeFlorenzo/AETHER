"""Schemas for `POST /generate-recommendation` — generalizes AI-ORION's
`schemas/recommendation.py`. Adds `related_events`, the new cascading-hazard
context ORION never had, and `action_recommendation` to match
`docs/DATABASE_SCHEMA.md`'s `decision_recommendations.action_recommendation`
column."""

from pydantic import confloat

from app.schemas.base import CamelModel
from app.schemas.common import DistrictInput, Reason, RelatedHazardEventContext
from app.schemas.predict import HazardEventInput, PredictRiskResponse
from app.schemas.priority import CalculatePriorityResponse


class GenerateRecommendationRequest(CamelModel):
    hazard_event: HazardEventInput
    district: DistrictInput
    prediction: PredictRiskResponse
    priority: CalculatePriorityResponse
    historical_disasters: list = []
    related_events: list[RelatedHazardEventContext] = []


class GenerateRecommendationResponse(CamelModel):
    summary_text: str
    reasons: list[Reason]
    confidence_score: confloat(ge=0, le=1)
    action_recommendation: str | None = None
