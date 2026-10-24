import math

import pytest

from app.ml.karhutla.fuel_moisture import (
    equilibrium_moisture_content_pct,
    relative_moisture_factor,
)
from app.ml.karhutla.geometry import LocalFrame, convex_hull, polygon_area_km2
from app.ml.karhutla.units import (
    angular_difference_deg,
    downwind_bearing,
    to_kmh,
    uv_to_wind,
    wind_to_uv,
)


def test_speed_unit_conversions():
    assert to_kmh(10, "ms") == pytest.approx(36.0)
    assert to_kmh(10, "knots") == pytest.approx(18.52)
    assert to_kmh(10, "mph") == pytest.approx(16.09344)
    assert to_kmh(10, "kmh") == 10


@pytest.mark.parametrize("bad", [-1.0, float("nan"), float("inf")])
def test_invalid_speeds_rejected(bad):
    with pytest.raises(ValueError):
        to_kmh(bad, "ms")


def test_unknown_unit_rejected():
    with pytest.raises(ValueError):
        to_kmh(5, "beaufort")


def test_wind_from_north_blows_toward_south():
    u, v = wind_to_uv(10, 0)
    assert u == pytest.approx(0, abs=1e-9)
    assert v == pytest.approx(-10)
    assert downwind_bearing(0) == 180
    assert downwind_bearing(270) == 90


@pytest.mark.parametrize("from_deg", [0, 45, 135, 180, 270, 359])
def test_uv_round_trip(from_deg):
    speed, back = uv_to_wind(*wind_to_uv(12.5, from_deg))
    assert speed == pytest.approx(12.5)
    assert angular_difference_deg(back, from_deg) < 1e-6


def test_vector_average_across_north_is_north_not_south():
    u1, v1 = wind_to_uv(10, 350)
    u2, v2 = wind_to_uv(10, 10)
    _, mean_from = uv_to_wind((u1 + u2) / 2, (v1 + v2) / 2)
    assert angular_difference_deg(mean_from, 0) < 1e-6


def test_emc_rises_with_humidity_and_damping_falls():
    dry = equilibrium_moisture_content_pct(34, 35)
    humid = equilibrium_moisture_content_pct(27, 95)
    assert dry < humid
    assert relative_moisture_factor(dry / 100) > relative_moisture_factor(humid / 100)
    assert relative_moisture_factor(0.30) == 0  # above moisture of extinction


def test_local_frame_round_trip_and_scale():
    frame = LocalFrame(-2.2, 113.9)
    x, y = frame.to_xy(-2.2, 114.0)
    assert x == pytest.approx(11.11, rel=0.01)  # 0.1 deg lon near the equator
    lat, lon = frame.to_latlon(x, y)
    assert (lat, lon) == pytest.approx((-2.2, 114.0))


def test_convex_hull_and_area():
    square = [(0, 0), (2, 0), (2, 2), (0, 2), (1, 1)]
    hull = convex_hull(square)
    assert len(hull) == 4
    assert polygon_area_km2(hull) == pytest.approx(4.0)
    assert math.isclose(polygon_area_km2([(0, 0), (1, 0)]), 0.0)
