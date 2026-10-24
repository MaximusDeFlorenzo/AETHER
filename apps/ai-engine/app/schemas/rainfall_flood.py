"""Schemas for `POST /predict-rain-flood-risk` (app/ml/rainfall/flood_risk.py)."""

from datetime import datetime
from typing import Literal

from pydantic import Field, confloat, conint, model_validator

from app.schemas.base import CamelModel

RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "EXTREME"]
Freshness = Literal["fresh", "aging", "stale"]
FactorEffect = Literal["raised", "lowered", "none", "not_scored", "not_available"]
ACCUMULATION_KEYS = {"1", "3", "6", "24"}


class FloodRainfallIn(CamelModel):
    """Recent rainfall from ONE stored series (the caller picks the source)."""

    source: str
    data_kind: str
    valid_time: datetime
    freshness: Freshness
    max_hourly_mm_last_3_hours: confloat(ge=0, le=305) | None = None
    # Window hours ("1","3","6","24") → total mm, None when incomplete.
    accumulations_mm: dict[str, confloat(ge=0, le=5000) | None] = {}

    @model_validator(mode="after")
    def _check_keys(self) -> "FloodRainfallIn":
        unknown = set(self.accumulations_mm) - ACCUMULATION_KEYS
        if unknown:
            raise ValueError(f"unknown accumulation windows: {sorted(unknown)}")
        return self


class FloodAntecedentIn(CamelModel):
    source: str
    # Optional for older callers; the landslide baseline uses it for confidence.
    data_kind: str | None = None
    valid_time: datetime
    total_mm_72_hours: confloat(ge=0, le=10000) | None = None
    total_mm_168_hours: confloat(ge=0, le=20000) | None = None


class FloodSoilMoistureIn(CamelModel):
    source: str
    valid_time: datetime
    volumetric_fraction: confloat(ge=0, le=1)


class FloodSusceptibilityIn(CamelModel):
    source: str
    flood_hazard_index: confloat(ge=0, le=1) | None = None


class FloodGaugeIn(CamelModel):
    source: str
    name: str
    # Official Siaga level: 1 (most severe) … 4 (normal).
    alert_level: conint(ge=1, le=4)
    observed_at: datetime
    distance_km: confloat(ge=0, le=500)


class FloodPointIn(CamelModel):
    id: str
    rainfall: FloodRainfallIn | None = None
    antecedent: FloodAntecedentIn | None = None
    soil_moisture: FloodSoilMoistureIn | None = None
    susceptibility: FloodSusceptibilityIn | None = None
    gauge: FloodGaugeIn | None = None


class FloodRiskParameters(CamelModel):
    hourly_lebat_mm: confloat(gt=0, le=200) = 10.0
    hourly_sangat_lebat_mm: confloat(gt=0, le=300) = 20.0
    daily_lebat_mm: confloat(gt=0, le=1000) = 50.0
    daily_sangat_lebat_mm: confloat(gt=0, le=1000) = 100.0
    daily_ekstrem_mm: confloat(gt=0, le=2000) = 150.0
    # [low_upper, high_lower] for the flood hazard index; None → unknown class.
    susceptibility_breaks: list[confloat(ge=0, le=1)] | None = None
    downgrade_low_susceptibility: bool = True

    @model_validator(mode="after")
    def _check_order(self) -> "FloodRiskParameters":
        if not self.hourly_lebat_mm < self.hourly_sangat_lebat_mm:
            raise ValueError("hourly thresholds must increase")
        if not self.daily_lebat_mm < self.daily_sangat_lebat_mm < self.daily_ekstrem_mm:
            raise ValueError("daily thresholds must increase")
        breaks = self.susceptibility_breaks
        if breaks is not None and (len(breaks) != 2 or breaks[0] > breaks[1]):
            raise ValueError("susceptibilityBreaks must be [lowUpper, highLower] ascending")
        return self


class RainFloodRiskRequest(CamelModel):
    issued_at: datetime
    points: list[FloodPointIn] = Field(min_length=1, max_length=2000)
    parameters: FloodRiskParameters = FloodRiskParameters()


class FloodFactorOut(CamelModel):
    factor: str
    value: float | None
    unit: str
    assessment: str | None = None
    effect: FactorEffect
    # Point-specific context (e.g. which gauge); the general basis of each
    # factor is in RainFloodRiskResponse.factor_bases.
    detail: str | None = None
    source: str | None = None


class FloodPointOut(CamelModel):
    id: str
    status: Literal["ok", "insufficient_data"]
    level: RiskLevel | None
    # No labelled flood history: a probability cannot be estimated yet.
    probability: None = None
    rain_trigger_level: RiskLevel | None = None
    hourly_category: str | None = None
    daily_category: str | None = None
    susceptibility_class: Literal["low", "medium", "high", "unknown"]
    gauge_floor: RiskLevel | None = None
    # Qualitative input-quality label, NOT a probability.
    confidence: Literal["low", "very_low"]
    confidence_reasons: list[str]
    # Without a hydrological model there is no lead-time estimate: the level
    # describes conditions as of the rainfall's valid time.
    time_to_risk_hours: None = None
    factors: list[FloodFactorOut]
    reason: str | None = None


class RainFloodRiskResponse(CamelModel):
    model_version: str
    issued_at: datetime
    calibrated: bool = False
    parameters: FloodRiskParameters
    factor_bases: dict[str, str]
    missing_inputs: list[str]
    points: list[FloodPointOut]
