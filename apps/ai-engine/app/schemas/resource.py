"""Schemas for `POST /optimize-resources` — generalizes AI-ORION's
`schemas/resource.py`. `damage_level` (earthquake-only naming) is replaced by
the hazard-agnostic `exposure_level` produced by every `hazard_prediction/`
module."""

from pydantic import confloat, conint

from app.schemas.base import CamelModel
from app.schemas.common import ExposureLevel


class HospitalInput(CamelModel):
    """A real hospital resolved by `apps/api` from its `hospitals`-equivalent
    data near the district being assessed. `distance_km` is the district's
    already-computed distance from the hazard event (not recomputed here —
    same reuse-what-api-already-resolved convention as AI-ORION)."""

    code: str
    name: str
    total_beds: conint(ge=0)
    distance_km: confloat(ge=0)


class OptimizeResourcesRequest(CamelModel):
    estimated_affected_population: conint(ge=0)
    exposure_level: ExposureLevel
    nearby_hospitals: list[HospitalInput] = []


class RecommendedHospital(CamelModel):
    code: str
    name: str
    distance_km: float
    total_beds: int


class HospitalEstimate(CamelModel):
    hospitals_needed: conint(ge=0)
    recommended_hospitals: list[RecommendedHospital]
    available_capacity_beds: conint(ge=0)
    estimated_overflow_beds: conint(ge=0)


class AmbulanceEstimate(CamelModel):
    required: conint(ge=0)
    available: conint(ge=0)
    additional_needed: conint(ge=0)


class VehicleEstimate(CamelModel):
    rescue_vehicles: conint(ge=0)
    logistics_trucks: conint(ge=0)
    excavators: conint(ge=0)
    heavy_equipment: conint(ge=0)


class VolunteerEstimate(CamelModel):
    total: conint(ge=0)
    medical: conint(ge=0)
    logistics: conint(ge=0)
    sar: conint(ge=0)


class OptimizeResourcesResponse(CamelModel):
    hospital: HospitalEstimate
    ambulance: AmbulanceEstimate
    vehicles: VehicleEstimate
    volunteers: VolunteerEstimate
    evacuation_shelters: conint(ge=0)
    logistics_aid_tons: confloat(ge=0)
