from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

HEADERS = {"X-Internal-Token": "dev-internal-token"}

EARTHQUAKE_HAZARD_EVENT = {
    "hazardType": "earthquake",
    "latitude": -7.5,
    "longitude": 110.2,
    "eventTime": "2026-07-04T03:12:00Z",
    "earthquake": {"magnitude": 6.8, "depthKm": 10.0},
}

FLOOD_HAZARD_EVENT = {
    "hazardType": "flood",
    "latitude": -7.5,
    "longitude": 110.2,
    "eventTime": "2026-07-04T03:12:00Z",
    "flood": {"rainfallMm": 90.0, "waterLevelM": 2.8, "riverBasin": "Bengawan Solo"},
}

WILDFIRE_HAZARD_EVENT = {
    "hazardType": "wildfire",
    "latitude": -2.5,
    "longitude": 113.2,
    "eventTime": "2026-07-04T03:12:00Z",
    "wildfire": {"frpConfidence": 0.82, "hotspotCount": 12, "brightnessKelvin": 355.0},
}

DISTRICT = {
    "id": "d1",
    "name": "Kabupaten Bantul",
    "totalPopulation": 1024000,
    "populationDensity": 2010.5,
    "distanceFromEventKm": 3.0,
}


def test_predict_risk_rejects_missing_token():
    response = client.post(
        "/predict-risk",
        json={"hazardEvent": EARTHQUAKE_HAZARD_EVENT, "district": DISTRICT, "historicalDisasters": []},
    )
    assert response.status_code == 422  # missing required header


def test_predict_risk_rejects_wrong_token():
    response = client.post(
        "/predict-risk",
        json={"hazardEvent": EARTHQUAKE_HAZARD_EVENT, "district": DISTRICT, "historicalDisasters": []},
        headers={"X-Internal-Token": "not-the-real-token"},
    )
    assert response.status_code == 401


def test_predict_risk_rejects_an_out_of_range_magnitude():
    response = client.post(
        "/predict-risk",
        json={
            "hazardEvent": {**EARTHQUAKE_HAZARD_EVENT, "earthquake": {"magnitude": 15, "depthKm": 10.0}},
            "district": DISTRICT,
            "historicalDisasters": [],
        },
        headers=HEADERS,
    )
    assert response.status_code == 422


def test_predict_risk_rejects_earthquake_without_earthquake_details():
    response = client.post(
        "/predict-risk",
        json={
            "hazardEvent": {**EARTHQUAKE_HAZARD_EVENT, "earthquake": None},
            "district": DISTRICT,
            "historicalDisasters": [],
        },
        headers=HEADERS,
    )
    assert response.status_code == 422


def test_predict_risk_rejects_flood_without_flood_details():
    response = client.post(
        "/predict-risk",
        json={
            "hazardEvent": {**FLOOD_HAZARD_EVENT, "flood": None},
            "district": DISTRICT,
            "historicalDisasters": [],
        },
        headers=HEADERS,
    )
    assert response.status_code == 422


def test_predict_risk_rejects_wildfire_without_wildfire_details():
    response = client.post(
        "/predict-risk",
        json={
            "hazardEvent": {**WILDFIRE_HAZARD_EVENT, "wildfire": None},
            "district": DISTRICT,
            "historicalDisasters": [],
        },
        headers=HEADERS,
    )
    assert response.status_code == 422


def test_full_pipeline_earthquake():
    predict_response = client.post(
        "/predict-risk",
        json={"hazardEvent": EARTHQUAKE_HAZARD_EVENT, "district": DISTRICT, "historicalDisasters": []},
        headers=HEADERS,
    )
    assert predict_response.status_code == 200
    prediction = predict_response.json()
    assert prediction["exposureLevel"] in ("low", "moderate", "high", "severe")

    priority_response = client.post(
        "/calculate-priority",
        json={"hazardType": "earthquake", "prediction": prediction, "district": DISTRICT},
        headers=HEADERS,
    )
    assert priority_response.status_code == 200
    priority = priority_response.json()
    assert priority["priorityLevel"] in ("low", "medium", "high", "critical")

    recommendation_response = client.post(
        "/generate-recommendation",
        json={
            "hazardEvent": EARTHQUAKE_HAZARD_EVENT,
            "district": DISTRICT,
            "prediction": prediction,
            "priority": priority,
        },
        headers=HEADERS,
    )
    assert recommendation_response.status_code == 200
    recommendation = recommendation_response.json()
    assert len(recommendation["reasons"]) > 0
    assert "summaryText" in recommendation


