from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import get_settings
from app.main import app
from app.ml.rainfall.landslide_risk import (
    assess_point,
    factor_bases,
    id_threshold_mm,
    slope_quantile_deg,
    terrain_class,
)
from app.schemas.rainfall_landslide import (
    LandslidePointIn,
    LandslideRiskParameters,
    LandslideTerrainIn,
)

client = TestClient(app)
HEADERS = {"X-Internal-Token": get_settings().internal_service_token}
T = datetime(2026, 10, 7, 2, 0, tzinfo=timezone.utc)
PARAMS = LandslideRiskParameters()

STEEP = [30.0] * 16  # tan(30°) = 57.7 % → type A
GENTLE = [3.0] * 16  # 5.2 % → type C


def lower(hours):
    return id_threshold_mm(PARAMS.lower_id_alpha, PARAMS.lower_id_beta, hours)


def upper(hours):
    return id_threshold_mm(PARAMS.upper_id_alpha, PARAMS.upper_id_beta, hours)


def point(
    acc=None,
    total_72=None,
    freshness="fresh",
    kind="satellite_estimate",
    slopes=STEEP,
    antecedent_kind="satellite_estimate",
    **extra,
):
    acc = acc if acc is not None else {"1": 0.0, "3": 0.0, "6": 0.0, "24": 0.0}
    data = {
        "id": "d1",
        "rainfall": {
            "source": "gsmap_gauge_now",
            "dataKind": kind,
            "validTime": T.isoformat(),
            "freshness": freshness,
            "accumulationsMm": acc,
        },
        **extra,
    }
    if total_72 is not None:
        data["antecedent"] = {
            "source": "gsmap_gauge_now" if antecedent_kind == "satellite_estimate" else "open-meteo",
            "dataKind": antecedent_kind,
            "validTime": T.isoformat(),
            "totalMm72Hours": total_72,
        }
    if slopes is not None:
        data["terrain"] = {"source": "open-meteo-elevation", "dem": "Copernicus GLO-90", "slopeSamplesDeg": slopes}
    return LandslidePointIn.model_validate(data)


def test_published_curves_in_mm():
    # Guzzetti 2008 global minimum and Caine 1980 at 24 h.
    assert lower(24) == pytest.approx(13.05, abs=0.05)
    assert upper(24) == pytest.approx(103.0, abs=0.1)
    assert lower(72) == pytest.approx(24.2, abs=0.1)
    assert upper(72) == pytest.approx(201.3, abs=0.2)


def test_dry_steep_district_is_low():
    out = assess_point(point(total_72=0.0), PARAMS)
    assert out.status == "ok"
    assert out.level == "LOW"
    assert out.trigger_class == "below_lower"
    assert out.terrain_class == "high"
    assert out.probability is None and out.time_to_risk_hours is None


def test_lower_curve_raises_to_medium():
    out = assess_point(point({"24": lower(24) + 0.1}, total_72=lower(24) + 0.1), PARAMS)
    assert out.rain_trigger_level == "MEDIUM"
    assert out.trigger_class == "above_lower"
    assert out.level == "MEDIUM"
    raised = [f for f in out.factors if f.effect == "raised"]
    assert [f.factor for f in raised] == ["rain_24h"]
    assert out.factors[0].factor == "rain_24h"


def test_upper_curve_raises_to_high_and_never_extreme():
    out = assess_point(point({"3": 500.0, "6": 500.0, "24": 500.0}, total_72=900.0), PARAMS)
    assert out.level == "HIGH"
    assert out.trigger_class == "above_upper"


def test_long_window_alone_can_trigger():
    out = assess_point(point({"3": 0.0, "6": 0.0, "24": 10.0}, total_72=lower(72) + 1), PARAMS)
    assert out.level == "MEDIUM"
    assert out.critical_window_hours == 72


def test_gentle_terrain_lowers_one_level():
    out = assess_point(point({"24": upper(24) + 1}, total_72=upper(24) + 1, slopes=GENTLE), PARAMS)
    assert out.rain_trigger_level == "HIGH"
    assert out.terrain_class == "low"
    assert out.level == "MEDIUM"
    slope = next(f for f in out.factors if f.factor == "slope")
    assert slope.effect == "lowered"


def test_downgrade_can_be_disabled():
    params = LandslideRiskParameters(downgrade_gentle_terrain=False)
    out = assess_point(point({"24": upper(24) + 1}, total_72=upper(24) + 1, slopes=GENTLE), params)
    assert out.level == "HIGH"


def test_unknown_terrain_never_lowers():
    out = assess_point(point({"24": upper(24) + 1}, total_72=upper(24) + 1, slopes=None), PARAMS)
    assert out.terrain_class == "unknown"
    assert out.level == "HIGH"
    assert "terrain slope unknown" in out.confidence_reasons


