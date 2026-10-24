"""Local rain-field motion by block matching (`rain-motion-blockmatch-v0.1`).

Stage-1 baseline (docs/RAINFALL_INTELLIGENCE.md): the classic
cross-correlation tracking used by radar nowcasting (TREC — Rinehart &
Garvey 1978), applied to two consecutive hourly satellite rain grids. For a
window around each point, every integer shift within ±`max_shift` cells is
tried and the one whose shifted previous field best correlates with the
current field is the motion.

Matching uses log1p(rain) so a single intense cell doesn't dominate the
correlation. Only cells finite in BOTH frames count. A window with too
little rain has nothing to track: that is reported as such, never as
"no motion".

Unchanged fields: GSMaP_NOW sometimes carries a region's values over to
the next hour bit-for-bit (observed 2026-10-06: ~9-13 % of rainy cells per
hour, light rain, spatially clustered, mostly 90-110°E). A window where
most rain is unchanged has no new information to track and would look like
"zero motion" with r ≈ 1 — it is reported as `unchanged_field` instead.

Limits, stated rather than hidden: integer-cell shifts (0.1° ≈ 11 km per
hour step → ~11 km/h speed resolution); one vector per window (no rotation,
growth or decay); GSMaP_NOW's own last half-hour is extrapolated with cloud
motion vectors, so successive frames are not fully independent.
"""

import math
from dataclasses import dataclass

import numpy as np

from app.ml.rainfall.grid import GridGeometry

MODEL_VERSION = "rain-motion-blockmatch-v0.1"

DEFAULT_HALF_WINDOW_CELLS = 15  # 31 × 31 cells ≈ 340 km square at 0.1°
DEFAULT_MAX_SHIFT_CELLS = 6  # ≈ 66 km/h at the equator for a 1 h step
DEFAULT_RAIN_THRESHOLD_MM = 0.1  # "raining" for tracking purposes
DEFAULT_MIN_RAIN_CELLS = 20  # ≈ 2,400 km² of rain in the window
# Finite cells required among the overlapping pairs for a shift to count.
MIN_VALID_FRACTION = 0.6
# Share of the window's rainy cells bit-identical to the next frame above
# which the field is treated as not updated (see module docstring).
MAX_UNCHANGED_FRACTION = 0.5


@dataclass(frozen=True)
class MotionEstimate:
    status: str  # ok | no_rain_to_track | unchanged_field | insufficient_data
    east_kmh: float | None = None
    north_kmh: float | None = None
    shift_cells: tuple[int, int] | None = None  # (columns east, lines south)
    correlation: float | None = None
    zero_shift_correlation: float | None = None
    rain_cells: int = 0
    unchanged_fraction: float | None = None

    @property
    def speed_kmh(self) -> float | None:
        if self.east_kmh is None or self.north_kmh is None:
            return None
        return math.hypot(self.east_kmh, self.north_kmh)

    @property
    def toward_deg(self) -> float | None:
        """Direction the rain moves TOWARD, degrees clockwise from north;
        None when stationary."""
        if self.east_kmh is None or self.north_kmh is None or self.speed_kmh < 1e-9:
            return None
        return math.degrees(math.atan2(self.east_kmh, self.north_kmh)) % 360


def _correlation(a: np.ndarray, b: np.ndarray) -> float | None:
    mask = np.isfinite(a) & np.isfinite(b)
    if mask.sum() < MIN_VALID_FRACTION * a.size:
        return None
    x, y = a[mask], b[mask]
    sx, sy = x.std(), y.std()
    if sx < 1e-9 or sy < 1e-9:
        return None
    return float(((x - x.mean()) * (y - y.mean())).mean() / (sx * sy))


def estimate_local_motion(
    previous: np.ndarray,
    current: np.ndarray,
    geometry: GridGeometry,
    lat: float,
    lon: float,
    hours_between: float,
    half_window: int = DEFAULT_HALF_WINDOW_CELLS,
    max_shift: int = DEFAULT_MAX_SHIFT_CELLS,
    rain_threshold: float = DEFAULT_RAIN_THRESHOLD_MM,
    min_rain_cells: int = DEFAULT_MIN_RAIN_CELLS,
) -> MotionEstimate:
    cell = geometry.cell_of(lat, lon)
    margin = half_window + max_shift
    if (
        cell is None
        or cell[0] - margin < 0
        or cell[1] - margin < 0
        or cell[0] + margin >= geometry.ny
        or cell[1] + margin >= geometry.nx
    ):
        return MotionEstimate(status="insufficient_data")
    line, column = cell
    window = np.s_[line - half_window : line + half_window + 1, column - half_window : column + half_window + 1]
    prev_window = previous[window]
    rain_cells = int(np.sum(np.nan_to_num(prev_window, nan=0.0) >= rain_threshold))
    if rain_cells < min_rain_cells:
        return MotionEstimate(status="no_rain_to_track", rain_cells=rain_cells)

    rainy = np.nan_to_num(prev_window, nan=0.0) >= rain_threshold
    unchanged = rainy & (prev_window == current[window])
    unchanged_fraction = float(unchanged.sum() / rainy.sum())
    if unchanged_fraction >= MAX_UNCHANGED_FRACTION:
        return MotionEstimate(
            status="unchanged_field", rain_cells=rain_cells, unchanged_fraction=unchanged_fraction
        )

    prev_log = np.log1p(prev_window)
    # log1p once over the whole search region, not once per shift.
    region_log = np.log1p(
        current[line - margin : line + margin + 1, column - margin : column + margin + 1]
    )
    size = 2 * half_window + 1
    best: tuple[float, int, int] | None = None
    zero_shift: float | None = None
    for dy in range(-max_shift, max_shift + 1):
        for dx in range(-max_shift, max_shift + 1):
            # Rain at previous (j, i) is assumed to sit at (j + dy, i + dx) now.
            top, left = max_shift + dy, max_shift + dx
            shifted_log = region_log[top : top + size, left : left + size]
            corr = _correlation(prev_log, shifted_log)
            if corr is None:
                continue
            if dx == 0 and dy == 0:
                zero_shift = corr
            # Ties go to the smaller displacement (iteration order is not).
            if (
                best is None
                or corr > best[0] + 1e-12
                or (abs(corr - best[0]) <= 1e-12 and dx * dx + dy * dy < best[1] ** 2 + best[2] ** 2)
            ):
                best = (corr, dx, dy)
    if best is None:
        return MotionEstimate(status="insufficient_data", rain_cells=rain_cells, unchanged_fraction=unchanged_fraction)

    corr, dx, dy = best
    cell_east_km, cell_north_km = geometry.cell_size_km(lat)
    return MotionEstimate(
        status="ok",
        east_kmh=dx * cell_east_km / hours_between,
        north_kmh=-dy * cell_north_km / hours_between,
        shift_cells=(dx, dy),
        correlation=corr,
        zero_shift_correlation=zero_shift,
        rain_cells=rain_cells,
        unchanged_fraction=unchanged_fraction,
    )
