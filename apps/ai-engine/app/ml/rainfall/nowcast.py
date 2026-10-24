"""Stage-1 baseline rain nowcasts (`rain-nowcast-baselines-v0.1`).

Three deliberately simple, comparable methods, all answering "will it rain
≥ threshold at this point h hours from now?":

- `persistence` — Eulerian persistence: the field stays where it is.
- `motion_advection` — Lagrangian persistence: the field moves with the
  locally tracked motion (motion.py) and keeps its intensity.
- `steering_wind_advection` — the field moves with the 700 hPa wind at the
  point. This is the "wind direction = rain direction" assumption, kept as
  a method so the backtest can measure it instead of assuming it.

Each looks back along its displacement (semi-Lagrangian: the rain reaching
the point at t+h was at point − v·h at t) and reports the neighbourhood
exceedance fraction there (Theis et al. 2005; Roberts & Lean 2008): the
share of valid cells within a radius that are ≥ threshold. The radius grows
with lead time to express displacement uncertainty. The fraction is an
UNCALIBRATED probability — the backtest's Brier score / reliability is what
tells whether it can be read as one.
"""

import math
from dataclasses import dataclass

import numpy as np

from app.ml.rainfall.grid import GridGeometry, offset_km_to_degrees
from app.ml.rainfall.motion import MotionEstimate

MODEL_VERSION = "rain-nowcast-baselines-v0.1"

METHODS = ("persistence", "motion_advection", "steering_wind_advection")

# ~1.5 GSMaP cells: the point's own cell plus the offset between a district's
# GeoNames reference point and where its rain actually falls.
DEFAULT_BASE_RADIUS_KM = 15.0
# Displacement uncertainty growth: ~20-30 % of typical 30-50 km/h system
# speeds. A starting value to be tuned by the backtest, not a fitted one.
DEFAULT_RADIUS_GROWTH_KM_PER_HOUR = 10.0
# Fewer valid cells than this in a neighbourhood → no forecast.
MIN_VALID_FRACTION = 0.5


@dataclass(frozen=True)
class PointForecast:
    method: str
    horizon_hours: int
    status: str  # ok | insufficient_data
    probability: float | None = None
    expected_mm_per_hour: float | None = None
    source_lat: float | None = None
    source_lon: float | None = None
    radius_km: float = 0.0
    reason: str | None = None


def neighbourhood(
    field: np.ndarray, geometry: GridGeometry, lat: float, lon: float, radius_km: float
) -> np.ndarray | None:
    """Values of cells whose centres lie within `radius_km` of the point;
    None if any part of the disc falls outside the grid."""
    cell = geometry.cell_of(lat, lon)
    if cell is None:
        return None
    cell_east_km, cell_north_km = geometry.cell_size_km(lat)
    reach_x = math.ceil(radius_km / cell_east_km)
    reach_y = math.ceil(radius_km / cell_north_km)
    line, column = cell
    if line - reach_y < 0 or column - reach_x < 0 or line + reach_y >= geometry.ny or column + reach_x >= geometry.nx:
        return None
    centre_lat, centre_lon = geometry.centre_of(line, column)
    ys = np.arange(-reach_y, reach_y + 1)
    xs = np.arange(-reach_x, reach_x + 1)
    # Distances from the exact point (not the cell centre) to each centre.
    dy_km = (ys * -geometry.resolution_deg + (centre_lat - lat)) * (cell_north_km / geometry.resolution_deg)
    dx_km = (xs * geometry.resolution_deg + (centre_lon - lon)) * (cell_east_km / geometry.resolution_deg)
    inside = dy_km[:, None] ** 2 + dx_km[None, :] ** 2 <= radius_km**2
    if not inside.any():
        inside[reach_y, reach_x] = True
    block = field[line - reach_y : line + reach_y + 1, column - reach_x : column + reach_x + 1]
    return block[inside]


def forecast_at(
    field: np.ndarray,
    geometry: GridGeometry,
    method: str,
    lat: float,
    lon: float,
    horizon_hours: int,
    velocity_kmh: tuple[float, float] | None,
    threshold_mm: float,
    base_radius_km: float = DEFAULT_BASE_RADIUS_KM,
    radius_growth_km_per_hour: float = DEFAULT_RADIUS_GROWTH_KM_PER_HOUR,
) -> PointForecast:
    radius = base_radius_km + radius_growth_km_per_hour * horizon_hours
    if velocity_kmh is None:
        return PointForecast(method, horizon_hours, "insufficient_data", radius_km=radius, reason="no velocity")
    east, north = velocity_kmh
    dlat, dlon = offset_km_to_degrees(lat, -east * horizon_hours, -north * horizon_hours)
    source_lat, source_lon = lat + dlat, lon + dlon
    values = neighbourhood(field, geometry, source_lat, source_lon, radius)
    if values is None:
        return PointForecast(
            method, horizon_hours, "insufficient_data", source_lat=source_lat, source_lon=source_lon,
            radius_km=radius, reason="source outside grid",
        )
    valid = values[np.isfinite(values)]
    if valid.size < MIN_VALID_FRACTION * values.size:
        return PointForecast(
            method, horizon_hours, "insufficient_data", source_lat=source_lat, source_lon=source_lon,
            radius_km=radius, reason="too many missing cells",
        )
    return PointForecast(
        method=method,
        horizon_hours=horizon_hours,
        status="ok",
        probability=float(np.mean(valid >= threshold_mm)),
        expected_mm_per_hour=float(np.mean(valid)),
        source_lat=source_lat,
        source_lon=source_lon,
        radius_km=radius,
    )


def velocity_for(
    method: str, motion: MotionEstimate | None, steering_kmh: tuple[float, float] | None
) -> tuple[float, float] | None:
    if method == "persistence":
        return (0.0, 0.0)
    if method == "motion_advection":
        if motion is None:
            return None
        if motion.status == "no_rain_to_track":
            # Nothing nearby to move: the field around the point is
            # (near-)dry, so advection reduces to persistence.
            return (0.0, 0.0)
        if motion.status != "ok":
            return None
        return (motion.east_kmh, motion.north_kmh)
    return steering_kmh


def wind_to_motion_kmh(speed_kmh: float, from_deg: float) -> tuple[float, float]:
    """(east, north) velocity of air blowing FROM `from_deg`."""
    rad = math.radians(from_deg)
    return (-speed_kmh * math.sin(rad), -speed_kmh * math.cos(rad))
