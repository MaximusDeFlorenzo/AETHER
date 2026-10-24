"""`POST /predict-fire-spread` and `POST /predict-smoke-transport` — the
karhutla engines (app/ml/karhutla/). Two endpoints, not one, so fire spread
and smoke transport stay independently versioned, tested and callable:
smoke must never be assumed to follow the fire front.

Both are CPU-bound numpy/pure-Python work, so they are plain `def`
handlers — FastAPI runs them in its threadpool instead of blocking the
event loop (health checks and other routes stay responsive mid-run)."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import verify_internal_token
from app.ml.karhutla.smoke import predict_smoke
from app.ml.karhutla.spread import ConflictingInputError, predict_spread
from app.schemas.karhutla import (
    FireSpreadRequest,
    FireSpreadResponse,
    SmokeTransportRequest,
    SmokeTransportResponse,
)

router = APIRouter(tags=["karhutla"], dependencies=[Depends(verify_internal_token)])


@router.post("/predict-fire-spread", response_model=FireSpreadResponse)
def predict_fire_spread_endpoint(payload: FireSpreadRequest) -> FireSpreadResponse:
    try:
        return predict_spread(payload)
    except ConflictingInputError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.post("/predict-smoke-transport", response_model=SmokeTransportResponse)
def predict_smoke_transport_endpoint(payload: SmokeTransportRequest) -> SmokeTransportResponse:
    if payload.source.latest_observation_at > payload.issued_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="source.latestObservationAt is after issuedAt",
        )
    try:
        return predict_smoke(payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
