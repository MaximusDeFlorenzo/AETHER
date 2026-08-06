"""Hazard-agnostic request/response building blocks shared across every
schemas/*.py module — the AETHER generalization of AI-ORION's
`schemas/common.py` (which only ever had `EarthquakeInput`)."""

from typing import Literal

from pydantic import Field, confloat, conint

from app.schemas.base import CamelModel

HazardType = Literal["earthquake", "flood", "landslide", "wildfire"]
ExposureLevel = Literal["low", "moderate", "high", "severe"]
PriorityLevel = Literal["low", "medium", "high", "critical"]
RelationshipType = Literal["triggers", "exacerbates", "coincides"]
# Mirrors the `cv_detection_type` Postgres enum (docs/DATABASE_SCHEMA.md §22).
CvDetectionType = Literal["flood", "smoke", "fire", "infra_damage"]


class DistrictInput(CamelModel):
    """Generalizes `EarthquakeInput`'s district shape: `distance_from_event_km`
    replaces ORION's `distance_from_epicenter_km` since not every hazard has an
    epicenter (a landslide's "event" is a point/area of occurrence, not a
    seismic epicenter)."""

    id: str
    name: str
    total_population: conint(ge=0)
    population_density: confloat(ge=0)
    distance_from_event_km: confloat(ge=0)


class HistoricalDisasterInput(CamelModel):
    event_date: str
    hazard_type: HazardType | None = None
    magnitude: float | None = None
    casualties_dead: conint(ge=0) = 0
    damaged_buildings_count: conint(ge=0) = 0


class Reason(CamelModel):
    factor: str
    detail: str
    weight: float | None = Field(default=None, ge=0, le=1)


class RelatedHazardEventContext(CamelModel):
    """Describes another hazard event near the one being assessed, e.g. "an
    earthquake occurred nearby 6 hours ago". Feeds both the
    Spatial Intelligence relationship detector and the new
    `factor="cascading_hazard"` XAI reason — this whole concept is new vs.
    ORION, which only ever reasoned about a single earthquake in isolation."""

    hazard_type: HazardType
    relationship_type: RelationshipType | None = None
    distance_km: confloat(ge=0)
    hours_apart: confloat(ge=0)
    magnitude: float | None = None
