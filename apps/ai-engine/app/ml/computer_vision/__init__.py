"""Registry of `CvDetector`-conforming instances, keyed by
`cv_detection_type` (docs/DATABASE_SCHEMA.md §22) — what
`app/api/routes/computer_vision.py` dispatches against. Adding a fifth
detector, or swapping any of these four heuristics for a trained model,
means changing only this dict; the route never changes (see `CvDetector`'s
docstring in `common.py`).
"""

from app.ml.computer_vision.common import CvDetector
from app.ml.computer_vision.fire import FireDetector
from app.ml.computer_vision.flood import FloodDetector
from app.ml.computer_vision.infra_damage import InfraDamageDetector
from app.ml.computer_vision.smoke import SmokeDetector

DETECTORS: dict[str, CvDetector] = {
    "fire": FireDetector(),
    "smoke": SmokeDetector(),
    "flood": FloodDetector(),
    "infra_damage": InfraDamageDetector(),
}
