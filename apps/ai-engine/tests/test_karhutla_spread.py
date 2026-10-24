from datetime import datetime, timedelta, timezone

import pytest

from app.ml.karhutla.spread import (
    ConflictingInputError,
    length_to_breadth,
    predict_spread,
    slope_factor,
)
from app.ml.karhutla.units import angular_difference_deg
from app.schemas.karhutla import FireSpreadRequest

ISSUED = datetime(2026, 9, 20, 6, 0, tzinfo=timezone.utc)
OBSERVED = ISSUED - timedelta(hours=1)


def weather(hours=12, speed=15.0, from_deg=90.0, rh=45.0, temp=33.0, rain=0.0, start=None):
    start = start or OBSERVED - timedelta(hours=1)
    return [
        {
            "time": (start + timedelta(hours=i)).isoformat(),
            "windSpeedKmh": speed,
            "windFromDeg": from_deg,
            "temperatureC": temp,
            "relativeHumidityPct": rh,
            "precipitationMm": rain,
        }
        for i in range(hours)
    ]


def request(**overrides) -> FireSpreadRequest:
    payload = {
        "issuedAt": ISSUED.isoformat(),
        "horizonsHours": [1, 3, 6],
        "hotspots": [
            {"latitude": -2.20, "longitude": 113.90, "observedAt": OBSERVED.isoformat(), "scanKm": 1.0, "trackKm": 1.0},
            {"latitude": -2.21, "longitude": 113.91, "observedAt": OBSERVED.isoformat(), "scanKm": 1.0, "trackKm": 1.0},
        ],
        "weather": weather(),
        "terrain": None,
    }
    payload.update(overrides)
    return FireSpreadRequest.model_validate(payload)


def test_published_relations():
    assert length_to_breadth(0) == pytest.approx(1.0)
    assert length_to_breadth(30) > length_to_breadth(10) > 1.0
    assert slope_factor(10) == pytest.approx(2.0, rel=0.01)  # McArthur: doubles per +10 deg
    assert slope_factor(40) == slope_factor(20)  # clamped


def test_deterministic_for_identical_input():
    assert predict_spread(request()).model_dump() == predict_spread(request()).model_dump()


def test_envelope_grows_with_horizon_and_heads_downwind():
    result = predict_spread(request())
    areas = [h.area_km2 for h in result.horizons]
    assert all(h.status == "ok" for h in result.horizons)
    assert areas[0] < areas[1] < areas[2]
    assert result.observed_footprint_area_km2 < areas[0]
    # Wind FROM east (90) -> fire heads west (270).
    assert angular_difference_deg(result.horizons[-1].head_bearing_deg, 270) < 1
    # 10% rule at 15 km/h with moisture damping <= 1.5 km/h.
    assert result.horizons[-1].mean_head_ros_kmh <= 1.5 + 1e-9


def test_integration_starts_at_observation_not_issue_time():
    h1 = predict_spread(request()).horizons[0]
    assert h1.hours_since_observation == pytest.approx(2.0)


def test_humid_conditions_spread_less_than_dry():
    dry = predict_spread(request(weather=weather(rh=30, temp=35))).horizons[-1]
    humid = predict_spread(request(weather=weather(rh=95, temp=26))).horizons[-1]
    assert humid.area_km2 < dry.area_km2


def test_rain_halts_spread():
    result = predict_spread(request(weather=weather(rain=3.0))).horizons[-1]
    assert result.max_head_distance_km == 0
    assert any("Rain" in note for note in result.notes)


def test_upslope_spreads_faster_than_flat():
    ring = [{"bearingDeg": b, "elevationM": 100.0 + (150.0 if b == 270 else 0.0)} for b in range(0, 360, 45)]
    terrain = {"centerElevationM": 100.0, "ringRadiusKm": 1.0, "ring": ring}
    flat = predict_spread(request()).horizons[-1]
    uphill = predict_spread(request(terrain=terrain)).horizons[-1]
    assert uphill.max_head_distance_km > flat.max_head_distance_km
    assert uphill.factors.slope_deg > 0


def test_missing_weather_hour_yields_insufficient_data_not_a_polygon():
    gappy = weather(hours=4)  # covers only up to ~ISSUED+2h
    result = predict_spread(request(weather=gappy))
    statuses = {h.horizon_hours: h.status for h in result.horizons}
    assert statuses[1] == "ok"
    assert statuses[6] == "insufficient_data"
    assert result.horizons[-1].envelope is None
    assert result.confidence == "very_low"


def test_stale_observation_produces_no_envelope():
    old = (ISSUED - timedelta(hours=30)).isoformat()
    hotspots = [{"latitude": -2.2, "longitude": 113.9, "observedAt": old}]
    result = predict_spread(request(hotspots=hotspots, weather=weather(hours=48, start=ISSUED - timedelta(hours=31))))
    assert all(h.status == "insufficient_data" and h.envelope is None for h in result.horizons)


def test_observation_after_issue_time_is_rejected():
    future = (ISSUED + timedelta(hours=2)).isoformat()
    with pytest.raises(ConflictingInputError):
        predict_spread(request(hotspots=[{"latitude": -2.2, "longitude": 113.9, "observedAt": future}]))


def test_confidence_is_qualitative_and_limitations_always_present():
    result = predict_spread(request())
    assert result.confidence in ("low", "very_low")
    assert any("not calibrated" in lim.lower() for lim in result.limitations)
    assert any("peat" in lim.lower() for lim in result.limitations)


def test_naive_timestamps_rejected():
    with pytest.raises(ValueError):
        request(issuedAt="2026-09-20T06:00:00")


@pytest.mark.parametrize("lat", [-91, 91])
def test_invalid_coordinates_rejected(lat):
    with pytest.raises(ValueError):
        request(hotspots=[{"latitude": lat, "longitude": 113.9, "observedAt": OBSERVED.isoformat()}])


def test_duplicate_horizons_rejected():
    with pytest.raises(ValueError):
        request(horizonsHours=[1, 1])
