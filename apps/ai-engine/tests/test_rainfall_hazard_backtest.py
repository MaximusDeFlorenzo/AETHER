from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.ml.rainfall import flood_risk, landslide_risk
from app.ml.rainfall.hazard_backtest import (
    contingency,
    encode_matrix,
    evaluate,
    flood_levels,
    landslide_levels,
    replay,
    window_totals,
)
from app.schemas.rainfall_backtest import RainHazardBacktestRequest, RainHazardReplayRequest
from app.schemas.rainfall_flood import FloodPointIn, FloodRiskParameters
from app.schemas.rainfall_landslide import LandslidePointIn, LandslideRiskParameters

client = TestClient(app)
HEADERS = {"X-Internal-Token": get_settings().internal_service_token}
CODE = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "EXTREME": 3}
T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def random_rain(points: int, hours: int, seed: int) -> np.ndarray:
    """Mostly dry hours, some showers, rare cloudbursts, some gaps."""
    rng = np.random.default_rng(seed)
    rain = np.round(rng.gamma(0.4, 3.0, (points, hours)) * (rng.random((points, hours)) < 0.3), 2)
    bursts = rng.random((points, hours)) < 0.02
    rain[bursts] = np.round(rng.uniform(8, 60, bursts.sum()), 2)
    rain[rng.random((points, hours)) < 0.02] = np.nan
    rain[0, 100:103] = np.nan  # a 3 h gap: no flood level can be issued
    return rain


def live_inputs(series: np.ndarray, t: int):
    """What lib/flood-inputs.ts would send for the hour ending at column t."""
    def total(hours: int):
        window = series[t - hours + 1 : t + 1]
        return None if np.isnan(window).any() else round(float(window.sum()), 2)

    last3 = [float(v) for v in series[t - 2 : t + 1] if not np.isnan(v)]
    rainfall = {
        "source": "gsmap",
        "dataKind": "satellite_estimate",
        "validTime": T0.isoformat(),
        "freshness": "fresh",
        "maxHourlyMmLast3Hours": max(last3) if last3 else None,
        "accumulationsMm": {str(w): total(w) for w in (1, 3, 6, 24)},
    }
    antecedent = {
        "source": "gsmap",
        "dataKind": "satellite_estimate",
        "validTime": T0.isoformat(),
        "totalMm72Hours": total(72),
    }
    return rainfall, antecedent


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_replay_matches_live_flood_and_landslide_rules(seed):
    rain = random_rain(6, 200, seed)
    indices = [0.1, 0.5, 0.9, None, 0.2, 0.7]
    slopes = [[2.0] * 10, [15.0] * 10, [30.0] * 10, None, [5.0] * 3, [12.0] * 10]
    flood_params = FloodRiskParameters(susceptibility_breaks=[0.3, 0.6])
    slide_params = LandslideRiskParameters()
    s_class = [flood_risk.susceptibility_class(i, flood_params.susceptibility_breaks) for i in indices]
    t_class = [
        landslide_risk.terrain_class(
            landslide_risk.LandslideTerrainIn(source="x", dem="x", slope_samples_deg=s) if s else None, slide_params
        )[0]
        for s in slopes
    ]
    f_level, f_trigger = flood_levels(rain, s_class, flood_params)
    l_level, l_trigger = landslide_levels(rain, t_class, slide_params)

    checked = 0
    for p in range(rain.shape[0]):
        for t in range(71, rain.shape[1]):
            rainfall, antecedent = live_inputs(rain[p], t)
            flood = flood_risk.assess_point(
                FloodPointIn.model_validate(
                    {"id": "x", "rainfall": rainfall, "susceptibility": {"source": "x", "floodHazardIndex": indices[p]}}
                ),
                flood_params,
            )
            slide = landslide_risk.assess_point(
                LandslidePointIn.model_validate(
                    {
                        "id": "x",
                        "rainfall": rainfall,
                        "antecedent": antecedent,
                        **({"terrain": {"source": "x", "dem": "x", "slopeSamplesDeg": slopes[p]}} if slopes[p] else {}),
                    }
                ),
                slide_params,
            )
            assert f_level[p, t] == (CODE[flood.level] if flood.level else -1), (p, t)
            assert f_trigger[p, t] == (CODE[flood.rain_trigger_level] if flood.level else -1), (p, t)
            assert l_level[p, t] == (CODE[slide.level] if slide.level else -1), (p, t)
            assert l_trigger[p, t] == (CODE[slide.rain_trigger_level] if slide.level else -1), (p, t)
            checked += 1
    assert checked > 700
    # The random series must actually exercise raised levels.
    assert (f_level > 0).any() and (l_level > 0).any() and (f_level == -1).any()


def test_window_totals_need_every_hour():
    rain = np.array([[1.0, 2.0, np.nan, 4.0, 5.0]])
    out = window_totals(rain, 2)
    assert np.isnan(out[0, 0]) and out[0, 1] == 3.0
    assert np.isnan(out[0, 2]) and np.isnan(out[0, 3]) and out[0, 4] == 9.0


def replay_request(rain: np.ndarray, offsets, first_day=date(2026, 1, 5), days=2, start=T0, **extra):
    return RainHazardReplayRequest.model_validate(
        {
            "seriesStart": start.isoformat(),
            "hours": rain.shape[1],
            "dataB64": encode_matrix(rain, "<f4"),
            "firstDay": first_day.isoformat(),
            "days": days,
            "points": [{"id": f"p{i}", "utcOffsetHours": o} for i, o in enumerate(offsets)],
            **extra,
        }
    )


