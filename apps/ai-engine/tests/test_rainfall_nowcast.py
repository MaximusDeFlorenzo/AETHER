import math

import numpy as np
import pytest

from app.ml.rainfall.grid import GridGeometry, decode_grid, encode_grid, offset_km_to_degrees
from app.ml.rainfall.motion import estimate_local_motion
from app.ml.rainfall.nowcast import (
    forecast_at,
    neighbourhood,
    velocity_for,
    wind_to_motion_kmh,
)

# 0.1° grid around Java: centres 104.05..113.95 E, 0.05 S..9.95 S.
GEO = GridGeometry(west_lon=104.05, north_lat=-0.05, resolution_deg=0.1, nx=100, ny=100)
POINT = (-5.0, 109.0)  # on a cell corner → cell (line 50, column 50), edges go south/east


def blob(centre_line: float, centre_col: float, peak: float = 20.0, sigma: float = 3.0) -> np.ndarray:
    """A smooth rain cell; values below 0.05 mm/h set to 0 (dry)."""
    ys, xs = np.mgrid[0 : GEO.ny, 0 : GEO.nx]
    field = peak * np.exp(-((ys - centre_line) ** 2 + (xs - centre_col) ** 2) / (2 * sigma**2))
    field[field < 0.05] = 0.0
    return field


def test_grid_cell_lookup_and_round_trip():
    assert GEO.cell_of(-0.05, 104.05) == (0, 0)
    assert GEO.cell_of(*POINT) == (50, 50)
    assert GEO.cell_of(1.0, 109.0) is None
    field = blob(10, 10)
    field[3, 3] = np.nan
    decoded = decode_grid(encode_grid(field), GEO)
    assert np.isnan(decoded[3, 3])
    assert decoded[10, 10] == pytest.approx(20.0, rel=1e-6)


def test_decode_rejects_wrong_size_and_negative_codes_become_missing():
    with pytest.raises(ValueError, match="expected 40000"):
        decode_grid(encode_grid(np.zeros((10, 10))), GEO)
    field = np.zeros((100, 100))
    field[5, 5] = -99.0
    assert np.isnan(decode_grid(encode_grid(field), GEO)[5, 5])


@pytest.mark.parametrize("dx,dy", [(3, 0), (0, -2), (-4, 3)])
def test_block_matching_recovers_a_known_shift(dx, dy):
    previous = blob(49, 49)
    current = blob(49 + dy, 49 + dx)
    estimate = estimate_local_motion(previous, current, GEO, *POINT, hours_between=1.0)
    assert estimate.status == "ok"
    assert estimate.shift_cells == (dx, dy)
    assert estimate.correlation > 0.99
    east_km, north_km = GEO.cell_size_km(POINT[0])
    assert estimate.east_kmh == pytest.approx(dx * east_km)
    assert estimate.north_kmh == pytest.approx(-dy * north_km)  # line +1 = south


def test_motion_direction_is_where_the_rain_goes():
    # Moving 3 cells east per hour → toward 90°, ~33 km/h.
    estimate = estimate_local_motion(blob(49, 49), blob(49, 52), GEO, *POINT, hours_between=1.0)
    assert estimate.toward_deg == pytest.approx(90.0)
    assert estimate.speed_kmh == pytest.approx(3 * GEO.cell_size_km(POINT[0])[0])


def test_no_rain_is_reported_not_as_zero_motion():
    dry = np.zeros((100, 100))
    estimate = estimate_local_motion(dry, dry, GEO, *POINT, hours_between=1.0)
    assert estimate.status == "no_rain_to_track"
    assert estimate.toward_deg is None


def test_window_off_the_grid_is_insufficient_data():
    estimate = estimate_local_motion(blob(5, 5), blob(5, 6), GEO, -0.5, 104.5, hours_between=1.0)
    assert estimate.status == "insufficient_data"


def test_missing_cells_are_ignored_by_matching():
    previous, current = blob(49, 49), blob(49, 51)
    current[40:45, 40:45] = np.nan
    estimate = estimate_local_motion(previous, current, GEO, *POINT, hours_between=1.0)
    assert estimate.shift_cells == (2, 0)


def test_neighbourhood_radius_and_edges():
    field = np.ones((100, 100))
    small = neighbourhood(field, GEO, *POINT, radius_km=5)
    large = neighbourhood(field, GEO, *POINT, radius_km=30)
    assert 1 <= small.size < large.size
    assert neighbourhood(field, GEO, -0.1, 104.1, radius_km=30) is None