def test_too_few_terrain_samples_is_unknown():
    assert terrain_class(LandslideTerrainIn(source="x", dem="y", slope_samples_deg=[40.0] * 3), PARAMS) == (
        "unknown",
        None,
    )


def test_terrain_classes_follow_permen_pu_typology():
    def cls(deg):
        return terrain_class(LandslideTerrainIn(source="x", dem="y", slope_samples_deg=[deg] * 10), PARAMS)[0]

    assert cls(5.0) == "low"  # 8.7 %
    assert cls(15.0) == "medium"  # 26.8 %
    assert cls(25.0) == "high"  # 46.6 %


def test_quantile_lets_hills_around_a_valley_count():
    samples = [1.0] * 13 + [30.0] * 3
    assert slope_quantile_deg(samples, 0.9) == pytest.approx(30.0)
    assert slope_quantile_deg(samples, 0.5) == pytest.approx(1.0)
    assert slope_quantile_deg([0.0, 10.0], 0.5) == pytest.approx(5.0)


def test_stale_rain_is_insufficient_data():
    out = assess_point(point({"24": 500.0}, freshness="stale"), PARAMS)
    assert out.status == "insufficient_data"
    assert out.level is None
    assert "fresh" in out.reason


def test_incomplete_windows_reduce_confidence():
    out = assess_point(point({"24": 1.0}), PARAMS)
    assert out.status == "ok"
    assert out.confidence == "very_low"
    assert "some trigger windows incomplete" in out.confidence_reasons
    missing = [f.factor for f in out.factors if f.effect == "not_available"]
    assert set(missing) == {"rain_3h", "rain_6h", "rain_72h"}


def test_best_case_confidence_is_only_low():
    out = assess_point(point(total_72=0.0), PARAMS)
    assert out.confidence == "low"
    assert any("not calibrated" in r for r in out.confidence_reasons)


def test_model_driven_long_window_is_very_low_confidence():
    # GSMaP history shorter than 72 h: the 72 h window falls back to model rain.
    out = assess_point(point(total_72=lower(72) + 1, antecedent_kind="nwp_model"), PARAMS)
    assert out.level == "MEDIUM"
    assert out.confidence == "very_low"
    assert "72 h rainfall is nwp_model, not an observation-based estimate" in out.confidence_reasons


def test_antecedent_without_kind_is_not_trusted():
    p = point(total_72=0.0)
    p.antecedent.data_kind = None
    out = assess_point(p, PARAMS)
    assert out.confidence == "very_low"
    assert any("unknown kind" in r for r in out.confidence_reasons)


def test_model_rainfall_is_very_low_confidence():
    out = assess_point(point(total_72=0.0, kind="nwp_model"), PARAMS)
    assert out.confidence == "very_low"


def test_context_factors_are_not_scored():
    p = point(
        {"1": 50.0, "3": 0.0, "6": 0.0, "24": 0.0},
        total_72=0.0,
        soilMoisture={"source": "open-meteo", "validTime": T.isoformat(), "volumetricFraction": 0.45},
    )
    out = assess_point(p, PARAMS)
    assert out.level == "LOW"
    by_name = {f.factor: f for f in out.factors}
    assert by_name["rain_1h"].effect == "not_scored"
    assert by_name["soil_moisture_9_27cm"].effect == "not_scored"


def test_parameters_validate():
    with pytest.raises(ValidationError):
        LandslideRiskParameters(trigger_windows_hours=[12])
    with pytest.raises(ValidationError):
        LandslideRiskParameters(upper_id_alpha=1.0)
    with pytest.raises(ValidationError):
        LandslideRiskParameters(slope_gentle_max_percent=50)


def test_factor_bases_cite_sources():
    bases = factor_bases(PARAMS)
    assert "Guzzetti" in bases["rain_24h"] and "Caine" in bases["rain_24h"]
    assert "Permen PU" in bases["slope"]
    assert bases["rain_1h"].startswith("Window not in")


def _payload():
    return {
        "issuedAt": T.isoformat(),
        "points": [point({"24": 20.0}, total_72=30.0).model_dump(by_alias=True, mode="json")],
    }


def test_endpoint_round_trip():
    res = client.post("/predict-rain-landslide-risk", json=_payload(), headers=HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["modelVersion"] == "landslide-rule-baseline-v0.1"
    assert body["calibrated"] is False
    assert body["points"][0]["level"] == "MEDIUM"
    assert body["points"][0]["probability"] is None
    assert any(m.startswith("REQUIRED DATA") for m in body["missingInputs"])


def test_endpoint_requires_token():
    assert client.post("/predict-rain-landslide-risk", json=_payload()).status_code == 422
    bad = {"X-Internal-Token": "wrong"}
    assert client.post("/predict-rain-landslide-risk", json=_payload(), headers=bad).status_code == 401
