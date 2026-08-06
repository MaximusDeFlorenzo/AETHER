"""`POST /detect-relationships` — the Spatial Intelligence Engine's cascading
check. No ORION equivalent; backs `hazard_relationships`
(docs/DATABASE_SCHEMA.md §16) and docs/SRS.md FR-3.2."""

from fastapi import APIRouter, Depends

from app.core.security import verify_internal_token
from app.ml.spatial_intelligence.relationship_detector import detect_relationship
from app.schemas.relationships import (
    DetectRelationshipsRequest,
    DetectRelationshipsResponse,
    RelationshipResult,
)

router = APIRouter(tags=["relationships"], dependencies=[Depends(verify_internal_token)])


@router.post("/detect-relationships", response_model=DetectRelationshipsResponse)
async def detect_relationships_endpoint(
    payload: DetectRelationshipsRequest,
) -> DetectRelationshipsResponse:
    results = [
        RelationshipResult(
            candidate_index=index,
            relationship_type=relationship_type,
            confidence_score=confidence_score,
            rationale=rationale,
        )
        for index, candidate in enumerate(payload.candidate_events)
        for relationship_type, confidence_score, rationale in [
            detect_relationship(payload.source_event, candidate)
        ]
    ]
    return DetectRelationshipsResponse(relationships=results)
