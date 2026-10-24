"""Regular lat/lon rain grid as sent by apps/api: little-endian float32,
row-major, first row = northernmost, NaN = missing. Geometry is described by
cell CENTRES (`west_lon`, `north_lat`) and a square `resolution_deg`."""

import base64
import math
from dataclasses import dataclass

import numpy as np

KM_PER_DEG_LAT = 110.574
KM_PER_DEG_LON_EQUATOR = 111.320


@dataclass(frozen=True)
class GridGeometry:
    west_lon: float
    north_lat: float
    resolution_deg: float
    nx: int
    ny: int

    def cell_of(self, lat: float, lon: float) -> tuple[int, int] | None:
        """(line, column) of the cell containing the point, None outside."""
        line = math.floor((self.north_lat + self.resolution_deg / 2 - lat) / self.resolution_deg + 1e-9)
        column = math.floor((lon - (self.west_lon - self.resolution_deg / 2)) / self.resolution_deg + 1e-9)
        if 0 <= line < self.ny and 0 <= column < self.nx:
            return line, column
        return None

    def centre_of(self, line: float, column: float) -> tuple[float, float]:
        return (
            self.north_lat - line * self.resolution_deg,
            self.west_lon + column * self.resolution_deg,
        )

    def cell_size_km(self, lat: float) -> tuple[float, float]:
        """(east-west, north-south) size of one cell at `lat`."""
        return (
            self.resolution_deg * KM_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat)),
            self.resolution_deg * KM_PER_DEG_LAT,
        )


def decode_grid(data_b64: str, geometry: GridGeometry) -> np.ndarray:
    """Decodes one frame; raises ValueError on a size mismatch rather than
    reshaping garbage. Negative values (provider missing codes that slipped
    through) become NaN."""
    raw = base64.b64decode(data_b64, validate=True)
    expected = geometry.nx * geometry.ny * 4
    if len(raw) != expected:
        raise ValueError(f"grid has {len(raw)} bytes, expected {expected} ({geometry.ny}x{geometry.nx} float32)")
    grid = np.frombuffer(raw, dtype="<f4").reshape(geometry.ny, geometry.nx).astype(np.float64)
    grid[grid < 0] = np.nan
    return grid


def encode_grid(grid: np.ndarray) -> str:
    """Inverse of `decode_grid` (tests and fixtures)."""
    return base64.b64encode(np.asarray(grid, dtype="<f4").tobytes()).decode("ascii")


def offset_km_to_degrees(lat: float, east_km: float, north_km: float) -> tuple[float, float]:
    """(Δlat, Δlon) for a displacement at latitude `lat` (flat-earth; fine
    for the ≤ ~200 km displacements used here)."""
    return (
        north_km / KM_PER_DEG_LAT,
        east_km / (KM_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat))),
    )
