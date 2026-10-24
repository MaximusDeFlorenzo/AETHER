"""`POST /predict-rain-nowcast` — rain-field motion + Stage-1 baseline
nowcasts, `POST /train-rain-nowcast-spatial` — the gated Stage-2 spatial
model — and `POST /predict-rain-flood-risk` / `-landslide-risk` — the
Stage-1 flood and landslide decision tables, and `POST
/replay-rain-hazard-rules` / `/evaluate-rain-hazard-backtest` — their
historical backtest (app/ml/rainfall/). CPU-bound
numpy, so a plain `def` handler (FastAPI runs it in its threadpool), same as
the karhutla routes."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import verify_internal_token
from app.ml.rainfall.engine import run_nowcast
from app.ml.rainfall.flood_risk import run_flood_risk
from app.ml.rainfall.hazard_backtest import evaluate as evaluate_hazard_backtest
from app.ml.rainfall.hazard_backtest import replay as replay_hazard_rules
from app.ml.rainfall.landslide_risk import run_landslide_risk
from app.ml.rainfall.spatial_model import train as train_spatial_model
from app.schemas.rainfall import RainNowcastRequest, RainNowcastResponse
from app.schemas.rainfall_backtest import (
    RainHazardBacktestRequest,
    RainHazardBacktestResponse,
    RainHazardReplayRequest,
    RainHazardReplayResponse,
)
from app.schemas.rainfall_flood import RainFloodRiskRequest, RainFloodRiskResponse
from app.schemas.rainfall_landslide import RainLandslideRiskRequest, RainLandslideRiskResponse
from app.schemas.rainfall_spatial import RainSpatialTrainRequest, RainSpatialTrainResponse

router = APIRouter(tags=["rainfall"], dependencies=[Depends(verify_internal_token)])


@router.post("/predict-rain-nowcast", response_model=RainNowcastResponse)
def predict_rain_nowcast_endpoint(payload: RainNowcastRequest) -> RainNowcastResponse:
    try:
        return run_nowcast(payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.post("/predict-rain-flood-risk", response_model=RainFloodRiskResponse)
def predict_rain_flood_risk_endpoint(payload: RainFloodRiskRequest) -> RainFloodRiskResponse:
    return run_flood_risk(payload)


@router.post("/predict-rain-landslide-risk", response_model=RainLandslideRiskResponse)
def predict_rain_landslide_risk_endpoint(payload: RainLandslideRiskRequest) -> RainLandslideRiskResponse:
    return run_landslide_risk(payload)


@router.post("/train-rain-nowcast-spatial", response_model=RainSpatialTrainResponse)
def train_rain_nowcast_spatial_endpoint(payload: RainSpatialTrainRequest) -> RainSpatialTrainResponse:
    try:
        return train_spatial_model(payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.post("/replay-rain-hazard-rules", response_model=RainHazardReplayResponse)
def replay_rain_hazard_rules_endpoint(payload: RainHazardReplayRequest) -> RainHazardReplayResponse:
    try:
        return replay_hazard_rules(payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.post("/evaluate-rain-hazard-backtest", response_model=RainHazardBacktestResponse)
def evaluate_rain_hazard_backtest_endpoint(payload: RainHazardBacktestRequest) -> RainHazardBacktestResponse:
    try:
        return evaluate_hazard_backtest(payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
