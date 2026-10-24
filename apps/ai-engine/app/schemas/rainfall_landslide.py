"""Schemas for `POST /predict-rain-landslide-risk`
(app/ml/rainfall/landslide_risk.py). Rainfall inputs are the same stored
series the flood baseline uses, so their schemas are shared."""

from datetime import datetime
from typing import Literal

from pydantic import Field, confloat, conint, model_validator

from app.schemas.base import CamelModel
from app.schemas.rainfall_flood import (
    FloodAntecedentIn,
    FloodFactorOut,
    FloodRainfallIn,
    FloodSoilMoistureIn,
    RiskLevel,
)

# Windows the trigger can be evaluated on: 1–24 h come from the rainfall
# series, 72 h from the antecedent series.
TRIGGER_WINDOWS = (1, 3, 6, 24, 72)


class LandslideTerrainIn(CamelModel):
    """DEM slope samples around the district point (one per sample site)."""

    source: str
    dem: str
    slope_samples_deg: list[confloat(ge=0, lt=90)] = Field(max_length=500)


class LandslidePointIn(CamelModel):
    id: str
    rainfall: FloodRainfallIn | None = None
    antecedent: FloodAntecedentIn | None = None
    soil_moisture: FloodSoilMoistureIn | None = None
    terrain: LandslideTerrainIn | None = None


class LandslideRiskParameters(CamelModel):
    # Rainfall intensity–duration thresholds I = alpha * D^-beta (I in mm/h,
    # D in h). Defaults: Guzzetti et al. 2008 global minimum (0.1–1000 h)
    # and Caine 1980 (0.167–500 h), both as tabulated in Brunetti et al.
    # 2010, NHESS 10:447, Table 2.
    lower_id_alpha: confloat(gt=0, le=1000) = 2.20
    lower_id_beta: confloat(ge=0, le=2) = 0.44
    upper_id_alpha: confloat(gt=0, le=1000) = 14.82
    upper_id_beta: confloat(ge=0, le=2) = 0.39
    trigger_windows_hours: list[conint(ge=1, le=72)] = [3, 6, 24, 72]
    # Permen PU No. 22/PRT/M/2007 landslide-zone typology: C 0–20 %,
    # B 20–40 %, A > 40 % slope.
    slope_gentle_max_percent: confloat(gt=0, le=1000) = 20.0
    slope_steep_min_percent: confloat(gt=0, le=1000) = 40.0
    # Terrain is classed by this quantile of the sampled slopes, so a
    # district point in a valley still registers the hills around it.
    slope_quantile: confloat(ge=0, le=1) = 0.9
    min_terrain_samples: conint(ge=1, le=500) = 8
    downgrade_gentle_terrain: bool = True

    @model_validator(mode="after")
    def _check(self) -> "LandslideRiskParameters":
        windows = self.trigger_windows_hours
        if not windows or len(set(windows)) != len(windows):
            raise ValueError("triggerWindowsHours must be non-empty and unique")
        unknown = set(windows) - set(TRIGGER_WINDOWS)
        if unknown:
            raise ValueError(f"unsupported trigger windows: {sorted(unknown)}")
        for d in windows:
            lower = self.lower_id_alpha * d ** -self.lower_id_beta
            upper = self.upper_id_alpha * d ** -self.upper_id_beta
            if upper <= lower:
                raise ValueError(f"upper ID threshold must exceed the lower one at {d} h")
        if not self.slope_gentle_max_percent < self.slope_steep_min_percent:
            raise ValueError("slope class bounds must increase")
        return self


class RainLandslideRiskRequest(CamelModel):
    issued_at: datetime
    points: list[LandslidePointIn] = Field(min_length=1, max_length=2000)
    parameters: LandslideRiskParameters = LandslideRiskParameters()


class LandslidePointOut(CamelModel):
    id: str
    status: Literal["ok", "insufficient_data"]
    level: RiskLevel | None
    # No labelled landslide history: a probability cannot be estimated yet.
    probability: None = None
    rain_trigger_level: RiskLevel | None = None
    trigger_class: Literal["below_lower", "above_lower", "above_upper"] | None = None
    # Window whose rainfall is closest to (or furthest over) the lower curve.
    critical_window_hours: int | None = None
    terrain_class: Literal["low", "medium", "high", "unknown"]
    slope_percent_at_quantile: float | None = None
    confidence: Literal["low", "very_low"]
    confidence_reasons: list[str]
    # No slope-stability model: the level describes conditions as of the
    # rainfall's valid time, not a lead time.
    time_to_risk_hours: None = None
    factors: list[FloodFactorOut]
    reason: str | None = None


class RainLandslideRiskResponse(CamelModel):
    model_version: str
    issued_at: datetime
    calibrated: bool = False
    parameters: LandslideRiskParameters
    factor_bases: dict[str, str]
    missing_inputs: list[str]
    points: list[LandslidePointOut]
