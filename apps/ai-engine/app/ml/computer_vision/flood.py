"""Standing-water/flood detection — two RGB color masks OR'd together,
covering the two colors floodwater commonly presents as in field photos:

- turbid/muddy water: brownish, desaturated, moderate brightness (the
  dominant color of floodwater carrying sediment — most flood photos in
  populated/agricultural areas show this, not clear blue water),
- clear/reflective water: blue-dominant (sky-reflecting standing water,
  common in aerial/drone imagery and less-turbid flooding).

False positives are expected on brown soil/dirt roads (muddy-water mask) and
blue-toned surfaces like tarps or painted roofs (blue-water mask) — this is a
color-cue heuristic, not surface-type recognition.
"""

import numpy as np

from app.ml.computer_vision.common import mask_to_detections
from app.schemas.computer_vision import CvDetectionResult


def detect(image: np.ndarray) -> list[CvDetectionResult]:
    r, g, b = image[..., 0], image[..., 1], image[..., 2]

    muddy_water_mask = (
        (r >= 80) & (r <= 180) & (g >= 60) & (g <= 150) & (b <= 120) & (r > b)
    )
    blue_water_mask = (b >= 100) & (b > r) & (b > g)

    mask = muddy_water_mask | blue_water_mask
    return mask_to_detections(mask, "flood")
