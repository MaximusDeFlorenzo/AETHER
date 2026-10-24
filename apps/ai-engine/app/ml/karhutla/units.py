"""Wind unit and direction conventions shared by both karhutla engines.

Direction convention everywhere in this package is meteorological: a
`*_from_deg` value is where the wind blows FROM, degrees clockwise from
true north (what BMKG's `wd_deg` and Open-Meteo's `wind_direction_*`
report). Fire and smoke move TOWARD `downwind_bearing(from_deg)`.

`u`/`v` are the usual eastward/northward components of the air's motion.
Averaging or interpolating wind must go through u/v — averaging raw
direction angles breaks across north (350° and 10° average to 180°).
"""

import math

KMH_PER_MS = 3.6
KMH_PER_KNOT = 1.852
KMH_PER_MPH = 1.609344

_TO_KMH = {
    "kmh": 1.0,
    "ms": KMH_PER_MS,
    "knots": KMH_PER_KNOT,
    "mph": KMH_PER_MPH,
}


def to_kmh(value: float, unit: str) -> float:
    """Converts a wind speed in `unit` ('kmh' | 'ms' | 'knots' | 'mph') to km/h."""
    try:
        factor = _TO_KMH[unit]
    except KeyError as error:
        raise ValueError(f"Unsupported wind speed unit: {unit!r}") from error
    if value < 0 or not math.isfinite(value):
        raise ValueError(f"Wind speed must be a finite, non-negative number (got {value})")
    return value * factor


def normalize_deg(degrees: float) -> float:
    return degrees % 360.0


def downwind_bearing(from_deg: float) -> float:
    return normalize_deg(from_deg + 180.0)


def wind_to_uv(speed: float, from_deg: float) -> tuple[float, float]:
    rad = math.radians(from_deg)
    return -speed * math.sin(rad), -speed * math.cos(rad)


def uv_to_wind(u: float, v: float) -> tuple[float, float]:
    """Returns (speed, from_deg). Calm air (speed 0) reports from_deg 0."""
    speed = math.hypot(u, v)
    if speed == 0:
        return 0.0, 0.0
    return speed, normalize_deg(math.degrees(math.atan2(-u, -v)))


def angular_difference_deg(a: float, b: float) -> float:
    """Smallest absolute angle between two bearings, 0-180."""
    diff = abs(normalize_deg(a) - normalize_deg(b)) % 360.0
    return 360.0 - diff if diff > 180.0 else diff
