"""Karhutla (kebakaran hutan dan lahan) spread + smoke-transport engines.

Two deliberately separate pipelines that share only unit/geometry helpers:

- `spread.py` — a potential fire-spread *envelope* around FIRMS hotspot
  pixels (elliptical Huygens growth driven by forecast wind, fuel-moisture
  and slope adjustments). Not FARSITE: no Indonesian fuel-model, canopy or
  fuel-moisture grids exist to drive one (see docs/KARHUTLA_PREDICTION.md).
- `smoke.py` — a seeded Lagrangian particle-trajectory ensemble through a
  gridded, multi-level forecast wind field. Not HYSPLIT, and it outputs a
  qualitative transport footprint (relative particle density), never
  PM2.5 concentrations.

Neither is calibrated or validated against observed Indonesian fire
progression or smoke. Every response says so (`limitations`), and the
`confidence` field is a qualitative input-quality label, never a
probability.
"""
