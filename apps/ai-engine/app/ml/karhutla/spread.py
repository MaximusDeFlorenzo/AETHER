"""Potential fire-spread envelope for one FIRMS hotspot cluster.

Method (every constant below is a published relation or a documented
assumption, surfaced in the response's `assumptions`):

1. Initial area — convex hull of the hotspot *pixels* (FIRMS `scan` x
   `track` km rectangles). A thermal-anomaly footprint, not a perimeter.
2. Head-fire rate of spread (km/h) per hourly step:
       ROS = 0.10 x U10 x f_moisture x f_slope
   - 0.10 x U10: Cruz & Alexander (2019, Ann. For. Sci. 76:44) "10% wind
     speed rule of thumb" for forests/shrublands under DRY fuel
     conditions — used here as an upper-bound scenario, not a forecast.
   - f_moisture: Rothermel moisture damping at the Simard EMC, relative to
     a dry reference (fuel_moisture.py). Rain >= 1 mm/h in a step stops
     spread for that step (assumption: fine fuels wetted).
   - f_slope: McArthur's rule, spread doubles per +10 deg slope:
     exp(0.0693 x slope), slope taken along the downwind bearing from the
     terrain ring, clamped to +/-20 deg.
3. Shape — each step grows the envelope by an elliptical Huygens wavelet
   with the ignition at the rear focus. Length-to-breadth ratio from wind:
   Alexander (1985): LB = 1 + 8.729 (1 - exp(-0.030 U10))^2.155.
   Because hull and wavelet are both convex, the Minkowski sum computed as
   the convex hull of (vertex + wavelet point) is exact Huygens growth.
4. Integration runs from the LATEST hotspot observation (not the issue
   time) to each horizon's valid time — a 9-hour-old observation is
   grown for 9 h + horizon.

No input is fabricated: a step with no weather within +/-1.5 h, or a
cluster whose newest observation is older than 24 h, yields
`status="insufficient_data"` for that horizon instead of a polygon.
"""

import math
from datetime import datetime, timedelta

from app.ml.hazard_prediction.common import clamp
from app.ml.karhutla.fuel_moisture import (
    DRY_REFERENCE_MOISTURE,
    MOISTURE_OF_EXTINCTION,
    equilibrium_moisture_content_pct,
    relative_moisture_factor,
)
from app.ml.karhutla.geometry import (
    LocalFrame,
    Point,
    bearing_of,
    convex_hull,
    offset,
    polygon_area_km2,
    ring_to_geojson,
)
from app.ml.karhutla.units import downwind_bearing, uv_to_wind, wind_to_uv
from app.schemas.karhutla import (
    FireSpreadRequest,
    FireSpreadResponse,
    SpreadFactors,
    SpreadHorizon,
    SurfaceWeatherHour,
    TerrainInput,
)

MODEL_VERSION = "karhutla-spread-ellipse-v0.1"
METHOD = (
    "Elliptical Huygens envelope: 10% wind-speed rule (dry-fuel upper bound) x "
    "Rothermel moisture damping (Simard EMC) x McArthur slope factor; "
    "Alexander (1985) length-to-breadth ratio"
)

WIND_SPEED_FRACTION = 0.10
MCARTHUR_SLOPE_COEFFICIENT = 0.0693
MAX_ABS_SLOPE_DEG = 20.0
RAIN_STOPS_SPREAD_MM_PER_H = 1.0
MAX_OBSERVATION_AGE_H = 24.0
DEGRADED_OBSERVATION_AGE_H = 12.0
WEATHER_MATCH_TOLERANCE = timedelta(minutes=90)
# Hotspot timestamps can legitimately trail the caller's clock by a few
# minutes; anything later than this is a conflicting input, not drift.
FUTURE_OBSERVATION_TOLERANCE = timedelta(minutes=10)
DEFAULT_PIXEL_KM = 1.0  # MODIS nadir pixel, used when scan/track missing
WAVELET_POINTS = 36

