from fastapi import APIRouter, Depends

from app.core.security import verify_internal_token
from app.ml.resource_optimization.estimator import (
    estimate_ambulance_requirement,
    estimate_evacuation_shelters,
    estimate_hospital_requirement,
    estimate_logistics_aid_tons,
    estimate_vehicle_requirement,
    estimate_volunteer_requirement,
)
from app.schemas.resource import OptimizeResourcesRequest, OptimizeResourcesResponse

router = APIRouter(tags=["resource"], dependencies=[Depends(verify_internal_token)])


@router.post("/optimize-resources", response_model=OptimizeResourcesResponse)
async def optimize_resources_endpoint(
    payload: OptimizeResourcesRequest,
) -> OptimizeResourcesResponse:
    hospital = estimate_hospital_requirement(
        payload.estimated_affected_population,
        payload.exposure_level,
        payload.nearby_hospitals,
    )
    ambulance = estimate_ambulance_requirement(
        payload.estimated_affected_population,
        payload.exposure_level,
        len(payload.nearby_hospitals),
    )
    vehicles = estimate_vehicle_requirement(
        payload.estimated_affected_population, payload.exposure_level
    )
    volunteers = estimate_volunteer_requirement(
        payload.estimated_affected_population, payload.exposure_level
    )
    evacuation_shelters = estimate_evacuation_shelters(
        payload.estimated_affected_population, payload.exposure_level
    )
    logistics_aid_tons = estimate_logistics_aid_tons(
        payload.estimated_affected_population, payload.exposure_level
    )

    return OptimizeResourcesResponse(
        hospital=hospital,
        ambulance=ambulance,
        vehicles=vehicles,
        volunteers=volunteers,
        evacuation_shelters=evacuation_shelters,
        logistics_aid_tons=logistics_aid_tons,
    )