def test_advection_brings_upstream_rain_to_the_point():
    # A storm 4 cells (~44 km) west of the point, moving east ~44 km/h.
    current = blob(49, 45, sigma=2)
    east_kmh = 4 * GEO.cell_size_km(POINT[0])[0]
    advected = forecast_at(current, GEO, "motion_advection", *POINT, 1, (east_kmh, 0.0), threshold_mm=1.0)
    persisted = forecast_at(current, GEO, "persistence", *POINT, 1, (0.0, 0.0), threshold_mm=1.0)
    assert advected.status == "ok"
    assert advected.probability > 0.5
    assert persisted.probability < advected.probability
    # The look-back position is upstream (west) of the point.
    assert advected.source_lon < POINT[1]
    assert advected.radius_km == pytest.approx(25.0)


def test_steering_wind_pointing_the_wrong_way_misses():
    current = blob(49, 45, sigma=2)
    # Wind FROM the east (90°) pushes air westward, away from the point.
    wrong = wind_to_motion_kmh(44.0, 90.0)
    assert wrong[0] < 0
    result = forecast_at(current, GEO, "steering_wind_advection", *POINT, 1, wrong, threshold_mm=1.0)
    assert result.probability == pytest.approx(0.0)


def test_velocity_selection_per_method():
    from app.ml.rainfall.motion import MotionEstimate

    tracked = MotionEstimate(status="ok", east_kmh=10.0, north_kmh=-5.0)
    assert velocity_for("persistence", None, None) == (0.0, 0.0)
    assert velocity_for("motion_advection", tracked, None) == (10.0, -5.0)
    assert velocity_for("motion_advection", MotionEstimate(status="no_rain_to_track"), None) == (0.0, 0.0)
    assert velocity_for("motion_advection", MotionEstimate(status="insufficient_data"), None) is None
    assert velocity_for("steering_wind_advection", tracked, None) is None


def test_missing_velocity_and_missing_data_are_insufficient():
    field = blob(49, 49)
    assert forecast_at(field, GEO, "steering_wind_advection", *POINT, 1, None, 1.0).status == "insufficient_data"
    holey = field.copy()
    holey[40:60, 40:60] = np.nan
    result = forecast_at(holey, GEO, "persistence", *POINT, 1, (0.0, 0.0), 1.0)
    assert result.status == "insufficient_data"
    assert result.reason == "too many missing cells"


def test_probability_is_a_fraction_in_unit_interval():
    field = blob(49, 49, peak=3.0, sigma=1.5)
    for horizon in (1, 2, 3):
        result = forecast_at(field, GEO, "persistence", *POINT, horizon, (0.0, 0.0), 1.0)
        assert 0.0 <= result.probability <= 1.0
        # Wider neighbourhoods at longer horizons dilute a small storm.
    probs = [forecast_at(field, GEO, "persistence", *POINT, h, (0.0, 0.0), 1.0).probability for h in (1, 3)]
    assert probs[1] < probs[0]


def test_offset_conversion():
    dlat, dlon = offset_km_to_degrees(0.0, 111.32, 110.574)
    assert dlat == pytest.approx(1.0)
    assert dlon == pytest.approx(1.0)
    assert offset_km_to_degrees(60.0, 111.32, 0)[1] == pytest.approx(2.0, rel=1e-3)
    assert math.isclose(wind_to_motion_kmh(10, 0)[1], -10)


def test_unchanged_field_is_not_reported_as_zero_motion():
    # GSMaP_NOW carry-over: the same rain, bit-for-bit, in both frames.
    field = blob(49, 49)
    estimate = estimate_local_motion(field, field.copy(), GEO, *POINT, hours_between=1.0)
    assert estimate.status == "unchanged_field"
    assert estimate.unchanged_fraction == pytest.approx(1.0)
    assert velocity_for("motion_advection", estimate, None) is None


def test_genuinely_stationary_rain_with_new_values_is_still_tracked():
    previous = blob(49, 49)
    current = blob(49, 49) * 1.1  # same place, updated intensities
    estimate = estimate_local_motion(previous, current, GEO, *POINT, hours_between=1.0)
    assert estimate.status == "ok"
    assert estimate.shift_cells == (0, 0)
    assert estimate.unchanged_fraction < 0.5