LIMITATIONS = [
    "Potential spread envelope under an upper-bound dry-fuel scenario (10% wind-speed "
    "rule); not a predicted fire perimeter, arrival time or probability.",
    "Fuel type, load and canopy are unknown (no Indonesian fuel map in AETHER); one "
    "generic moisture-of-extinction value is assumed for all vegetation.",
    "Peat (gambut) smouldering and below-ground fire is not represented; peat fires "
    "usually spread far slower than this envelope but can burn for weeks.",
    "The initial area is the convex hull of satellite hotspot pixels (thermal "
    "anomalies), not a mapped perimeter: it can include unburned land between "
    "detections and misses fire hidden by cloud or thick smoke.",
    "Suppression, firebreaks, rivers, roads, spotting and fuel discontinuities are "
    "not modelled.",
    "Not calibrated or validated against observed Indonesian fire progression.",
]


class ConflictingInputError(ValueError):
    """Inputs that contradict each other (e.g. an observation after issuedAt)."""


def length_to_breadth(wind_speed_kmh: float) -> float:
    return 1.0 + 8.729 * (1.0 - math.exp(-0.030 * max(0.0, wind_speed_kmh))) ** 2.155


def head_to_back_ratio(lb: float) -> float:
    if lb <= 1.0:
        return 1.0
    root = math.sqrt(lb * lb - 1.0)
    return (lb + root) / (lb - root)


def slope_factor(slope_deg: float) -> float:
    return math.exp(MCARTHUR_SLOPE_COEFFICIENT * clamp(slope_deg, -MAX_ABS_SLOPE_DEG, MAX_ABS_SLOPE_DEG))


def slope_along(terrain: TerrainInput, bearing_deg: float) -> float:
    """Slope (deg, + = uphill) from the cluster centre toward `bearing_deg`,
    linearly interpolating the ring samples around the circle."""
    samples = sorted(terrain.ring, key=lambda s: s.bearing_deg)
    bearings = [s.bearing_deg for s in samples] + [samples[0].bearing_deg + 360.0]
    elevations = [s.elevation_m for s in samples] + [samples[0].elevation_m]
    target = bearing_deg % 360.0
    if target < bearings[0]:
        target += 360.0
    elevation = elevations[0]
    for i in range(len(samples)):
        if bearings[i] <= target <= bearings[i + 1]:
            span = bearings[i + 1] - bearings[i]
            frac = (target - bearings[i]) / span if span else 0.0
            elevation = elevations[i] + frac * (elevations[i + 1] - elevations[i])
            break
    rise_m = elevation - terrain.center_elevation_m
    return math.degrees(math.atan2(rise_m, terrain.ring_radius_km * 1000.0))


def wavelet(head_km: float, lb: float, heading_deg: float) -> list[Point]:
    """Ellipse of one step's growth, ignition point at the origin (rear focus)."""
    back_km = head_km / head_to_back_ratio(lb)
    a = (head_km + back_km) / 2.0
    b = a / lb
    center_shift = head_km - a
    heading = math.radians(heading_deg)
    sin_h, cos_h = math.sin(heading), math.cos(heading)
    points = []
    for i in range(WAVELET_POINTS):
        theta = 2.0 * math.pi * i / WAVELET_POINTS
        along = center_shift + a * math.cos(theta)
        across = b * math.sin(theta)
        # `along` points toward heading; `across` 90 deg clockwise of it.
        points.append((along * sin_h + across * cos_h, along * cos_h - across * sin_h))
    return points


def pixel_footprint(frame: LocalFrame, request: FireSpreadRequest) -> list[Point]:
    corners: list[Point] = []
    for hotspot in request.hotspots:
        cx, cy = frame.to_xy(hotspot.latitude, hotspot.longitude)
        half_x = (hotspot.scan_km or DEFAULT_PIXEL_KM) / 2.0
        half_y = (hotspot.track_km or DEFAULT_PIXEL_KM) / 2.0
        corners += [
            (cx - half_x, cy - half_y),
            (cx + half_x, cy - half_y),
            (cx + half_x, cy + half_y),
            (cx - half_x, cy + half_y),
        ]
    return convex_hull(corners)