def test_full_pipeline_flood():
    predict_response = client.post(
        "/predict-risk",
        json={"hazardEvent": FLOOD_HAZARD_EVENT, "district": DISTRICT, "historicalDisasters": []},
        headers=HEADERS,
    )
    assert predict_response.status_code == 200
    prediction = predict_response.json()
    assert prediction["hazardType"] == "flood"
    assert prediction["exposureLevel"] in ("low", "moderate", "high", "severe")

    priority_response = client.post(
        "/calculate-priority",
        json={"hazardType": "flood", "prediction": prediction, "district": DISTRICT},
        headers=HEADERS,
    )
    assert priority_response.status_code == 200

    recommendation_response = client.post(
        "/generate-recommendation",
        json={
            "hazardEvent": FLOOD_HAZARD_EVENT,
            "district": DISTRICT,
            "prediction": prediction,
            "priority": priority_response.json(),
        },
        headers=HEADERS,
    )
    assert recommendation_response.status_code == 200
    assert len(recommendation_response.json()["reasons"]) > 0


def test_full_pipeline_wildfire():
    predict_response = client.post(
        "/predict-risk",
        json={"hazardEvent": WILDFIRE_HAZARD_EVENT, "district": DISTRICT, "historicalDisasters": []},
        headers=HEADERS,
    )
    assert predict_response.status_code == 200
    prediction = predict_response.json()
    assert prediction["hazardType"] == "wildfire"
    assert prediction["exposureLevel"] in ("low", "moderate", "high", "severe")

    priority_response = client.post(
        "/calculate-priority",
        json={"hazardType": "wildfire", "prediction": prediction, "district": DISTRICT},
        headers=HEADERS,
    )
    assert priority_response.status_code == 200

    recommendation_response = client.post(
        "/generate-recommendation",
        json={
            "hazardEvent": WILDFIRE_HAZARD_EVENT,
            "district": DISTRICT,
            "prediction": prediction,
            "priority": priority_response.json(),
        },
        headers=HEADERS,
    )
    assert recommendation_response.status_code == 200
    assert len(recommendation_response.json()["reasons"]) > 0


def test_detect_relationships_endpoint_requires_token_and_returns_a_result_per_candidate():
    unauthenticated = client.post(
        "/detect-relationships",
        json={
            "sourceEvent": {"hazardType": "earthquake", "magnitude": 6.5, "eventTime": "2026-07-04T03:00:00Z"},
            "candidateEvents": [{"hazardType": "landslide", "distanceKm": 10.0, "hoursApart": 6.0}],
        },
    )
    assert unauthenticated.status_code == 422

    response = client.post(
        "/detect-relationships",
        json={
            "sourceEvent": {"hazardType": "earthquake", "magnitude": 6.5, "eventTime": "2026-07-04T03:00:00Z"},
            "candidateEvents": [
                {"hazardType": "landslide", "distanceKm": 10.0, "hoursApart": 6.0},
                {"hazardType": "landslide", "distanceKm": 500.0, "hoursApart": 1000.0},
            ],
        },
        headers=HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["relationships"]) == 2
    assert body["relationships"][0]["relationshipType"] == "triggers"
    assert body["relationships"][1]["relationshipType"] is None


def test_optimize_resources_endpoint():
    response = client.post(
        "/optimize-resources",
        json={"estimatedAffectedPopulation": 50_000, "exposureLevel": "high", "nearbyHospitals": []},
        headers=HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["hospital"]["hospitalsNeeded"] >= 0
    assert body["evacuationShelters"] >= 0


def _solid_png_base64(rgb: tuple[int, int, int]) -> str:
    import base64
    from io import BytesIO

    import numpy as np
    from PIL import Image

    array = np.full((32, 32, 3), rgb, dtype=np.uint8)
    buffer = BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_detect_cv_requires_token():
    response = client.post("/detect-cv", json={"imageBase64": _solid_png_base64((0, 0, 0))})
    assert response.status_code == 422


def test_detect_cv_rejects_invalid_image_data():
    response = client.post(
        "/detect-cv", json={"imageBase64": "not-a-real-image"}, headers=HEADERS
    )
    assert response.status_code == 422


def test_detect_cv_returns_a_detection_for_a_flame_colored_image():
    response = client.post(
        "/detect-cv",
        json={"imageBase64": _solid_png_base64((230, 120, 20)), "categories": ["fire"]},
        headers=HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["detections"]) == 1
    assert body["detections"][0]["detectionType"] == "fire"
    assert "modelVersion" in body


def test_detect_cv_returns_no_detections_for_a_neutral_image():
    # Saturated green matches none of the four detectors' color/texture cues
    # (unlike gray, which is itself smoke.py's color signature).
    response = client.post(
        "/detect-cv",
        json={"imageBase64": _solid_png_base64((40, 150, 40))},
        headers=HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["detections"] == []
