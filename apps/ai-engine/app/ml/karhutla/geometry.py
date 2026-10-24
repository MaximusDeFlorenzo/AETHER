"""Small, dependency-free planar geometry for the karhutla engines.

Both engines work in a local tangent plane (x east, y north, kilometres)
centred on the fire cluster — an equirectangular projection, accurate to
well under 1% within the few-hundred-km domains used here near the
equator, and far below every other source of uncertainty in these models.
"""

import math
from dataclasses import dataclass

EARTH_RADIUS_KM = 6371.0088
Point = tuple[float, float]


@dataclass(frozen=True)
class LocalFrame:
    lat0: float
    lon0: float

    def to_xy(self, lat: float, lon: float) -> Point:
        x = EARTH_RADIUS_KM * math.radians(lon - self.lon0) * math.cos(math.radians(self.lat0))
        y = EARTH_RADIUS_KM * math.radians(lat - self.lat0)
        return x, y

    def to_latlon(self, x: float, y: float) -> Point:
        lat = self.lat0 + math.degrees(y / EARTH_RADIUS_KM)
        lon = self.lon0 + math.degrees(x / (EARTH_RADIUS_KM * math.cos(math.radians(self.lat0))))
        return lat, lon


def offset(point: Point, bearing_deg: float, distance_km: float) -> Point:
    rad = math.radians(bearing_deg)
    return point[0] + distance_km * math.sin(rad), point[1] + distance_km * math.cos(rad)


def bearing_of(dx: float, dy: float) -> float:
    return math.degrees(math.atan2(dx, dy)) % 360.0


def _cross(o: Point, a: Point, b: Point) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def convex_hull(points: list[Point]) -> list[Point]:
    """Andrew's monotone chain; counter-clockwise, no repeated closing point.
    Deterministic for identical input (stable sort on exact coordinates)."""
    unique = sorted(set(points))
    if len(unique) <= 2:
        return unique
    lower: list[Point] = []
    for p in unique:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[Point] = []
    for p in reversed(unique):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def polygon_area_km2(ring: list[Point]) -> float:
    if len(ring) < 3:
        return 0.0
    total = 0.0
    for i, (x1, y1) in enumerate(ring):
        x2, y2 = ring[(i + 1) % len(ring)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def ring_to_geojson(frame: LocalFrame, ring: list[Point]) -> dict:
    """Local-km ring -> GeoJSON Polygon ([lon, lat], closed, CCW exterior)."""
    coords = []
    for x, y in ring:
        lat, lon = frame.to_latlon(x, y)
        coords.append([round(lon, 5), round(lat, 5)])
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return {"type": "Polygon", "coordinates": [coords]}
