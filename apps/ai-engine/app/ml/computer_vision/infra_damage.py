"""Infrastructure damage detection — the weakest-signal detector here by a
wide margin, explicitly documented as such (same honest-confidence-discount
convention `hazard_prediction/landslide.py` uses for seeded vs. live data).

Rubble/debris/collapsed-structure regions tend to read as locally dense,
irregular edge clutter compared to intact surfaces (walls, roads, roofs) or
regular repeating patterns (siding, tile). This flags the image's own
highest-edge-density regions via a Sobel gradient magnitude + local-density
filter — there is no color cue for "damaged" the way there is for
fire/smoke/flood, so this is a relative, within-image signal, not an
absolute one, and the result is a *candidate region for human review*, not a
confident detection.

False positives are expected on any busy, high-texture, undamaged scene
(foliage, gravel, crowds, decorative brickwork) — this heuristic cannot tell
"complex" from "damaged." `confidence_score` is capped well below the other
three detectors' ceiling to reflect that.
"""

import numpy as np
from scipy import ndimage

from app.ml.computer_vision.common import mask_to_detections
from app.schemas.computer_vision import CvDetectionResult

EDGE_DENSITY_PERCENTILE = 92.0
LOCAL_DENSITY_WINDOW_PX = 15
# Texture-based cue is far weaker evidence than a color cue — cap confidence
# well below what fire/smoke/flood's color masks can reach.
CONFIDENCE_CEILING = 0.5
# If the whole image is nearly edge-free (a flat wall, clear sky, blank
# pavement), there's no meaningful "busiest region" to flag at all.
MIN_ABSOLUTE_DENSITY = 5.0


def detect(image: np.ndarray) -> list[CvDetectionResult]:
    grayscale = image.mean(axis=-1)
    gradient_x = ndimage.sobel(grayscale, axis=1)
    gradient_y = ndimage.sobel(grayscale, axis=0)
    edge_magnitude = np.hypot(gradient_x, gradient_y)
    density = ndimage.uniform_filter(edge_magnitude, size=LOCAL_DENSITY_WINDOW_PX)

    if density.max() < MIN_ABSOLUTE_DENSITY:
        return []

    threshold = np.percentile(density, EDGE_DENSITY_PERCENTILE)
    mask = density >= threshold
    return mask_to_detections(mask, "infra_damage", confidence_ceiling=CONFIDENCE_CEILING)


class InfraDamageDetector:
    """Adapts `detect()` to the shared `CvDetector` interface — see
    `common.py`'s `CvDetector` docstring."""

    def detect(self, image: np.ndarray) -> list[CvDetectionResult]:
        return detect(image)
