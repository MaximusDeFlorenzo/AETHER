import type { CitizenLocation } from './types';

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Initial compass bearing from point 1 to point 2, degrees clockwise from north. */
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS_ID = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];

export function compassName(deg: number): string {
  return COMPASS_ID[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Smallest absolute difference between two bearings, 0–180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function locationLatLng(location: CitizenLocation | null): { lat: number; lng: number } | null {
  if (!location?.point) return null;
  const [lng, lat] = location.point;
  return { lat, lng };
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km).toLocaleString('id-ID')} km`;
}

/**
 * How close an event is to the citizen, in plain words. Measured to the
 * district reference point, so "dekat" is deliberately generous.
 */
export function proximityLabel(km: number | null): { label: string; near: boolean } {
  if (km === null) return { label: 'Jarak tidak diketahui', near: false };
  if (km <= 50) return { label: 'Dekat wilayah Anda', near: true };
  if (km <= 150) return { label: `± ${formatDistance(km)} dari Anda`, near: false };
  return { label: `Jauh dari Anda (± ${formatDistance(km)})`, near: false };
}

/**
 * Rough "is the smoke heading my way" check for a fire, from the wind
 * observed at the citizen's own district: if the wind is blowing FROM the
 * fire's direction and the fire is within range, smoke is likely carried
 * toward them. A hint, not a dispersion model — always labelled as an
 * estimate in the UI.
 */
export function smokeLikelyReaches(
  userLat: number,
  userLng: number,
  fireLat: number,
  fireLng: number,
  windFromDeg: number,
  maxKm = 400,
): boolean {
  const km = distanceKm(userLat, userLng, fireLat, fireLng);
  if (km > maxKm) return false;
  const towardFire = bearingDeg(userLat, userLng, fireLat, fireLng);
  return angleDiff(towardFire, windFromDeg) <= 35;
}

export function googleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

export function locationSummary(location: CitizenLocation): string {
  return location.villageName ?? location.subdistrictName ?? location.districtName;
}

export function locationFullName(location: CitizenLocation): string {
  return [
    location.villageName,
    location.subdistrictName ? `Kec. ${location.subdistrictName}` : null,
    location.districtName,
  ]
    .filter(Boolean)
    .join(', ');
}
