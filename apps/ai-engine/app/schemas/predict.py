"""Schemas for `POST /predict-risk` — the AETHER generalization of AI-ORION's
`schemas/predict.py` (`PredictImpactRequest`/`Response`, earthquake-only).

The core generalization: `HazardEventInput` carries a `hazard_type`
discriminator plus one optional nested `*Details` block per hazard, instead of
a single hardwired `EarthquakeInput`. `risk_score`/`exposure_level` replace
ORION's `severity_score`/`damage_level` naming to match
`docs/DATABASE_SCHEMA.md`'s `risk_assessments` columns exactly."""

from pydantic import confloat, conint, model_validator

from app.schemas.base import CamelModel
from app.schemas.common import (
    DistrictInput,
    ExposureLevel,
    HazardType,
    HistoricalDisasterInput,
)


class EarthquakeDetails(CamelModel):
    magnitude: confloat(gt=0, lt=10)
    depth_km: confloat(ge=0)


class LandslideDetails(CamelModel):
    slope_degrees: confloat(ge=0, le=90)
    soil_saturation: confloat(ge=0, le=1)
    triggering_rainfall_mm: confloat(ge=0)


class FloodDetails(CamelModel):
    """Mirrors `flood_details` (docs/DATABASE_SCHEMA.md §13). `river_basin` is
    descriptive only (feeds XAI narrative text), not a scoring input."""

    rainfall_mm: confloat(ge=0)
    water_level_m: confloat(ge=0)
    river_basin: str | None = None


class WildfireDetails(CamelModel):
    """Mirrors `wildfire_details` (docs/DATABASE_SCHEMA.md §14), sourced from
    NASA FIRMS hotspot detections. `brightness_kelvin` is optional since not
    every FIRMS record reports it consistently."""

    frp_confidence: confloat(ge=0, le=1)
    hotspot_count: conint(ge=0)
    brightness_kelvin: confloat(ge=0) | None = None


class HazardEventInput(CamelModel):
    hazard_type: HazardType
    latitude: confloat(ge=-90, le=90)
    longitude: confloat(ge=-180, le=180)
    event_time: str
    earthquake: EarthquakeDetails | None = None
    landslide: LandslideDetails | None = None
    flood: FloodDetails | None = None
    wildfire: WildfireDetails | None = None

    @model_validator(mode="after")
    def _require_matching_details_block(self) -> "HazardEventInput":
        if self.hazard_type == "earthquake" and self.earthquake is None:
            raise ValueError("`earthquake` details are required when hazardType is 'earthquake'")
        if self.hazard_type == "landslide" and self.landslide is None:
            raise ValueError("`landslide` details are required when hazardType is 'landslide'")
        if self.hazard_type == "flood" and self.flood is None:
            raise ValueError("`flood` details are required when hazardType is 'flood'")
        if self.hazard_type == "wildfire" and self.wildfire is None:
            raise ValueError("`wildfire` details are required when hazardType is 'wildfire'")
        return self


class PredictRiskRequest(CamelModel):
    hazard_event: HazardEventInput
    district: DistrictInput
    historical_disasters: list[HistoricalDisasterInput] = []


class PredictRiskResponse(CamelModel):
    hazard_type: HazardType
    risk_score: confloat(ge=0, le=100)
    exposure_level: ExposureLevel
    estimated_affected_population: conint(ge=0)
    confidence_score: confloat(ge=0, le=1)
    model_version: str