def weather_at(weather: list[SurfaceWeatherHour], moment: datetime) -> SurfaceWeatherHour | None:
    best = min(weather, key=lambda w: abs(w.time - moment))
    return best if abs(best.time - moment) <= WEATHER_MATCH_TOLERANCE else None


def _grow_horizon(
    frame: LocalFrame,
    footprint: list[Point],
    request: FireSpreadRequest,
    start: datetime,
    valid_at: datetime,
    horizon: int,
) -> SpreadHorizon:
    hours_since_obs = (valid_at - start).total_seconds() / 3600.0
    base = dict(horizon_hours=horizon, valid_at=valid_at, hours_since_observation=round(hours_since_obs, 2))

    hull = list(footprint)
    sum_u = sum_v = 0.0
    head_dx = head_dy = 0.0
    total_hours = head_path_km = 0.0
    moisture_weighted = slope_factor_weighted = moisture_pct_weighted = 0.0
    moisture_pct_hours = 0.0
    rain_hours = 0
    notes: list[str] = []
    missing_humidity = False

    t = start
    while t < valid_at:
        dt_h = min(1.0, (valid_at - t).total_seconds() / 3600.0)
        mid = t + timedelta(hours=dt_h / 2.0)
        w = weather_at(request.weather, mid)
        if w is None:
            return SpreadHorizon(
                **base,
                status="insufficient_data",
                notes=[f"No weather data within ±90 min of {mid.isoformat()}; envelope not computed."],
            )

        u, v = wind_to_uv(w.wind_speed_kmh, w.wind_from_deg)
        sum_u += u * dt_h
        sum_v += v * dt_h
        heading = downwind_bearing(w.wind_from_deg)

        if w.temperature_c is not None and w.relative_humidity_pct is not None:
            emc_pct = equilibrium_moisture_content_pct(w.temperature_c, w.relative_humidity_pct)
            f_moisture = relative_moisture_factor(emc_pct / 100.0)
            moisture_pct_weighted += emc_pct * dt_h
            moisture_pct_hours += dt_h
        else:
            missing_humidity = True
            f_moisture = 1.0
        if (w.precipitation_mm or 0.0) >= RAIN_STOPS_SPREAD_MM_PER_H:
            f_moisture = 0.0
            rain_hours += 1

        f_slope = slope_factor(slope_along(request.terrain, heading)) if request.terrain else 1.0
        ros = WIND_SPEED_FRACTION * w.wind_speed_kmh * f_moisture * f_slope
        head_km = ros * dt_h
        if head_km > 0:
            lb = length_to_breadth(w.wind_speed_kmh)
            step = wavelet(head_km, lb, heading)
            hull = convex_hull([(hx + sx, hy + sy) for hx, hy in hull for sx, sy in step])
            dx, dy = offset((0.0, 0.0), heading, head_km)
            head_dx += dx
            head_dy += dy
            head_path_km += head_km

        moisture_weighted += f_moisture * dt_h
        slope_factor_weighted += f_slope * dt_h
        total_hours += dt_h
        t += timedelta(hours=dt_h)

    if missing_humidity:
        notes.append("Temperature/humidity missing for some hours; dry fuels assumed (upper bound).")
    if rain_hours:
        notes.append(f"Rain ≥ {RAIN_STOPS_SPREAD_MM_PER_H} mm/h in {rain_hours} hour(s); spread halted for those hours.")
    if head_path_km == 0:
        notes.append("No spread under the assumed conditions; envelope equals the observed footprint.")

    mean_speed, mean_from = uv_to_wind(sum_u / total_hours, sum_v / total_hours) if total_hours else (0.0, 0.0)
    slope_deg = (
        slope_along(request.terrain, downwind_bearing(mean_from)) if request.terrain and mean_speed > 0 else None
    )
    return SpreadHorizon(
        **base,
        status="ok",
        envelope=ring_to_geojson(frame, hull),
        area_km2=round(polygon_area_km2(hull), 3),
        head_bearing_deg=round(bearing_of(head_dx, head_dy), 1) if head_path_km > 0 else None,
        max_head_distance_km=round(head_path_km, 3),
        mean_wind_speed_kmh=round(mean_speed, 2),
        mean_wind_from_deg=round(mean_from, 1),
        mean_head_ros_kmh=round(head_path_km / total_hours, 4) if total_hours else 0.0,
        factors=SpreadFactors(
            estimated_fine_fuel_moisture_pct=(
                round(moisture_pct_weighted / moisture_pct_hours, 2) if moisture_pct_hours else None
            ),
            moisture_factor=round(moisture_weighted / total_hours, 3) if total_hours else 1.0,
            slope_deg=round(slope_deg, 2) if slope_deg is not None else None,
            slope_factor=round(slope_factor_weighted / total_hours, 3) if total_hours else 1.0,
            length_to_breadth=round(length_to_breadth(mean_speed), 3),
        ),
        notes=notes,
    )


