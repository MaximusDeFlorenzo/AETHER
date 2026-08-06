"""Fire detection — an RGB rule-based hot-pixel color mask, the same family
of technique as Celik & Demirel's widely-cited YCbCr fire-color-model
approach, simplified to plain RGB thresholds for a dependency-free v0:

- red channel dominant and above an absolute brightness floor (flame color
  runs from deep orange through white-hot, always red-heavy),
- green moderately high but below red (distinguishes orange/yellow flame
  from pure red objects — a red car has G close to 0, a flame doesn't),
- blue low relative to red (flame has little blue component; this is what
  separates it from e.g. red-lit skin tones or pink surfaces).

False positives are expected on sunsets, red/orange fabric, and warm
artificial lighting — this is a color-cue heuristic, not object recognition.
"""

import numpy as np

from app.ml.computer_vision.common import mask_to_detections
from app.schemas.computer_vision import CvDetectionResult

RED_MIN = 180.0
GREEN_MIN = 60.0
GREEN_MAX = 200.0
RED_GREEN_MARGIN = 0.0
RED_BLUE_MARGIN = 40.0


def detect(image: np.ndarray) -> list[CvDetectionResult]:
    r, g, b = image[..., 0], image[..., 1], image[..., 2]
    mask = (
        (r >= RED_MIN)
        & (g >= GREEN_MIN)
        & (g <= GREEN_MAX)
        & (r - g >= RED_GREEN_MARGIN)
        & (r - b >= RED_BLUE_MARGIN)
    )
    return mask_to_detections(mask, "fire")
