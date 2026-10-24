"""Schemas for `POST /predict-rain-nowcast` (app/ml/rainfall/)."""

from datetime import datetime
from typing import Literal

from pydantic import Field, conint, confloat, model_validator

from app.schemas.base import CamelModel
from app.schemas.rainfall_spatial import SpatialModelSpec

NowcastMethod = Literal["persistence", "motion_advection", "steering_wind_advection", "spatial_logistic"]


class GridSpec(CamelModel):
    """Cell-centre geometry of every frame in the request."""

    west_lon: confloat(ge=-180, le=360)
    north_lat: confloat(ge=-90, le=90)
    resolution_deg: confloat(gt=0, le=1)
    nx: conint(ge=1, le=4000)
    ny: conint(ge=1, le=2000)


class RainFrame(CamelModel):
    """One hourly rain grid: base64 of little-endian float32, row-major from
    the northernmost row, mm/h, NaN or negative = missing."""

    valid_time: datetime
    data_b64: str


class SteeringWind(CamelModel):
    level: str = "700hPa"
    speed_kmh: confloat(ge=0, le=400)
    from_deg: confloat(ge=0, le=360)
    valid_time: datetime


class NowcastPoint(CamelModel):
    id: str
    latitude: confloat(ge=-90, le=90)
    longitude: confloat(ge=-180, le=360)
    steering_wind: SteeringWind | None = None


class NowcastParameters(CamelModel):
    threshold_mm_per_hour: confloat(gt=0, le=100) = 1.0
    half_window_cells: conint(ge=3, le=60) = 15
    max_shift_cells: conint(ge=1, le=20) = 6
    base_radius_km: confloat(gt=0, le=200) = 15.0
    radius_growth_km_per_hour: confloat(ge=0, le=100) = 10.0


class RainNowcastRequest(CamelModel):
    issued_at: datetime
    grid: GridSpec
    current: RainFrame
    # Without a previous frame, motion can't be tracked: only persistence
    # and steering-wind methods run.
    previous: RainFrame | None = None
    points: list[NowcastPoint] = Field(min_length=1, max_length=2000)
    horizons_hours: list[conint(ge=1, le=6)] = Field(default=[1, 2, 3], min_length=1, max_length=6)
    parameters: NowcastParameters = NowcastParameters()
    # Stage-2 model promoted by its gate (train-rain-nowcast-spatial); adds
    # `spatial_logistic` forecasts for its promoted horizons only.
    spatial_model: SpatialModelSpec | None = None

    @model_validator(mode="after")
    def _check_times(self) -> "RainNowcastRequest":
        if len(set(self.horizons_hours)) != len(self.horizons_hours):
            raise ValueError("horizonsHours must be unique")
        if self.current.valid_time > self.issued_at:
            raise ValueError("current.validTime is after issuedAt")
        if self.previous is not None:
            gap_h = (self.current.valid_time - self.previous.valid_time).total_seconds() / 3600
            if not 0.5 <= gap_h <= 3:
                raise ValueError("previous frame must be 0.5-3 h before the current frame")
        return self


class MovementOut(CamelModel):
    status: Literal["ok", "no_rain_to_track", "unchanged_field", "insufficient_data", "no_previous_frame"]
    toward_deg: float | None = None
    speed_kmh: float | None = None
    east_kmh: float | None = None
    north_kmh: float | None = None
    correlation: float | None = None
    zero_shift_correlation: float | None = None
    rain_cells_tracked: int = 0
    # Share of rainy cells bit-identical to the previous frame (GSMaP_NOW
    # carry-over); >= 0.5 → status unchanged_field.
    unchanged_fraction: float | None = None
    # Qualitative input-quality label, NOT a probability (same posture as
    # the karhutla engines): no skill has been demonstrated yet.
    confidence: Literal["low", "very_low"]


class ForecastOut(CamelModel):
    method: NowcastMethod
    horizon_hours: int
    status: Literal["ok", "insufficient_data"]
    probability: float | None = None
    expected_mm_per_hour: float | None = None
    source_latitude: float | None = None
    source_longitude: float | None = None
    # None for spatial_logistic (it combines several neighbourhoods).
    neighbourhood_radius_km: float | None = None
    reason: str | None = None


class NeighbourhoodOut(CamelModel):
    """Share of valid cells >= threshold within each radius ("50", "100" km)
    of the point at the current time; None where the disc leaves the grid
    or is mostly missing."""

    rain_fraction_by_radius_km: dict[str, float | None] = {}


class PointNowcastOut(CamelModel):
    id: str
    current_mm_per_hour: float | None
    movement: MovementOut
    neighbourhood: NeighbourhoodOut = NeighbourhoodOut()
    forecasts: list[ForecastOut]
    # Stage-2 features per horizon ("1", "2", …), in `spatialFeatureNames`
    # order; None where the point lacks its own rain or neighbourhood.
    spatial_features: dict[str, list[float] | None] = {}


class RainNowcastResponse(CamelModel):
    model_versions: dict[str, str]
    issued_at: datetime
    data_valid_time: datetime
    threshold_mm_per_hour: float
    calibrated: bool = False
    grid_missing_fraction: float
    spatial_feature_names: list[str] = []
    # Why a supplied spatial model was not applied, if it wasn't.
    spatial_model_note: str | None = None
    points: list[PointNowcastOut]
