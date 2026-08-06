"""Schemas for `POST /detect-relationships` — no ORION equivalent (see
docs/MIGRATION_FROM_ORION.md "Discard-from-ORION / build new"). Backs the
Spatial Intelligence Engine's cascading-hazard detection
(`hazard_relationships` table in docs/DATABASE_SCHEMA.md §16)."""

from pydantic import confloat

from app.schemas.base import CamelModel
from app.schemas.common import HazardType, RelationshipType


class HazardEventRef(CamelModel):
    """The event being checked for cascading relationships (the "source")."""

    hazard_type: HazardType
    magnitude: float | None = None  # earthquake magnitude, when applicable
    event_time: str


class CandidateRelatedEvent(CamelModel):
    """A recent, nearby event of a (usually different) hazard type that may be
    causally or spatiotemporally linked to the source event. `hours_apart` is
    always the candidate's occurrence relative to the source, signed so that a
    positive value means the candidate happened *after* the source (e.g. a
    landslide 6 hours after an earthquake) and a negative value means it
    happened before."""

    hazard_type: HazardType
    magnitude: float | None = None
    distance_km: confloat(ge=0)
    hours_apart: float
    event_time: str | None = None


class DetectRelationshipsRequest(CamelModel):
    source_event: HazardEventRef
    candidate_events: list[CandidateRelatedEvent]


class RelationshipResult(CamelModel):
    candidate_index: int
    relationship_type: RelationshipType | None
    confidence_score: confloat(ge=0, le=1)
    rationale: str


class DetectRelationshipsResponse(CamelModel):
    relationships: list[RelationshipResult]
