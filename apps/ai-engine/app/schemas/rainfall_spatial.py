"""Schemas for the Stage-2 spatial nowcast model
(app/ml/rainfall/spatial_model.py): `POST /train-rain-nowcast-spatial` and
the optional promoted model passed back into `POST /predict-rain-nowcast`."""

from datetime import datetime
from typing import Literal

from pydantic import Field, confloat, conint, model_validator

from app.schemas.base import CamelModel

SplitName = Literal["train", "validation", "test"]
SPLIT_CODES: dict[int, SplitName] = {0: "train", 1: "validation", 2: "test"}


class SpatialGateParameters(CamelModel):
    # A model is served for a horizon only if all of these hold on the
    # chronological test split (docs/RAINFALL_INTELLIGENCE.md §7).
    min_history_days: confloat(ge=0, le=365) = 14.0
    min_test_positives: conint(ge=0) = 100
    # Brier skill the model must add over EACH baseline, on that baseline's rows.
    min_bss_gain: confloat(ge=0, le=1) = 0.01


class SpatialHistory(CamelModel):
    first_start: datetime
    last_start: datetime
    start_hours: conint(ge=0)
    # Start hours dropped next to split boundaries so training labels
    # (t + horizon) never reach into validation/test feature times.
    embargoed_start_hours: conint(ge=0) = 0
    split_boundaries: list[datetime] = Field(min_length=2, max_length=2)


class RainSpatialTrainRequest(CamelModel):
    issued_at: datetime
    threshold_mm_per_hour: confloat(gt=0, le=100)
    feature_names: list[str]
    horizons_hours: list[conint(ge=1, le=6)] = Field(min_length=1, max_length=6)
    history: SpatialHistory
    # Each row: [horizon, splitCode (0 train, 1 validation, 2 test), label
    # (0/1), weight (count of identical rows), *features]. Identical rows
    # are merged by the caller; weights keep the fit exact.
    rows: list[list[float]] = Field(max_length=2_000_000)
    gate: SpatialGateParameters = SpatialGateParameters()

    @model_validator(mode="after")
    def _check_rows(self) -> "RainSpatialTrainRequest":
        width = 4 + len(self.feature_names)
        for row in self.rows[:1000]:
            if len(row) != width:
                raise ValueError(f"every row needs {width} values")
        return self


class ReliabilityBin(CamelModel):
    lower: float
    upper: float
    mean_forecast: float
    observed_frequency: float
    weight: float


class ProbScore(CamelModel):
    rows: float  # weighted count
    positives: float
    brier: float | None
    brier_skill_score: float | None
    average_precision: float | None
    reliability: list[ReliabilityBin] = []


class BaselineComparison(CamelModel):
    baseline: str
    baseline_score: ProbScore
    # The model scored on exactly the rows where this baseline was available.
    model_score: ProbScore


class SpatialHorizonModel(CamelModel):
    horizon_hours: int
    status: Literal["fitted", "insufficient_data"]
    reason: str | None = None
    regularization_c: float | None = None
    coefficients: list[float] | None = None
    intercept: float | None = None
    climatology: float | None = None
    rows_by_split: dict[str, float] = {}
    positives_by_split: dict[str, float] = {}
    test: ProbScore | None = None
    comparisons: list[BaselineComparison] = []
    promoted: bool = False
    gate_reasons: list[str] = []


class RainSpatialTrainResponse(CamelModel):
    model_version: str
    issued_at: datetime
    feature_names: list[str]
    history_days: float
    gate: SpatialGateParameters
    horizons: list[SpatialHorizonModel]


class SpatialHorizonCoefficients(CamelModel):
    coefficients: list[float]
    intercept: float


class SpatialModelSpec(CamelModel):
    """A promoted model passed back into a live nowcast (the engine is
    stateless). Only promoted horizons are included."""

    model_version: str
    trained_at: datetime
    feature_names: list[str]
    horizons: dict[str, SpatialHorizonCoefficients]
