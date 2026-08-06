"""Shared helpers for every `computer_vision/*.py` detector — decode the
request's base64 image once, and turn a boolean pixel mask into
fractional-coordinate bounding boxes with a size/density-derived confidence.

v0 baseline, same documented-heuristic posture as `hazard_prediction/`: rule-
based color/texture masks over the raw pixel array (Pillow decode + numpy/
scipy connected-component labeling), not a trained detector — there is no
labeled disaster-imagery training set available yet. Each detector module is
written to be swapped behind the same `detect(image) -> list[CvDetectionResult]`
interface once one exists, without changing `app/api/routes/computer_vision.py`.
"""

import base64
import binascii
from io import BytesIO

import numpy as np
from PIL import Image, UnidentifiedImageError
from scipy import ndimage

from app.schemas.common import CvDetectionType
from app.schemas.computer_vision import BoundingBox, CvDetectionResult

# Downscale very large photos before analysis — the color/blob heuristics
# below don't benefit from full resolution, and this keeps latency bounded
# for a stateless service with no GPU.
MAX_DIMENSION_PX = 1024

# Ignore connected components smaller than this fraction of total image
# area — noise-floor filtering so a handful of stray hot pixels (a red car,
# a sunset sliver) doesn't register as a detection.
MIN_COMPONENT_AREA_FRACTION = 0.001


class InvalidImageError(ValueError):
    """Raised when `image_base64` isn't valid base64 or isn't a decodable
    image — the route layer turns this into an HTTP 422."""


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def decode_image(image_base64: str) -> np.ndarray:
    """Returns an (H, W, 3) float64 RGB array, downscaled to
    `MAX_DIMENSION_PX` on the longest side if larger."""
    try:
        raw = base64.b64decode(image_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise InvalidImageError(f"image_base64 is not valid base64: {error}") from error

    try:
        with Image.open(BytesIO(raw)) as img:
            img = img.convert("RGB")
            if max(img.size) > MAX_DIMENSION_PX:
                img.thumbnail((MAX_DIMENSION_PX, MAX_DIMENSION_PX))
            return np.asarray(img, dtype=np.float64)
    except UnidentifiedImageError as error:
        raise InvalidImageError(f"image_base64 does not decode to a supported image: {error}") from error


def mask_to_detections(
    mask: np.ndarray,
    detection_type: CvDetectionType,
    *,
    confidence_ceiling: float = 1.0,
) -> list[CvDetectionResult]:
    """Connected-component-labels a boolean mask and turns each surviving
    blob into a `CvDetectionResult` with one bounding box. `confidence_ceiling`
    lets weaker-signal detectors (e.g. infra_damage's texture heuristic)
    discount their own confidence relative to strong color-cue detectors
    (fire/smoke/flood), the same honest-provenance-discount convention
    `hazard_prediction/` uses for seeded vs. live data sources.
    """
    labeled, num_features = ndimage.label(mask)
    if num_features == 0:
        return []

    height, width = mask.shape
    image_area = height * width
    min_area = max(1, int(image_area * MIN_COMPONENT_AREA_FRACTION))

    detections: list[CvDetectionResult] = []
    for index, region_slice in enumerate(ndimage.find_objects(labeled), start=1):
        if region_slice is None:
            continue
        y_slice, x_slice = region_slice
        region_mask = labeled[region_slice] == index
        area = int(region_mask.sum())
        if area < min_area:
            continue

        bbox_area = region_mask.size
        fill_ratio = area / bbox_area if bbox_area else 0.0
        size_factor = clamp(area / (image_area * 0.05))
        confidence = clamp(0.4 + 0.35 * fill_ratio + 0.25 * size_factor) * confidence_ceiling

        detections.append(
            CvDetectionResult(
                detection_type=detection_type,
                bounding_boxes=[
                    BoundingBox(
                        x_min=x_slice.start / width,
                        y_min=y_slice.start / height,
                        x_max=x_slice.stop / width,
                        y_max=y_slice.stop / height,
                    )
                ],
                confidence_score=round(confidence, 3),
            )
        )

    # Strongest detections first, capped so a noisy mask can't return dozens
    # of low-value boxes.
    detections.sort(key=lambda d: d.confidence_score, reverse=True)
    return detections[:10]
