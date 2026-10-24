"""Shared scoring helpers for every `hazard_prediction/*.py` heuristic module,
factored out of AI-ORION's `impact_model.py` (which inlined `_clamp` and its
own damage-level thresholds since it only ever had one hazard to serve).

Every heuristic here follows the same v0-baseline convention AI-ORION
established: a documented, transparent weighted formula rather than a trained
model, because no labeled outcome dataset exists yet for any hazard type in
AETHER either. Each is written to be swapped behind the same `predict_risk()`
interface once real training data accumulates, without changing callers."""

from app.schemas.common import ExposureLevel


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def exposure_level_from_score(score: float) -> ExposureLevel:
    """Maps a 0-100 `risk_score` to the `exposure_level` enum persisted in
    `risk_assessments` (docs/DATABASE_SCHEMA.md §17). Same four-bucket
    thresholding style as AI-ORION's `_damage_level_from_score`, renamed
    minor/moderate/severe/catastrophic -> low/moderate/high/severe to match
    AETHER's schema."""
    if score < 25:
        return "low"
    if score < 50:
        return "moderate"
    if score < 75:
        return "high"
    return "severe"


def estimate_affected_population(total_population: int, affected_fraction: float) -> int:
    """`total_population` is a kabupaten/kota (regency/city)-level figure —
    apps/api's `population_statistics` has exactly one row per district per
    year, sourced from Kemendagri (see docs/DATABASE_SCHEMA.md §6), with no
    kecamatan/kelurahan breakdown available anywhere in AETHER today.

    `affected_fraction` (0-1) is each hazard module's own heuristic estimate
    of what share of that kabupaten/kota's population this specific event
    plausibly affects, from `risk_score` and event proximity — an explicit,
    documented v0 formula, NOT a calibrated/validated model and NOT a
    measurement of population actually inside the hazard's physical extent
    (no watershed/burn-scar/shake-intensity polygon exists to measure that
    against). The result is scoped estimation off a real kabupaten/kota
    total, never an even/area-proportional split of it, and every caller
    must keep treating it as a per-event *estimate* distinct from
    `total_population` — never as a finer-resolution population figure.
    """
    return round(total_population * clamp(affected_fraction))
