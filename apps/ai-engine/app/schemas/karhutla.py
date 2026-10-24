"""Schemas for `POST /predict-fire-spread` and `POST /predict-smoke-transport`.

All timestamps must be timezone-aware (`AwareDatetime`) — a naive
timestamp is ambiguous between UTC (FIRMS, Open-Meteo `timezone=GMT`) and
WIB/WITA/WIT, and silently guessing would shift a forecast by up to 9 h.
Wind speeds are km/h and directions meteorological "from" degrees; apps/api
converts provider units before calling (see app/ml/karhutla/units.py).
"""

from typing import Literal

from pydantic import AwareDatetime, Field, confloat, conint, field_validator

from app.schemas.base import CamelModel

PredictionConfidence = Literal["low", "very_low"]
HorizonStatus = Literal["ok", "insufficient_data"]


def _validate_horizons(value: list[int]) -> list[int]:
    if len(set(value)) != len(value):
        raise ValueError("horizonsHours must not contain duplicates")
    return sorted(value)


class HotspotInput(CamelModel):
    latitude: confloat(ge=-90, le=90)
    longitude: confloat(ge=-180, le=180)
    observed_at: AwareDatetime
    # FIRMS `scan`/`track`: actual pixel size in km, which grows from ~1 km
    # at nadir to ~4.8 km (MODIS) at the swath edge.
    scan_km: confloat(gt=0, le=10) | None = None
    track_km: confloat(gt=0, le=10) | None = None
    frp_mw: confloat(ge=0) | None = None
    confidence: confloat(ge=0, le=1) | None = None


class SurfaceWeatherHour(CamelModel):
    time: AwareDatetime
    wind_speed_kmh: confloat(ge=0, le=300)
    wind_from_deg: confloat(ge=0, le=360)
    temperature_c: confloat(ge=-40, le=60) | None = None
    relative_humidity_pct: confloat(ge=0, le=100) | None = None
    precipitation_mm: confloat(ge=0) | None = None


class TerrainSample(CamelModel):
    bearing_deg: confloat(ge=0, lt=360)
    elevation_m: confloat(ge=-500, le=9000)


class TerrainInput(CamelModel):
    center_elevation_m: confloat(ge=-500, le=9000)
    ring_radius_km: confloat(gt=0, le=10)
    ring: list[TerrainSample] = Field(min_length=4, max_length=36)


class FireSpreadRequest(CamelModel):
    issued_at: AwareDatetime
    horizons_hours: list[conint(ge=1, le=12)] = Field(min_length=1, max_length=6)
    hotspots: list[HotspotInput] = Field(min_length=1, max_length=2000)
    weather: list[SurfaceWeatherHour] = Field(min_length=1, max_length=96)
    terrain: TerrainInput | None = None

    _horizons = field_validator("horizons_hours")(_validate_horizons)


class SpreadFactors(CamelModel):
    estimated_fine_fuel_moisture_pct: float | None
    moisture_factor: float
    slope_deg: float | None
    slope_factor: float
    length_to_breadth: float


class SpreadHorizon(CamelModel):
    horizon_hours: int
    valid_at: AwareDatetime
    status: HorizonStatus
    hours_since_observation: float
    envelope: dict | None = None
    area_km2: float | None = None
    head_bearing_deg: float | None = None
    max_head_distance_km: float | None = None
    mean_wind_speed_kmh: float | None = None
    mean_wind_from_deg: float | None = None
    mean_head_ros_kmh: float | None = None
    factors: SpreadFactors | None = None
    notes: list[str] = []


class FireSpreadResponse(CamelModel):
    model_version: str
    method: str
    latest_observation_at: AwareDatetime
    observed_footprint: dict
    observed_footprint_area_km2: float
    horizons: list[SpreadHorizon]
    confidence: PredictionConfidence
    warnings: list[str]
    limitations: list[str]
    assumptions: dict[str, float | str]


class WindAtLevel(CamelModel):
    height_agl_m: confloat(ge=0, le=12000)
    wind_speed_kmh: confloat(ge=0, le=400)
    wind_from_deg: confloat(ge=0, le=360)


class AtmosphereHour(CamelModel):
    time: AwareDatetime
    boundary_layer_height_m: confloat(ge=0, le=6000) | None = None
    precipitation_mm: confloat(ge=0) | None = None
    levels: list[WindAtLevel] = Field(min_length=1, max_length=10)


class AtmospherePoint(CamelModel):
    latitude: confloat(ge=-90, le=90)
    longitude: confloat(ge=-180, le=180)
    hours: list[AtmosphereHour] = Field(min_length=1, max_length=96)


class SmokeSource(CamelModel):
    latitude: confloat(ge=-90, le=90)
    longitude: confloat(ge=-180, le=180)
    latest_observation_at: AwareDatetime
    hotspot_count: conint(ge=1)
    total_frp_mw: confloat(ge=0) | None = None
    # Rough radius of the burning area (km), for spreading particle release.
    source_radius_km: confloat(ge=0, le=50) = 1.0


class SmokeTransportRequest(CamelModel):
    issued_at: AwareDatetime
    horizons_hours: list[conint(ge=1, le=12)] = Field(min_length=1, max_length=6)
    source: SmokeSource
    atmosphere: list[AtmospherePoint] = Field(min_length=1, max_length=150)
    particles: conint(ge=100, le=5000) = 800
    seed: conint(ge=0) = 0

    _horizons = field_validator("horizons_hours")(_validate_horizons)


class SmokeFootprintClass(CamelModel):
    # "core" holds the densest cells containing 50% of airborne particles,
    # "likely" 80%, "possible" all cells with >= 2 particles. Nested.
    level: Literal["core", "likely", "possible"]
    particle_share: float
    geometry: dict | None
    area_km2: float


class SmokeHorizon(CamelModel):
    horizon_hours: int
    valid_at: AwareDatetime
    status: HorizonStatus
    particles_airborne: int
    footprint: list[SmokeFootprintClass] = []
    cell_size_km: float | None = None
    centroid: dict | None = None
    transport_bearing_deg: float | None = None
    p90_distance_km: float | None = None
    share_above_boundary_layer: float | None = None
    share_outside_wind_domain: float | None = None
    notes: list[str] = []


class SmokeTransportResponse(CamelModel):
    model_version: str
    method: str
    qualitative: bool
    horizons: list[SmokeHorizon]
    confidence: PredictionConfidence
    warnings: list[str]
    limitations: list[str]
    assumptions: dict[str, float | str]
