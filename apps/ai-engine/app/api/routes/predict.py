"""`POST /predict-risk` — the Hazard Prediction Engine's entry point.
Hazard-agnostic at the router layer (docs/API_SPEC.md "Internal API"):
`hazardType` in the payload selects which `hazard_prediction/` heuristic
module actually runs. All four hazard types (earthquake, landslide, flood,
wildfire) have real heuristics as of Phase 2 (docs/SRS.md §1 "Build
phasing")."""

from fastapi import APIRouter, Depends

from app.core.security import verify_internal_token
from app.ml.hazard_prediction import earthquake, flood, landslide, wildfire
from app.schemas.predict import PredictRiskRequest, PredictRiskResponse

router = APIRouter(tags=["predict"], dependencies=[Depends(verify_internal_token)])


@router.post("/predict-risk", response_model=PredictRiskResponse)
async def predict_risk_endpoint(payload: PredictRiskRequest) -> PredictRiskResponse:
    hazard_event = payload.hazard_event

    if hazard_event.hazard_type == "earthquake":
        return earthquake.predict_risk(
            earthquake=hazard_event.earthquake,
            district=payload.district,
            historical_disasters=payload.historical_disasters,
        )
    if hazard_event.hazard_type == "landslide":
        return landslide.predict_risk(
            landslide=hazard_event.landslide,
            district=payload.district,
            historical_disasters=payload.historical_disasters,
        )
    if hazard_event.hazard_type == "flood":
        return flood.predict_risk(
            flood=hazard_event.flood,
            district=payload.district,
            historical_disasters=payload.historical_disasters,
        )
    return wildfire.predict_risk(
        wildfire=hazard_event.wildfire,
        district=payload.district,
        historical_disasters=payload.historical_disasters,
    )
