"""`POST /predict-rain-nowcast` orchestration: decode frames → per-point
motion → three baseline nowcasts per horizon → Stage-2 spatial features
(and the spatial model's forecast, when a promoted one is supplied)."""

import numpy as np

from app.ml.rainfall import motion as motion_model
from app.ml.rainfall import nowcast as nowcast_model
from app.ml.rainfall import spatial_model
from app.ml.rainfall.grid import GridGeometry, decode_grid
from app.ml.rainfall.motion import MotionEstimate, estimate_local_motion
from app.ml.rainfall.nowcast import (
    MIN_VALID_FRACTION,
    METHODS,
    forecast_at,
    neighbourhood,
    velocity_for,
    wind_to_motion_kmh,
)
from app.schemas.rainfall import (
    ForecastOut,
    MovementOut,
    NeighbourhoodOut,
    PointNowcastOut,
    RainNowcastRequest,
    RainNowcastResponse,
)

# A tracked match explaining < 25 % of the windows' variance (r < 0.5) is
# too weak to call even "low" confidence.
MIN_CORRELATION_FOR_LOW = 0.5
# Neighbourhood scales for the Stage-2 features (the baselines already
# cover 15-45 km around the point and upstream).
CONTEXT_RADII_KM = (50.0, 100.0)


def _rain_fraction(field: np.ndarray, geometry: GridGeometry, lat: float, lon: float, radius_km: float, threshold: float) -> float | None:
    values = neighbourhood(field, geometry, lat, lon, radius_km)
    if values is None:
        return None
    valid = values[np.isfinite(values)]
    if valid.size < MIN_VALID_FRACTION * values.size:
        return None
    return round(float(np.mean(valid >= threshold)), 3)


def _movement_out(estimate: MotionEstimate | None) -> MovementOut:
    if estimate is None:
        return MovementOut(status="no_previous_frame", confidence="very_low")
    ok = (
        estimate.status == "ok"
        and estimate.correlation is not None
        and estimate.correlation >= MIN_CORRELATION_FOR_LOW
    )
    return MovementOut(
        status=estimate.status,
        toward_deg=estimate.toward_deg,
        speed_kmh=estimate.speed_kmh,
        east_kmh=estimate.east_kmh,
        north_kmh=estimate.north_kmh,
        correlation=estimate.correlation,
        zero_shift_correlation=estimate.zero_shift_correlation,
        rain_cells_tracked=estimate.rain_cells,
        unchanged_fraction=estimate.unchanged_fraction,
        confidence="low" if ok else "very_low",
    )


def run_nowcast(request: RainNowcastRequest) -> RainNowcastResponse:
    spec = request.grid
    geometry = GridGeometry(spec.west_lon, spec.north_lat, spec.resolution_deg, spec.nx, spec.ny)
    current = decode_grid(request.current.data_b64, geometry)
    previous = decode_grid(request.previous.data_b64, geometry) if request.previous else None
    hours_between = (
        (request.current.valid_time - request.previous.valid_time).total_seconds() / 3600
        if request.previous
        else None
    )
    params = request.parameters
    spec, spatial_note = spatial_model.usable_spec(request.spatial_model)

    points: list[PointNowcastOut] = []
    for point in request.points:
        estimate = (
            estimate_local_motion(
                previous,
                current,
                geometry,
                point.latitude,
                point.longitude,
                hours_between,
                half_window=params.half_window_cells,
                max_shift=params.max_shift_cells,
            )
            if previous is not None
            else None
        )
        steering = (
            wind_to_motion_kmh(point.steering_wind.speed_kmh, point.steering_wind.from_deg)
            if point.steering_wind
            else None
        )
        forecasts = []
        for method in METHODS:
            velocity = velocity_for(method, estimate, steering)
            for horizon in request.horizons_hours:
                result = forecast_at(
                    current,
                    geometry,
                    method,
                    point.latitude,
                    point.longitude,
                    horizon,
                    velocity,
                    params.threshold_mm_per_hour,
                    base_radius_km=params.base_radius_km,
                    radius_growth_km_per_hour=params.radius_growth_km_per_hour,
                )
                forecasts.append(
                    ForecastOut(
                        method=result.method,
                        horizon_hours=result.horizon_hours,
                        status=result.status,
                        probability=result.probability,
                        expected_mm_per_hour=result.expected_mm_per_hour,
                        source_latitude=result.source_lat,
                        source_longitude=result.source_lon,
                        neighbourhood_radius_km=result.radius_km,
                        reason=result.reason,
                    )
                )
        cell = geometry.cell_of(point.latitude, point.longitude)
        current_value = float(current[cell]) if cell is not None and np.isfinite(current[cell]) else None
        movement = _movement_out(estimate)
        fractions = {
            f"{radius:g}": _rain_fraction(
                current, geometry, point.latitude, point.longitude, radius, params.threshold_mm_per_hour
            )
            for radius in CONTEXT_RADII_KM
        }
        context = NeighbourhoodOut(rain_fraction_by_radius_km=fractions)
        spatial_features: dict[str, list[float] | None] = {}
        for horizon in request.horizons_hours:
            features = spatial_model.build_features(
                probabilities={
                    f.method: f.probability
                    for f in forecasts
                    if f.horizon_hours == horizon and f.status == "ok"
                },
                current_mm_per_hour=current_value,
                rain_fraction_50km=fractions["50"],
                rain_fraction_100km=fractions["100"],
                motion_tracked=movement.status == "ok" and movement.confidence == "low",
                valid_time=request.current.valid_time,
                longitude=point.longitude,
            )
            spatial_features[str(horizon)] = features
            coefficients = spec.horizons.get(str(horizon)) if spec else None
            if coefficients is None:
                continue
            forecasts.append(
                ForecastOut(
                    method="spatial_logistic",
                    horizon_hours=horizon,
                    status="ok" if features is not None else "insufficient_data",
                    probability=(
                        round(spatial_model.predict_probability(coefficients.coefficients, coefficients.intercept, features), 4)
                        if features is not None
                        else None
                    ),
                    reason=None if features is not None else "point rain or neighbourhood unknown",
                )
            )
        points.append(
            PointNowcastOut(
                id=point.id,
                current_mm_per_hour=current_value,
                movement=movement,
                neighbourhood=context,
                forecasts=forecasts,
                spatial_features=spatial_features,
            )
        )

    model_versions = {"motion": motion_model.MODEL_VERSION, "nowcast": nowcast_model.MODEL_VERSION}
    if spec is not None:
        model_versions["spatial"] = spec.model_version
    return RainNowcastResponse(
        model_versions=model_versions,
        issued_at=request.issued_at,
        data_valid_time=request.current.valid_time,
        threshold_mm_per_hour=params.threshold_mm_per_hour,
        grid_missing_fraction=float(np.mean(~np.isfinite(current))),
        spatial_feature_names=spatial_model.FEATURE_NAMES,
        spatial_model_note=spatial_note,
        points=points,
    )
