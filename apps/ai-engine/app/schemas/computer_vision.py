"""Schemas for `POST /detect-cv` — the Computer Vision Engine. No documented
contract existed beyond the `cv_detections` table shape
(docs/DATABASE_SCHEMA.md §22: `detection_type`, `source_image_ref`,
`bounding_boxes` JSONB, `confidence_score`) and the enum
`cv_detection_type = flood | smoke | fire | infra_damage` — this module
defines the actual request/response wire format.

Design choices, both driven by keeping this service stateless (no DB, no
storage client — same posture as every other `app/` module here):
- The request carries the image as base64 bytes directly (`image_base64`),
  not a storage key. `apps/api` owns the `storage/` (S3/MinIO) module and the
  `source_image_ref` it produces; this service never touches storage.
- `bounding_boxes` are fractional (0-1) `xMin`/`yMin`/`xMax`/`yMax`,
  independent of whatever resolution the caller's image happens to be —
  callers scale to pixel coordinates against whatever copy they render."""

from pydantic import confloat

from app.schemas.base import CamelModel
from app.schemas.common import CvDetectionType


class BoundingBox(CamelModel):
    x_min: confloat(ge=0, le=1)
    y_min: confloat(ge=0, le=1)
    x_max: confloat(ge=0, le=1)
    y_max: confloat(ge=0, le=1)


class CvDetectionResult(CamelModel):
    detection_type: CvDetectionType
    bounding_boxes: list[BoundingBox]
    confidence_score: confloat(ge=0, le=1)


class DetectCvRequest(CamelModel):
    image_base64: str
    # Defaults to running every detector; callers narrow this when they
    # already know what they're looking for (e.g. a field reporter photo
    # tagged "wildfire" only needs the fire/smoke detectors run).
    categories: list[CvDetectionType] | None = None


class DetectCvResponse(CamelModel):
    detections: list[CvDetectionResult]
    model_version: str
