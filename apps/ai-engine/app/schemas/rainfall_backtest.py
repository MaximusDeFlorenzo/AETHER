"""Schemas for the Milestone 7 hazard backtest (docs/RAINFALL_INTELLIGENCE.md §10):
`POST /replay-rain-hazard-rules` (daily levels from an hourly rain archive)
and `POST /evaluate-rain-hazard-backtest` (skill against reported events)."""

from datetime import date, datetime
from typing import Literal

from pydantic import Field, confloat, conint, model_validator

from app.schemas.base import CamelModel
from app.schemas.rainfall_flood import FloodRiskParameters
from app.schemas.rainfall_landslide import LandslideRiskParameters

Hazard = Literal["flood", "landslide"]
# Day level codes in every int8 matrix: -1 = no level issued that day,
# 0..3 = LOW, MEDIUM, HIGH, EXTREME.
LEVEL_NAMES = ["LOW", "MEDIUM", "HIGH", "EXTREME"]


class ReplayPointIn(CamelModel):
    id: str
    # Whole-hour offset of the point's local civil time (WIB 7, WITA 8, WIT 9).
    utc_offset_hours: conint(ge=-12, le=14)
    flood_hazard_index: confloat(ge=0, le=1) | None = None
    slope_samples_deg: list[confloat(ge=0, lt=90)] | None = Field(default=None, max_length=500)


class RainHazardReplayRequest(CamelModel):
    """Hourly rainfall per point as little-endian float32, row-major
    [points x hours], NaN = missing. Column j holds the hour ENDING at
    series_start + j h (the `valid_time` convention of every stored series)."""

    series_start: datetime
    hours: conint(ge=1, le=24 * 400)
    data_b64: str
    first_day: date
    days: conint(ge=1, le=366)
    points: list[ReplayPointIn] = Field(min_length=1, max_length=2000)
    flood_parameters: FloodRiskParameters = FloodRiskParameters()
    landslide_parameters: LandslideRiskParameters = LandslideRiskParameters()
    # A day gets a level only if at least this many of its 24 hourly
    # assessments were issued; fewer would bias the daily maximum low.
    min_hours_issued_per_day: conint(ge=1, le=24) = 20


class ReplayPointOut(CamelModel):
    id: str
    # One code per local day (see LEVEL_NAMES); *_trigger = the rain-only
    # level before the susceptibility / terrain adjustment.
    flood_level: list[int]
    flood_trigger: list[int]
    landslide_level: list[int]
    landslide_trigger: list[int]


class RainHazardReplayResponse(CamelModel):
    model_versions: dict[str, str]
    first_day: date
    days: int
    points: list[ReplayPointOut]


class BacktestHazardIn(CamelModel):
    hazard: Hazard
    # int8 [points x days], base64: day levels, rain-only levels, and
    # reported events (1 = at least one report that local day, else 0).
    levels_b64: str
    triggers_b64: str
    events_b64: str


class RainHazardBacktestRequest(CamelModel):
    issued_at: datetime
    first_day: date
    points: conint(ge=1, le=2000)
    days: conint(ge=2, le=24 * 366)
    # First day index of the test period; days before it are calibration.
    test_start_day: conint(ge=1)
    # Calibration days dropped right before the test period, so tolerance
    # matching never pairs a calibration warning with a test event.
    embargo_days: conint(ge=0, le=30) = 1
    tolerance_days: conint(ge=0, le=7) = 1
    # Level-to-rate cells needed before an empirical rate is used.
    min_cells_for_rate: conint(ge=1) = 200
    hazards: list[BacktestHazardIn] = Field(min_length=1, max_length=2)

    @model_validator(mode="after")
    def _check_split(self) -> "RainHazardBacktestRequest":
        if self.test_start_day >= self.days:
            raise ValueError("testStartDay must leave at least one test day")
        if self.test_start_day - self.embargo_days < 1:
            raise ValueError("embargo leaves no calibration days")
        return self


class Contingency(CamelModel):
    hits: int
    misses: int
    false_alarms: int
    correct_negatives: int
    pod: float | None
    far: float | None
    csi: float | None
    frequency_bias: float | None
    # P(event | warning) / P(event): how much a warning concentrates events.
    lift: float | None
    # ±tolerance_days matching (dates in event reports are uncertain).
    pod_tolerant: float | None
    far_tolerant: float | None


class ThresholdScore(CamelModel):
    threshold: str
    rule: Contingency
    rain_only: Contingency


class RateRow(CamelModel):
    level: str
    cells: int
    events: int
    rate: float | None
    ci95: list[float] | None


class ProbabilisticScore(CamelModel):
    """The rule's levels mapped to calibration-period event rates, scored on
    the test period against per-district climatology and persistence."""

    brier: float | None
    brier_climatology_district: float | None
    brier_climatology_national: float | None
    brier_persistence: float | None
    bss_vs_district_climatology: float | None
    bss_vs_national_climatology: float | None
    bss_vs_persistence: float | None
    levels_without_rate: list[str]


class SplitScore(CamelModel):
    split: Literal["calibration", "test"]
    first_day: date
    last_day: date
    evaluable_cells: int
    events: int
    base_rate: float | None
    thresholds: list[ThresholdScore]
    persistence: Contingency
    rates_by_level: list[RateRow]


class HazardBacktestOut(CamelModel):
    hazard: Hazard
    splits: list[SplitScore]
    probabilistic_test: ProbabilisticScore
    notes: list[str]


class RainHazardBacktestResponse(CamelModel):
    model_version: str
    issued_at: datetime
    first_day: date
    days: int
    tolerance_days: int
    hazards: list[HazardBacktestOut]
