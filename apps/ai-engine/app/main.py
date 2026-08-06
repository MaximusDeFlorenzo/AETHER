import logging

from fastapi import FastAPI

from app.api.routes import (
    computer_vision,
    health,
    predict,
    priority,
    recommendation,
    relationships,
    resource,
)
from app.core.config import get_settings

settings = get_settings()
logging.basicConfig(level=settings.log_level)

app = FastAPI(
    title="AETHER AI Engine",
    description=(
        "Stateless AI inference service for AETHER's multi-hazard risk platform: "
        "Hazard Prediction (Earthquake, Landslide, Flood, Wildfire), Spatial "
        "Intelligence, Decision Intelligence, Resource Optimization, and "
        "Computer Vision engines behind one FastAPI service. Called only by "
        "apps/api, never by apps/web directly (docs/ARCHITECTURE.md §1)."
    ),
    version=settings.model_version,
)

app.include_router(health.router)
app.include_router(predict.router)
app.include_router(priority.router)
app.include_router(recommendation.router)
app.include_router(relationships.router)
app.include_router(resource.router)
app.include_router(computer_vision.router)