def _frame(request: FireSpreadRequest) -> LocalFrame:
    lat0 = sum(h.latitude for h in request.hotspots) / len(request.hotspots)
    lon0 = sum(h.longitude for h in request.hotspots) / len(request.hotspots)
    return LocalFrame(lat0, lon0)


def predict_spread(request: FireSpreadRequest) -> FireSpreadResponse:
    latest = max(h.observed_at for h in request.hotspots)
    if latest > request.issued_at + FUTURE_OBSERVATION_TOLERANCE:
        raise ConflictingInputError(
            f"Hotspot observed at {latest.isoformat()} is after issuedAt {request.issued_at.isoformat()}"
        )

    frame = _frame(request)
    footprint = pixel_footprint(frame, request)
    age_h = max(0.0, (request.issued_at - latest).total_seconds() / 3600.0)

    warnings: list[str] = []
    if request.terrain is None:
        warnings.append("Terrain unavailable; slope effect not applied (flat terrain assumed).")
    if all(w.relative_humidity_pct is None for w in request.weather):
        warnings.append("No humidity data; fuel moisture not estimated (dry upper bound used).")
    if age_h > DEGRADED_OBSERVATION_AGE_H:
        warnings.append(f"Newest hotspot is {age_h:.1f} h old; the fire may have changed or gone out since.")

    horizons: list[SpreadHorizon] = []
    for horizon in request.horizons_hours:
        valid_at = request.issued_at + timedelta(hours=horizon)
        if age_h > MAX_OBSERVATION_AGE_H:
            horizons.append(
                SpreadHorizon(
                    horizon_hours=horizon,
                    valid_at=valid_at,
                    status="insufficient_data",
                    hours_since_observation=round((valid_at - latest).total_seconds() / 3600.0, 2),
                    notes=[f"Newest hotspot older than {MAX_OBSERVATION_AGE_H:.0f} h; no envelope produced."],
                )
            )
            continue
        horizons.append(_grow_horizon(frame, footprint, request, latest, valid_at, horizon))

    degraded = bool(warnings) or any(h.status != "ok" for h in horizons)
    return FireSpreadResponse(
        model_version=MODEL_VERSION,
        method=METHOD,
        latest_observation_at=latest,
        observed_footprint=ring_to_geojson(frame, footprint),
        observed_footprint_area_km2=round(polygon_area_km2(footprint), 3),
        horizons=horizons,
        confidence="very_low" if degraded else "low",
        warnings=warnings,
        limitations=LIMITATIONS,
        assumptions={
            "rosWindSpeedFraction": WIND_SPEED_FRACTION,
            "moistureOfExtinction": MOISTURE_OF_EXTINCTION,
            "dryReferenceMoisture": DRY_REFERENCE_MOISTURE,
            "mcarthurSlopeCoefficient": MCARTHUR_SLOPE_COEFFICIENT,
            "rainStopsSpreadMmPerHour": RAIN_STOPS_SPREAD_MM_PER_H,
            "defaultPixelKm": DEFAULT_PIXEL_KM,
            "fuelModel": "generic (unknown fuel type)",
        },
    )
