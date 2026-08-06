"""Schemas for `POST /calculate-priority` — generalizes AI-ORION's
`schemas/priority.py` with a `hazard_type` so `priority_scorer.py` can apply
per-hazard thresholds instead of the earthquake-only constants ORION hardwired."""

from pydantic import confloat

from app.schemas.base import CamelModel
from app.schemas.common import DistrictInput, HazardType, PriorityLevel
from app.schemas.predict import PredictRiskResponse


class CalculatePriorityRequest(CamelModel):
    hazard_type: HazardType
    prediction: PredictRiskResponse
    district: DistrictInput


class CalculatePriorityResponse(CamelModel):
    priority_level: PriorityLevel
    priority_score: confloat(ge=0, le=100)
    confidence_score: confloat(ge=0, le=1)
