"""Smoke detection — a low-saturation, mid-brightness gray-plume color mask.
Smoke (unlike sky, foliage, or most man-made surfaces at typical field-report
distances) is close to achromatic: its RGB channels sit near each other in
value, distinguishing it from strongly colored sky/vegetation/structures at
the brightness range smoke actually occupies (too dark for cloud-white, too
light for shadow-black).

False positives are expected on overcast sky, concrete, and fog — this is a
color-cue heuristic, not texture/motion-based plume recognition.
"""

import numpy as np

from app.ml.computer_vision.common import mask_to_detections
from app.schemas.computer_vision import CvDetectionResult

SATURATION_MAX = 0.15
BRIGHTNESS_MIN = 80.0
BRIGHTNESS_MAX = 220.0


def detect(image: np.ndarray) -> list[CvDetectionResult]:
    channel_max = image.max(axis=-1)
    channel_min = image.min(axis=-1)
    brightness = image.mean(axis=-1)
    saturation = np.divide(
        channel_max - channel_min,
        channel_max,
        out=np.zeros_like(channel_max),
        where=channel_max > 0,
    )

    mask = (
        (saturation <= SATURATION_MAX)
        & (brightness >= BRIGHTNESS_MIN)
        & (brightness <= BRIGHTNESS_MAX)
    )
    return mask_to_detections(mask, "smoke")


class SmokeDetector:
    """Adapts `detect()` to the shared `CvDetector` interface — see
    `common.py`'s `CvDetector` docstring."""

    def detect(self, image: np.ndarray) -> list[CvDetectionResult]:
        return detect(image)