def test_replay_assigns_hours_to_local_days():
    # Columns are hours ending at T0 + j h. The burst is the hour ending
    # 2026-01-05 16:00 UTC = 23:00 Jan 5 in WIB (+7) but 01:00 Jan 6 in WIT (+9).
    hours = 24 * 8
    rain = np.zeros((2, hours), dtype=np.float32)
    burst = int((datetime(2026, 1, 5, 16, tzinfo=timezone.utc) - T0).total_seconds() // 3600)
    rain[:, burst] = 160.0  # > daily ekstrem, > hourly sangat lebat
    out = replay(replay_request(rain, [7, 9])).points
    # WIB: the burst hour ends 23:00 local Jan 5 → day 0 raised.
    assert out[0].flood_level[0] == 3
    # WIT: it ends 01:00 local Jan 6 → day 0 untouched, day 1 raised.
    assert out[1].flood_level[0] == 0 and out[1].flood_level[1] == 3
    # The 24 h total keeps day 1 raised for WIB too (window spans midnight).
    assert out[0].flood_level[1] == 3


def test_replay_needs_lead_in_and_marks_missing_days():
    rain = np.zeros((1, 24 * 4), dtype=np.float32)
    with pytest.raises(ValueError, match="71 h before"):
        replay(replay_request(rain, [7], first_day=date(2026, 1, 2), days=1))
    rain = np.full((1, 24 * 8), np.nan, dtype=np.float32)
    out = replay(replay_request(rain, [7])).points[0]
    assert out.flood_level == [-1, -1] and out.landslide_level == [-1, -1]


def evaluation_request(levels, triggers, events, test_start, **extra):
    p, d = levels.shape
    return RainHazardBacktestRequest.model_validate(
        {
            "issuedAt": T0.isoformat(),
            "firstDay": "2024-01-01",
            "points": p,
            "days": d,
            "testStartDay": test_start,
            "minCellsForRate": 10,
            "hazards": [
                {
                    "hazard": "flood",
                    "levelsB64": encode_matrix(levels, "i1"),
                    "triggersB64": encode_matrix(triggers, "i1"),
                    "eventsB64": encode_matrix(events, "i1"),
                }
            ],
            **extra,
        }
    )


def test_contingency_strict_and_tolerant():
    warn = np.array([[True, False, False, True, False]])
    event = np.array([[True, True, False, False, False]])
    mask = np.ones_like(warn)
    c = contingency(warn, event, mask, tolerance=1)
    assert (c.hits, c.misses, c.false_alarms, c.correct_negatives) == (1, 1, 1, 2)
    assert c.pod == 0.5 and c.far == 0.5 and c.csi == pytest.approx(0.3333, abs=1e-4)
    # Event on day 1 is next to the warning on day 0; the warning on day 3
    # has no report within a day.
    assert c.pod_tolerant == 1.0 and c.far_tolerant == 0.5


def test_informative_levels_beat_climatology_and_carry_rates():
    rng = np.random.default_rng(0)
    p, d = 40, 400
    levels = rng.choice([0, 0, 0, 0, 1, 2, 3], size=(p, d)).astype(np.int8)
    rate = np.array([0.01, 0.1, 0.3, 0.6])
    events = (rng.random((p, d)) < rate[levels]).astype(np.int8)
    levels[0, :5] = -1
    out = evaluate(evaluation_request(levels, levels, events, test_start=240)).hazards[0]
    cal, test = out.splits
    assert cal.split == "calibration" and test.split == "test"
    assert cal.last_day == date(2024, 1, 1) + timedelta(days=238)  # 1 embargo day
    assert cal.evaluable_cells == p * 239 - 5
    high = next(t for t in test.thresholds if t.threshold == "HIGH").rule
    assert high.lift > 2 and 0 < high.pod < 1
    rates = {r.level: r.rate for r in test.rates_by_level}
    assert rates["LOW"] < rates["MEDIUM"] < rates["HIGH"] < rates["EXTREME"]
    assert out.probabilistic_test.bss_vs_district_climatology > 0.1
    assert out.probabilistic_test.levels_without_rate == []


def test_uninformative_levels_show_no_skill():
    rng = np.random.default_rng(1)
    levels = rng.choice([0, 1, 2], size=(30, 300)).astype(np.int8)
    events = (rng.random((30, 300)) < 0.05).astype(np.int8)
    out = evaluate(evaluation_request(levels, levels, events, test_start=200)).hazards[0]
    assert out.probabilistic_test.bss_vs_national_climatology < 0.01
    assert out.probabilistic_test.levels_without_rate == ["EXTREME"]


def test_endpoints_round_trip_and_validation():
    rain = np.zeros((1, 24 * 8), dtype=np.float32)
    body = replay_request(rain, [7]).model_dump(by_alias=True, mode="json")
    res = client.post("/replay-rain-hazard-rules", json=body, headers=HEADERS)
    assert res.status_code == 200
    assert res.json()["points"][0]["floodLevel"] == [0, 0]
    body["firstDay"] = "2026-01-01"
    assert client.post("/replay-rain-hazard-rules", json=body, headers=HEADERS).status_code == 422
    assert client.post("/replay-rain-hazard-rules", json=body).status_code == 422

    levels = np.zeros((2, 10), dtype=np.int8)
    ev = evaluation_request(levels, levels, levels, test_start=6).model_dump(by_alias=True, mode="json")
    assert client.post("/evaluate-rain-hazard-backtest", json=ev, headers=HEADERS).status_code == 200
    ev["hazards"].append(ev["hazards"][0])
    assert client.post("/evaluate-rain-hazard-backtest", json=ev, headers=HEADERS).status_code == 422
    ev["hazards"].pop()
    ev["testStartDay"] = 10
    assert client.post("/evaluate-rain-hazard-backtest", json=ev, headers=HEADERS).status_code == 422
