from datetime import datetime, timedelta, timezone

import pytest

from app.ml.karhutla.smoke import predict_smoke
from app.ml.karhutla.units import angular_difference_deg
from app.schemas.karhutla import SmokeTransportRequest

ISSUED = datetime(2026, 9, 20, 6, 0, tzinfo=timezone.utc)
OBSERVED = ISSUED - timedelta(hours=2)


def atmosphere(from_deg=90.0, speed=20.0, blh=1200.0, hours=24, rain=0.0, grid_step=0.5):
    start = ISSUED - timedelta(hours=6)
    points = []
    for dlat in (-grid_step, 0.0, grid_step):
        for dlon in (-grid_step, 0.0, grid_step):
            points.append(
                {
                    "latitude": -2.2 + dlat,
                    "longitude": 113.9 + dlon,
                    "hours": [
                        {
                            "time": (start + timedelta(hours=i)).isoformat(),
                            "boundaryLayerHeightM": blh,
                            "precipitationMm": rain,
                            "levels": [
                                {"heightAglM": 10, "windSpeedKmh": speed * 0.7, "windFromDeg": from_deg},
                                {"heightAglM": 800, "windSpeedKmh": speed, "windFromDeg": from_deg},
                                {"heightAglM": 1500, "windSpeedKmh": speed * 1.2, "windFromDeg": from_deg},
                            ],
                        }
                        for i in range(hours)
                    ],
                }
            )
    return points


def request(**overrides) -> SmokeTransportRequest:
    payload = {
        "issuedAt": ISSUED.isoformat(),
        "horizonsHours": [1, 3, 6],
        "source": {
            "latitude": -2.2,
            "longitude": 113.9,
            "latestObservationAt": OBSERVED.isoformat(),
            "hotspotCount": 5,
            "totalFrpMw": 120.0,
        },
        "atmosphere": atmosphere(),
        "particles": 400,
        "seed": 7,
    }
    payload.update(overrides)
    return SmokeTransportRequest.model_validate(payload)


def test_same_seed_is_deterministic():
    assert predict_smoke(request()).model_dump() == predict_smoke(request()).model_dump()


def test_different_seed_changes_particles_but_not_direction():
    a = predict_smoke(request(seed=1)).horizons[-1]
    b = predict_smoke(request(seed=2)).horizons[-1]
    assert a.p90_distance_km != b.p90_distance_km
    assert angular_difference_deg(a.transport_bearing_deg, b.transport_bearing_deg) < 10


def test_smoke_travels_downwind_and_footprint_grows():
    result = predict_smoke(request())
    assert all(h.status == "ok" for h in result.horizons)
    # Wind FROM east -> smoke goes west.
    assert angular_difference_deg(result.horizons[-1].transport_bearing_deg, 270) < 15
    dist = [h.p90_distance_km for h in result.horizons]
    assert dist[0] < dist[1] < dist[2]


def test_follows_a_veering_wind_not_the_surface_direction():
    # Surface wind from the east but every level aloft from the south: most
    # smoke is in the boundary layer above 10 m, so it should head north.
    atm = atmosphere()
    for point in atm:
        for hour in point["hours"]:
            for level in hour["levels"][1:]:
                level["windFromDeg"] = 180.0
    result = predict_smoke(request(atmosphere=atm)).horizons[-1]
    assert angular_difference_deg(result.transport_bearing_deg, 0) < 30


def test_footprint_classes_are_nested_and_never_concentrations():
    result = predict_smoke(request())
    assert result.qualitative is True
    for horizon in result.horizons:
        core, likely, possible = horizon.footprint
        assert (core.level, likely.level, possible.level) == ("core", "likely", "possible")
        assert core.particle_share >= 0.5
        assert likely.particle_share >= 0.8
        assert core.area_km2 <= likely.area_km2 <= possible.area_km2
        assert core.geometry["type"] == "MultiPolygon"
    assert any("not pm2.5" in lim.lower() for lim in result.limitations)
    assert "concentration" not in str(result.model_dump().keys()).lower()


def test_horizon_beyond_wind_coverage_is_insufficient():
    result = predict_smoke(request(atmosphere=atmosphere(hours=8)))
    statuses = {h.horizon_hours: h.status for h in result.horizons}
    assert statuses[1] == "ok"
    assert statuses[6] == "insufficient_data"
    assert result.horizons[-1].footprint == []
    assert result.confidence == "very_low"


def test_missing_boundary_layer_is_flagged():
    atm = atmosphere()
    for point in atm:
        for hour in point["hours"]:
            hour["boundaryLayerHeightM"] = None
    result = predict_smoke(request(atmosphere=atm))
    assert any("Boundary-layer" in w for w in result.warnings)
    assert result.confidence == "very_low"


def test_rain_is_flagged():
    result = predict_smoke(request(atmosphere=atmosphere(rain=4.0)))
    assert any("rain" in w.lower() for w in result.warnings)


def test_stale_source_produces_no_footprint():
    source = {
        "latitude": -2.2,
        "longitude": 113.9,
        "latestObservationAt": (ISSUED - timedelta(hours=30)).isoformat(),
        "hotspotCount": 1,
    }
    result = predict_smoke(request(source=source))
    assert all(h.status == "insufficient_data" for h in result.horizons)


def test_too_few_particles_rejected_by_schema():
    with pytest.raises(ValueError):
        request(particles=10)


def test_rain_warns_but_does_not_degrade_confidence():
    # Wide grid so no particles leave the wind domain (which would degrade).
    result = predict_smoke(request(atmosphere=atmosphere(rain=4.0, grid_step=1.5)))
    assert any("rain" in w.lower() for w in result.warnings)
    assert result.confidence == "low"


def test_rain_outside_the_forecast_window_is_ignored():
    atm = atmosphere()
    for point in atm:
        point["hours"][0]["precipitationMm"] = 5.0  # 6 h before issue, before release starts
    result = predict_smoke(request(atmosphere=atm))
    assert not any("rain" in w.lower() for w in result.warnings)
